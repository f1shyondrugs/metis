import { providerRetryDetail } from "@/lib/provider-retry";
import type { ModelSwitchPart, ProviderWaitPart } from "@/lib/run-control-event";
import { MEMORY_WAIT_MESSAGE, MEMORY_OVERRIDE_MESSAGE, WORKER_QUEUE_MESSAGE } from "@/lib/memory-queue";
import { projectRole } from "@/lib/project-access";
import { projectModelOverride, validateProjectModelSelection } from "@/lib/project-model-server";
import { modeById } from "@/lib/modes";
import { hasUserInputResponse, userInputProgress, type UserInputProgress } from "@/lib/user-input-progress";
import { providerRateLimit, type ProviderRateLimit } from "@/lib/provider-rate-limit";
import { getProviderLimitResumeEnabled } from "@/lib/provider-rate-limit-settings";
import { providerContinuationPrompt } from "@/lib/provider-continuation";
import { randomUUID } from "node:crypto";
import { syncHandoffForJob } from "@/lib/project-team-lifecycle";
import { resolveAgentRuntimeMs } from "@/lib/agent-runtime-policy.mjs";
import {
  getDatabase,
  isSqliteBusyError,
  parseData,
  transaction,
  withSqliteRetry,
} from "@/lib/sqlite";
import type { AgentJob, JobStatus } from "@/lib/jobs";
import { appendMessage, claimQueuedMessageInTransaction, getChat, getChatMetadata, getGlobalModelSettings, updateChat } from "@/lib/db-store";
import {
  describeQueueWait,
  parseWorkerConcurrency,
} from "@/lib/worker-scheduler";
import { isChatWaitingForUser, isJobWaitingForUser, shouldQueueUserInputResume } from "@/lib/user-input-resume";

const iso = () => new Date().toISOString();
const RUN_EVENT_RETENTION = 10_000;
const RUN_EVENT_MAX_BYTES = 128 * 1024;
let lastRunEventCleanupAt = 0;
const DEFAULT_JOB_LEASE_MS = 120_000;
const DEFAULT_WORKER_ID =
  process.env.AI_CHAT_WORKER_ID?.trim() ||
  `metis-worker-${process.pid}-${randomUUID()}`;

const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: [
    "queued",
    "running",
    "completed",
    "cancelled",
    "error",
    "interrupted",
  ],
  running: [
    "running",
    "queued",
    "switching",
    "waiting_input",
    "waiting_for_user",
    "completed",
    "cancelled",
    "interrupted",
    "error",
  ],
  switching: ["switching", "queued", "cancelled", "interrupted", "error"],
  waiting_input: [
    "waiting_input",
    "queued",
    "running",
    "cancelled",
    "interrupted",
    "error",
  ],
  waiting_for_user: [
    "waiting_for_user",
    "queued",
    "running",
    "cancelled",
    "interrupted",
    "error",
  ],
  completed: ["completed"],
  cancelled: ["cancelled"],
  interrupted: ["interrupted", "queued", "cancelled"],
  error: ["error", "queued", "cancelled"],
};

export function canTransitionJobStatus(from: JobStatus, to: JobStatus) {
  return JOB_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

function jobRevision(job: AgentJob) {
  return Number.isInteger(job.revision) && (job.revision as number) >= 0
    ? (job.revision as number)
    : 0;
}

function truncateRunEventString(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const marker = `\n…[truncated ${value.length - maxChars} chars]…\n`;
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.6);
  const tail = Math.floor(available * 0.4);
  return `${value.slice(0, head)}${marker}${tail ? value.slice(-tail) : ""}`;
}

function compactRunEventValue(
  value: unknown,
  stringLimit: number,
  arrayLimit: number,
  depth = 0,
): unknown {
  if (typeof value === "string")
    return truncateRunEventString(value, stringLimit);
  if (value == null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (depth >= 8) return "[nested payload omitted]";
  if (Array.isArray(value)) {
    if (value.length <= arrayLimit) {
      return value.map((item) =>
        compactRunEventValue(item, stringLimit, arrayLimit, depth + 1),
      );
    }
    const headCount = Math.ceil(arrayLimit / 2);
    const tailCount = Math.floor(arrayLimit / 2);
    return [
      ...value
        .slice(0, headCount)
        .map((item) =>
          compactRunEventValue(item, stringLimit, arrayLimit, depth + 1),
        ),
      `[${value.length - arrayLimit} array items omitted]`,
      ...value
        .slice(-tailCount)
        .map((item) =>
          compactRunEventValue(item, stringLimit, arrayLimit, depth + 1),
        ),
    ];
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        compactRunEventValue(item, stringLimit, arrayLimit, depth + 1),
      ]),
    );
  }
  return String(value);
}

export function serializeRunEventData(data: unknown) {
  const raw = JSON.stringify(data) ?? "null";
  if (Buffer.byteLength(raw, "utf8") <= RUN_EVENT_MAX_BYTES) return raw;
  let compacted = JSON.stringify(compactRunEventValue(data, 8_000, 32));
  if (Buffer.byteLength(compacted, "utf8") <= RUN_EVENT_MAX_BYTES)
    return compacted;
  compacted = JSON.stringify(compactRunEventValue(data, 2_000, 16));
  return compacted;
}

export function getJobForMessageId(chatId: string, messageId: string) {
  return parseData<AgentJob>(getDatabase().prepare(
    "SELECT data FROM jobs WHERE chat_id = ? AND json_extract(data, '$.messageId') = ? ORDER BY updated_at DESC LIMIT 1",
  ).get(chatId, messageId));
}

function enqueueJobInTransaction(
  input: Omit<
    AgentJob,
    "id" | "status" | "attempts" | "createdAt" | "updatedAt"
  >,
  options?: { beforeInsert?: () => void },
) {
    if (input.messageId) {
      const existing = getJobForMessageId(input.chatId, input.messageId);
      if (existing) {
        // Keep retries self-healing: the callback is idempotent by message id
        // and can restore a historically orphaned chat message if needed.
        options?.beforeInsert?.();
        return existing;
      }
    }
    const active = getDatabase()
      .prepare(
        `SELECT data FROM jobs
         WHERE chat_id = ? AND status IN ('queued', 'running', 'switching', 'waiting_input', 'waiting_for_user')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(input.chatId);
    const activeJob = parseData<AgentJob>(active);
    if (activeJob) {
      const error = new Error("This chat already has an active run.");
      error.name = "ActiveChatRun";
      throw error;
    }
    // Any durable side effect tied to this submission (notably the user
    // message) must happen only after the active-run check and inside this
    // same transaction. Otherwise a racing 409 can leave an orphan message
    // in the chat with no job behind it.
    options?.beforeInsert?.();

    const team = getDatabase().prepare("SELECT p.id AS projectId, p.owner_id AS ownerId, p.data AS projectData, a.data AS agentData FROM chats c LEFT JOIN chat_list l ON l.id=c.id JOIN projects p ON p.id = CASE WHEN l.id IS NULL THEN json_extract(c.data, '$.projectId') ELSE l.project_id END LEFT JOIN project_agents a ON a.chat_id = c.id WHERE c.id = ?").get(input.chatId) as { projectId: string; ownerId: string; projectData: string; agentData?: string } | undefined;
    if (team && JSON.parse(team.projectData).mode === "agents") {
      const agent = team.agentData ? JSON.parse(team.agentData) : null;
      if (!input.userId || !projectRole(team.projectId,input.userId) || !agent || agent.archivedAt) throw new Error("An active agent owned by this account is required for team execution.");
      const parent = input.parentJobId ? getJob(input.parentJobId) : null;
      const model = projectModelOverride(team.projectId,input.userId);
      if (model) { validateProjectModelSelection(input.userId, model.modelId, model.modelParams); input = { ...input, ...model }; }
      input = { ...input, modeId: modeById(input.modeId || getChatMetadata(input.chatId, input.userId)?.sessionState?.modeId, getGlobalModelSettings(input.userId).customModes || []).id, projectTeamId: team.projectId, projectTeamRootJobId: parent?.projectTeamRootJobId || parent?.id || input.projectTeamRootJobId };
    }
    if (input.parentJobId || input.projectTeamId) input = { ...input, maxRuntimeMs: resolveAgentRuntimeMs(input.maxRuntimeMs, getGlobalModelSettings(input.userId).agentRuntimeMs) };
    const now = iso();
    const background =
      input.workload === "background" || Boolean(input.automationId);
    const interactiveHeavy = !background && (
      Boolean(input.parentJobId) ||
      /(?:browser|web)/i.test(input.modeId || "")
    );
    const priority = Number.isFinite(input.priority)
      ? Math.max(0, Math.min(100, Math.floor(input.priority as number)))
      : background
        ? 10
        : interactiveHeavy
          ? 60
          : 100;
    const maxWorkers = parseWorkerConcurrency(
      process.env.AI_CHAT_WORKER_CONCURRENCY,
    );
    const running = Number(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) as count FROM jobs WHERE status = 'running'",
          )
          .get() as { count?: number }
      ).count || 0,
    );
    const queuedRows = getDatabase()
      .prepare(`SELECT data FROM jobs WHERE status = 'queued'
        AND (NOT json_valid(data) OR json_extract(data, '$.providerRateLimit.resetAt') IS NULL
             OR json_extract(data, '$.providerRateLimit.resetAt') <= ?)`)
      .all(iso());
    const queued = queuedRows.filter((row) => parseData<AgentJob>(row)).length;
    const queueMessage = describeQueueWait(running, queued, maxWorkers);
    const job: AgentJob = {
      ...input,
      priority,
      workload: background ? "background" : interactiveHeavy ? "interactive-heavy" : "interactive",
      ...(queueMessage ? { queueMessage } : {}),
      id: randomUUID(),
      status: "queued",
      attempts: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (job.projectTeamId && !job.projectTeamRootJobId) job.projectTeamRootJobId = job.id;
    getDatabase()
      .prepare(
        "INSERT INTO jobs (id, chat_id, user_id, data, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        job.id,
        job.chatId,
        job.userId ?? null,
        JSON.stringify(job),
        job.status,
        now,
      );
  return job;
}

export function enqueueJob(
  input: Omit<
    AgentJob,
    "id" | "status" | "attempts" | "createdAt" | "updatedAt"
  >,
  options?: { beforeInsert?: () => void; interruptActiveRun?: boolean },
) {
  return transaction(() => {
    // Replace and submit in one write transaction: the FIFO worker must not
    // claim a different follow-up between cancellation and this submission.
    const existing = input.messageId ? getJobForMessageId(input.chatId, input.messageId) : null;
    if (options?.interruptActiveRun && !existing) {
      // Recheck inside the write transaction before cancellation can clear a
      // question that arrived after the HTTP route read its chat snapshot.
      if (isChatWaitingForUser(getChatMetadata(input.chatId, input.userId)) ||
          isJobWaitingForUser(getActiveParentJob(input.chatId)?.status)) {
        const error = new Error("Please answer the agent's question before sending a queued message.");
        error.name = "WaitingForUser";
        throw error;
      }
      requestJobCancel(input.chatId, input.userId);
    }
    return enqueueJobInTransaction(input, options);
  });
}

export function drainNextQueuedMessage(chatId: string, userId?: string) {
  return transaction(() => {
    // Occupancy is per chat, not per user. A userId filter here lets a second
    // drain start while another owner/null-user job is already live.
    if (getActiveParentJob(chatId)) {
      const error = new Error("This chat already has an active run.");
      error.name = "ActiveChatRun";
      throw error;
    }
    const claimed = claimQueuedMessageInTransaction(chatId, userId);
    if (!claimed) return null;
    const { chat, message } = claimed;
    return enqueueJobInTransaction({
      chatId,
      ...(userId ? { userId } : {}),
      message: message.text.trim() || (message.attachments?.length ? `(see attachments)` : ""),
      messageId: message.id,
      ...(message.referenceText ? { referenceText: message.referenceText } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      ...(chat.agentId ? { agentId: chat.agentId } : {}),
      ...(chat.sessionState?.modeId ? { modeId: chat.sessionState.modeId } : {}),
      ...(chat.modelId ? { modelId: chat.modelId } : {}),
      ...(Array.isArray(chat.modelParams) ? { modelParams: chat.modelParams } : {}),
      ...(chat.incognito ? { incognito: true } : {}),
    });
  });
}

export function getActiveJob(chatId: string, userId?: string) {
  return getActiveJobRow(chatId, userId, false);
}

/** Active run for the chat itself, ignoring subagent child jobs. */
export function getActiveParentJob(chatId: string, userId?: string) {
  return getActiveJobRow(chatId, userId, true);
}

function getActiveJobRow(chatId: string, userId: string | undefined, parentOnly: boolean) {
  const row = getDatabase()
    .prepare(
      `SELECT data FROM jobs
       WHERE chat_id = ?
         AND status IN ('queued', 'running', 'switching', 'waiting_input', 'waiting_for_user')
         AND (? IS NULL OR user_id = ?)
         AND (
           ? = 0
           OR json_extract(data, '$.parentJobId') IS NULL
           OR json_extract(data, '$.parentJobId') = ''
         )
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(chatId, userId ?? null, userId ?? null, parentOnly ? 1 : 0);
  return parseData<AgentJob>(row);
}

export function getJob(id: string) {
  return parseData<AgentJob>(
    getDatabase().prepare("SELECT data FROM jobs WHERE id = ?").get(id),
  );
}

export function listChildJobs(parentJobId: string, userId?: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT data FROM jobs
     WHERE json_extract(data, '$.parentJobId') = ?
       AND (? IS NULL OR user_id = ?)
     ORDER BY updated_at ASC`,
    )
    .all(parentJobId, userId ?? null, userId ?? null);
  return rows
    .map((row) => parseData<AgentJob>(row))
    .filter((job): job is AgentJob => Boolean(job));
}

export function cancelChildJobs(
  parentJobId: string,
  userId: string | undefined,
  reason = "Parent agent cancelled.",
) {
  const queue = [parentJobId];
  const cancelled: AgentJob[] = [];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const child of listChildJobs(parentId, userId)) {
      queue.push(child.id);
      if (
        ![
          "queued",
          "running",
          "switching",
          "waiting_input",
          "waiting_for_user",
        ].includes(child.status)
      )
        continue;
      const updated = updateJob(child.id, {
        status: "cancelled",
        error: reason,
      }, { control: true });
      if (!updated) continue;
      cancelled.push(updated);
      updateChat(
        child.chatId,
        {
          runStatus: "cancelled",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          pendingQuestion: null,
          pendingApproval: null,
        },
        child.userId,
      );
      appendRunEvent(child.id, child.chatId, child.userId, "done", {
        status: "cancelled",
        reason,
      });
    }
  }
  return cancelled;
}

export function listJobs(chatId?: string, userId?: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT data FROM jobs
     WHERE (? IS NULL OR chat_id = ?) AND (? IS NULL OR user_id = ?)
     ORDER BY updated_at DESC`,
    )
    .all(chatId ?? null, chatId ?? null, userId ?? null, userId ?? null);
  return rows
    .map((row) => parseData<AgentJob>(row))
    .filter((job): job is AgentJob => Boolean(job));
}

/** Publish only transitions; keep queue timestamps so status refreshes preserve FIFO. */
export function syncQueuedMemoryWait(blocked: boolean) {
  return transaction(() => {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT data FROM jobs WHERE status = 'queued' AND json_valid(data)
        AND (json_extract(data, '$.providerRateLimit.resetAt') IS NULL
          OR json_extract(data, '$.providerRateLimit.resetAt') <= ?)
        AND json_extract(data, '$.memoryOverrideRequestedAt') IS NULL
        AND COALESCE(json_extract(data, '$.memoryWaiting'), 0) != ?
        AND NOT EXISTS (SELECT 1 FROM job_leases l WHERE l.job_id = jobs.id AND l.expires_at > ?)
      LIMIT 100
    `).all(iso(), blocked ? 1 : 0, iso());
    let changed = 0;
    for (const row of rows) {
      const job = parseData<AgentJob>(row);
      if (!job) continue;
      const queueMessage = blocked ? MEMORY_WAIT_MESSAGE : WORKER_QUEUE_MESSAGE;
      const updated = { ...job, memoryWaiting: blocked || undefined, queueMessage, revision: jobRevision(job) + 1 };
      db.prepare("UPDATE jobs SET data = ? WHERE id = ? AND status = 'queued'")
        .run(JSON.stringify(updated), job.id);
      updateChat(job.chatId, { runStatus: "running", queueMessage }, job.userId);
      appendRunEvent(job.id, job.chatId, job.userId, "status", {
        status: blocked ? "waiting_memory" : "queued", message: queueMessage,
      });
      changed++;
    }
    return changed;
  });
}

/** Acknowledge one queued run only; all normal claim/lease/provider guards still apply. */
export function requestMemoryOverride(jobId: string, userId: string) {
  return transaction(() => {
    const job = getJob(jobId);
    if (!job || job.userId !== userId || !getChatMetadata(job.chatId, userId)) return null;
    if (job.status !== "queued" || (job.providerRateLimit && Date.parse(job.providerRateLimit.resetAt) > Date.now())) return null;
    if (job.memoryOverrideRequestedAt) return job;
    if (!job.memoryWaiting) return null;
    const updated = {
      ...job, memoryWaiting: undefined, memoryOverrideRequestedAt: iso(),
      queueMessage: MEMORY_OVERRIDE_MESSAGE, revision: jobRevision(job) + 1,
    };
    getDatabase().prepare("UPDATE jobs SET data = ? WHERE id = ? AND status = 'queued'")
      .run(JSON.stringify(updated), job.id);
    updateChat(job.chatId, { queueMessage: MEMORY_OVERRIDE_MESSAGE }, userId);
    appendRunEvent(job.id, job.chatId, userId, "status", { status: "queued", message: MEMORY_OVERRIDE_MESSAGE });
    return updated;
  });
}

export function claimNextJob(
  options: {
    interactiveOnly?: boolean;
    memoryOverrideOnly?: boolean;
    workerId?: string;
    leaseMs?: number;
  } = {},
) {
  return transaction(() => {
    const db = getDatabase();
    const workerId = options.workerId?.trim() || DEFAULT_WORKER_ID;
    const leaseMs = Number.isFinite(options.leaseMs)
      ? Math.max(5_000, Math.min(Number(options.leaseMs), 24 * 60 * 60_000))
      : DEFAULT_JOB_LEASE_MS;
    const selectQueued = db.prepare(
      `SELECT id, chat_id as chatId, user_id as userId, data
       FROM jobs
       WHERE status = 'queued'
         AND (? = 0 OR (json_valid(data) AND json_extract(data, '$.memoryOverrideRequestedAt') IS NOT NULL))
         AND (NOT json_valid(data) OR json_extract(data, '$.providerRateLimit.resetAt') IS NULL
              OR json_extract(data, '$.providerRateLimit.resetAt') <= ?)
         AND NOT EXISTS (
           SELECT 1 FROM job_leases l
           WHERE l.job_id = jobs.id AND l.expires_at > ?
         )
         AND (
           ? = 0
           OR (
             COALESCE(
               CASE WHEN json_valid(data) THEN CAST(json_extract(data, '$.priority') AS INTEGER) END,
               100
             ) >= 50
             AND NOT (
               json_valid(data)
               AND (
                 json_extract(data, '$.workload') = 'interactive-heavy'
                 OR (json_extract(data, '$.parentJobId') IS NOT NULL AND json_extract(data, '$.parentJobId') != '')
                 OR lower(COALESCE(json_extract(data, '$.modeId'), '')) LIKE '%browser%'
                 OR lower(COALESCE(json_extract(data, '$.modeId'), '')) LIKE '%web%'
               )
             )
           )
         )
         AND (
           (
             json_valid(data)
             AND json_extract(data, '$.parentJobId') IS NOT NULL
             AND json_extract(data, '$.parentJobId') != ''
           )
           OR NOT EXISTS (
             SELECT 1 FROM jobs AS other
             WHERE other.chat_id = jobs.chat_id
               AND other.id != jobs.id
               AND (other.status IN ('running', 'switching', 'waiting_input', 'waiting_for_user')
                 OR (other.status = 'queued' AND json_valid(other.data) AND json_extract(other.data, '$.providerRateLimit.resetAt') IS NOT NULL))
               AND json_valid(other.data)
               AND (
                 json_extract(other.data, '$.parentJobId') IS NULL
                 OR json_extract(other.data, '$.parentJobId') = ''
               )
           )
         )
         AND (
           CASE WHEN json_valid(data) THEN json_extract(data, '$.projectTeamId') END IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM jobs team_active
             WHERE CASE WHEN json_valid(team_active.data) THEN json_extract(team_active.data, '$.projectTeamId') END = CASE WHEN json_valid(jobs.data) THEN json_extract(jobs.data, '$.projectTeamId') END
               AND team_active.id != jobs.id
               AND team_active.status IN ('running','switching','waiting_input','waiting_for_user')
               AND (
                 COALESCE(CASE WHEN json_valid(team_active.data) THEN json_extract(team_active.data, '$.projectTeamRootJobId') END, team_active.id) != COALESCE(CASE WHEN json_valid(jobs.data) THEN json_extract(jobs.data, '$.projectTeamRootJobId') END, jobs.id)
                 OR CASE WHEN json_valid(team_active.data) THEN json_extract(team_active.data, '$.projectWaitingForHandoffId') END IS NULL
               )
           )
         )
       ORDER BY COALESCE(
                  CASE WHEN json_valid(data) THEN CAST(json_extract(data, '$.priority') AS INTEGER) END,
                  100
                ) DESC,
                updated_at ASC
       LIMIT 1`,
    );
    for (;;) {
      const row = selectQueued.get(options.memoryOverrideOnly ? 1 : 0, iso(), iso(), options.interactiveOnly ? 1 : 0) as
        | { id: string; chatId: string; userId: string | null; data: string }
        | undefined;
      if (!row) return null;
      const job = parseData<AgentJob>(row);
      if (!job) {
        const now = iso();
        const failed = {
          id: row.id,
          chatId: row.chatId,
          ...(row.userId ? { userId: row.userId } : {}),
          message: "",
          status: "error" as const,
          error: "Unreadable queued job data.",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        };
        db.prepare(
          "UPDATE jobs SET data = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
        ).run(JSON.stringify(failed), failed.status, now, row.id);
        continue;
      }
      const waiting = (job as AgentJob & { providerRateLimit?: ProviderRateLimit }).providerRateLimit;
      const detectedAt = Date.parse(waiting?.detectedAt || "");
      const waitedMs = Number.isFinite(detectedAt) ? Math.max(0, Date.now() - detectedAt) : 0;
      const claimed = {
        ...job,
        providerRateLimit: undefined,
        memoryWaiting: undefined,
        memoryOverrideRequestedAt: undefined,
        queueMessage: undefined,
        ...(waiting && Number.isFinite(Date.parse(job.agentRuntimeDeadlineAt || "")) ? {
          agentRuntimeDeadlineAt: new Date(Date.parse(job.agentRuntimeDeadlineAt!) + waitedMs).toISOString(),
        } : {}),
        status: "running" as const,
        claimedAt: iso(),
        attempts: job.attempts + 1,
        revision: jobRevision(job) + 1,
        updatedAt: iso(),
      };
      const now = new Date();
      const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
      const leaseToken = randomUUID();
      db.prepare(
        "DELETE FROM job_leases WHERE job_id = ? AND expires_at <= ?",
      ).run(claimed.id, now.toISOString());
      const lease = db
        .prepare(
          `INSERT OR IGNORE INTO job_leases
         (job_id, worker_id, lease_token, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run(claimed.id, workerId, leaseToken, expiresAt, now.toISOString());
      if (!lease.changes) continue;
      const result = db
        .prepare(
          `UPDATE jobs SET data = ?, status = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'
           AND COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) = ?`,
        )
        .run(
          JSON.stringify(claimed),
          claimed.status,
          claimed.updatedAt,
          claimed.id,
          jobRevision(job),
        );
      if (result.changes) {
        if (job.memoryWaiting || job.memoryOverrideRequestedAt) {
          updateChat(job.chatId, { queueMessage: null, runStatus: "running" }, job.userId);
        }
        syncHandoffForJob(claimed);
        return {
          ...claimed,
          leaseOwner: workerId,
          leaseToken,
          leaseExpiresAt: expiresAt,
        };
      }
      db.prepare(
        "DELETE FROM job_leases WHERE job_id = ? AND lease_token = ?",
      ).run(claimed.id, leaseToken);
    }
  });
}

export function isJobLeaseActive(
  jobId: string,
  workerId: string,
  leaseToken: string,
  at = iso(),
) {
  if (!jobId.trim() || !workerId.trim() || !leaseToken.trim()) return false;
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM job_leases
     WHERE job_id = ? AND worker_id = ? AND lease_token = ? AND expires_at > ?`,
      )
      .get(jobId, workerId, leaseToken, at),
  );
}

function hasActiveWorkerLease(
  db: ReturnType<typeof getDatabase>,
  jobId: string,
  now: string,
) {
  const workerId = process.env.AI_CHAT_WORKER_ID?.trim();
  const leaseToken = process.env.AI_CHAT_JOB_LEASE_TOKEN?.trim();
  if (!workerId || !leaseToken) return true;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM job_leases
     WHERE job_id = ? AND worker_id = ? AND lease_token = ? AND expires_at > ?`,
      )
      .get(jobId, workerId, leaseToken, now),
  );
}

export function updateJob(
  id: string,
  patch: Partial<
    Pick<
      AgentJob,
      | "status"
      | "error"
      | "agentId"
      | "claimedAt"
      | "modeId"
      | "resumePrompt"
      | "resumeRequestedAt"
      | "userInputWriterEnded"
      | "userInputResume"
      | "runId"
      | "modelId"
      | "modelParams"
      | "pendingModelId"
      | "pendingModelParams"
      | "modelSwitchRequestedAt"
      | "projectWaitingForHandoffId"
      | "maxRuntimeMs"
      | "agentRuntimeDeadlineAt"
      | "cancellationCause"
      | "subagentAutoReview"
      | "providerRetryCount"
      | "taskContinuationCount"
      | "researchContinuationState"
    >
  > & { providerRateLimit?: ProviderRateLimit },
  options: { expectedRevision?: number; control?: boolean } = {},
) {
  return transaction(() => {
    const db = getDatabase();
    const current = getJob(id);
    if (!current) return null;
    if (!options.control && !hasActiveWorkerLease(db, id, iso())) return null;
    // A late isolated-process exit belongs to the attempt that already released
    // its lease. The supervisor must not overwrite a committed durable pause
    // (or cancel its children) while reporting that exit as a failure.
    if (!options.control && current.status === "queued" && patch.status === "error"
        && (current as AgentJob & { providerRateLimit?: ProviderRateLimit }).providerRateLimit) {
      throw new Error("Deferred provider-limit job cannot fail from a stale worker exit.");
    }
    if (patch.status && !canTransitionJobStatus(current.status, patch.status)) {
      throw new Error(
        `Invalid job state transition: ${current.status} -> ${patch.status}`,
      );
    }
    const expectedRevision = options.expectedRevision ?? jobRevision(current);
    if (expectedRevision !== jobRevision(current)) return null;
    const updated = {
      ...current,
      ...patch,
      revision: expectedRevision + 1,
      updatedAt: iso(),
    };
    const releasesLease = [
      "queued",
      "switching",
      "completed",
      "cancelled",
      "interrupted",
      "error",
    ].includes(updated.status);
    if (releasesLease) {
      delete updated.leaseOwner;
      delete updated.leaseToken;
      delete updated.leaseExpiresAt;
    }
    const result = getDatabase()
      .prepare(
        `UPDATE jobs SET data = ?, status = ?, updated_at = ?
       WHERE id = ? AND status = ?
         AND COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) = ?`,
      )
      .run(
        JSON.stringify(updated),
        updated.status,
        updated.updatedAt,
        id,
        current.status,
        expectedRevision,
      );
    if (!result.changes) return null;
    if (releasesLease)
      db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(id);
    syncHandoffForJob(updated);
    return updated;
  });
}

/** Never requeue a user-input decision while a worker still owns this run. */
export function queueUserInputResume(input: {
  jobId: string;
  heartbeatAt?: string;
  resumePrompt: string;
  questionId?: string;
  progress?: UserInputProgress;
}) {
  return transaction(() => {
    const job = getJob(input.jobId);
    if (!job || ["completed", "cancelled", "queued", "switching"].includes(job.status)) return null;
    const now = iso();
    const activeLease = getDatabase().prepare(
      "SELECT 1 FROM job_leases WHERE job_id = ? AND expires_at > ?",
    ).get(job.id, now);
    const resume = input.questionId && input.progress ? {
      questionId: input.questionId, attempt: job.attempts, progress: input.progress,
    } : undefined;
    const waiting = getDatabase().prepare(
      "SELECT 1 FROM pending_questions WHERE job_id = ? AND status = 'waiting_for_user' UNION ALL SELECT 1 FROM pending_approvals WHERE job_id = ? AND status = 'waiting_for_user' LIMIT 1",
    ).get(job.id, job.id);
    if (waiting || (!job.userInputWriterEnded && (activeLease || !shouldQueueUserInputResume(job.status, input.heartbeatAt)))) {
      // The existing writer may consume the answer normally. Retain it for
      // recovery if its transport died before the still-valid lease expires.
      updateJob(job.id, {
        resumePrompt: input.resumePrompt,
        resumeRequestedAt: now,
        ...(resume ? { userInputResume: resume } : {}),
      }, { expectedRevision: jobRevision(job) });
      return null;
    }
    return updateJob(job.id, {
      status: "queued",
      error: undefined,
      resumePrompt: input.resumePrompt,
      resumeRequestedAt: now,
      userInputWriterEnded: undefined,
      ...(resume ? { userInputResume: resume } : {}),
    }, { expectedRevision: jobRevision(job) });
  });
}

/** Called only after the provider has returned, never while its tool wait is alive. */
export function parkEndedUserInputWriter(jobId: string) {
  return transaction(() => {
    const job = getJob(jobId), db = getDatabase();
    if (!job || !isJobWaitingForUser(job.status) || !hasActiveWorkerLease(db, jobId, iso())) return null;
    appendRunEvent(job.id, job.chatId, job.userId, "status", { status: "waiting_for_user", message: "Waiting for the user's response before resuming the agent." });
    const parked = { ...job, userInputWriterEnded: true, revision: jobRevision(job) + 1, updatedAt: iso() };
    delete parked.leaseOwner; delete parked.leaseToken; delete parked.leaseExpiresAt;
    const changed = db.prepare("UPDATE jobs SET data = ?, updated_at = ? WHERE id = ? AND status = ? AND COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) = ?")
      .run(JSON.stringify(parked), parked.updatedAt, job.id, job.status, jobRevision(job));
    if (!changed.changes) return null;
    db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(job.id);
    return parked;
  });
}

/** The answer route uses the same transaction lock: an answer cannot slip past terminal completion. */
export function commitWithUserInputContinuation(jobId: string, complete: () => void, agentId?: string, assistantMessageId?: string) {
  return transaction(() => {
    if (parkEndedUserInputWriter(jobId)) return "waiting" as const;
    const job = getJob(jobId);
    if (!job || job.status !== "running") return "stopped" as const;
    const resume = job.userInputResume;
    if (resume && resume.attempt < job.attempts && assistantMessageId) {
      const message = getChat(job.chatId, job.userId)?.messages.find(item => item.id === assistantMessageId);
      if (!hasUserInputResponse(message)) {
        throw new Error("The agent ended without responding to your saved answer. Retry the run.");
      }
    }
    if (resume && resume.attempt === job.attempts) {
      const chat = getChat(job.chatId, job.userId);
      const progress = userInputProgress(chat?.messages ?? [], resume.progress.messageId);
      if (progress.signature === resume.progress.signature) {
        updateChat(job.chatId, { runStatus: "running", pendingQuestion: null, ...(agentId ? { agentId } : {}) }, job.userId);
        appendRunEvent(job.id, job.chatId, job.userId, "status", { status: "resuming", message: "Continuing with your saved answer." });
        const queued = updateJob(job.id, { status: "queued", userInputWriterEnded: undefined, ...(agentId ? { agentId } : {}) },
          { expectedRevision: jobRevision(job) });
        if (!queued) throw new Error("Could not queue the saved user answer.");
        return "queued" as const;
      }
    }
    complete();
    return "completed" as const;
  });
}

/** Release a live waiter only after all requests for its run have been resolved. */
export function releaseUserInputWait(jobId: string) {
  return transaction(() => {
    const job = getJob(jobId);
    if (!job || !["waiting_input", "waiting_for_user"].includes(job.status)) return null;
    const db = getDatabase();
    const waiting = db.prepare(
      `SELECT 1 FROM pending_approvals WHERE job_id = ? AND status = 'waiting_for_user'
       UNION ALL
       SELECT 1 FROM pending_questions WHERE job_id = ? AND status = 'waiting_for_user'
       LIMIT 1`,
    ).get(jobId, jobId);
    if (waiting) return null;
    return updateJob(jobId, { status: "running" }, { expectedRevision: jobRevision(job) });
  });
}

/** Safe diagnostic snapshot: lease tokens are compared but never returned. */
export function jobLeaseDiagnostics(id: string) {
  const db = getDatabase();
  const lease = db.prepare(
    "SELECT worker_id, lease_token, expires_at, updated_at FROM job_leases WHERE job_id = ?",
  ).get(id) as { worker_id: string; lease_token: string; expires_at: string; updated_at: string } | undefined;
  const checkedAt = iso();
  const expectedWorkerId = process.env.AI_CHAT_WORKER_ID?.trim();
  const expectedToken = process.env.AI_CHAT_JOB_LEASE_TOKEN?.trim();
  const workerMatches = lease && expectedWorkerId ? lease.worker_id === expectedWorkerId : null;
  const tokenMatches = lease && expectedToken ? lease.lease_token === expectedToken : null;
  return {
    checkedAt,
    jobStatus: getJob(id)?.status ?? null,
    leaseState: !lease ? "missing" : workerMatches === false ? "worker_mismatch"
      : tokenMatches === false ? "token_mismatch"
        : lease.expires_at <= checkedAt ? "expired" : "active",
    expectedWorkerId: expectedWorkerId ?? null,
    actualWorkerId: lease?.worker_id ?? null,
    workerMatches,
    tokenMatches,
    expiresAt: lease?.expires_at ?? null,
    lastRenewedAt: lease?.updated_at ?? null,
    expiredForMs: lease ? Math.max(0, Date.now() - Date.parse(lease.expires_at)) : null,
  };
}

export function touchJob(id: string) {
  const current = getJob(id);
  if (!current || !["running", "waiting_input", "waiting_for_user"].includes(current.status)) return current;
  const updatedAt = iso();
  try {
    return transaction(() => {
      const db = getDatabase();
      const workerId = process.env.AI_CHAT_WORKER_ID?.trim();
      const leaseToken = process.env.AI_CHAT_JOB_LEASE_TOKEN?.trim();
      const expiresAt = new Date(
        Date.now() + DEFAULT_JOB_LEASE_MS,
      ).toISOString();
      if (workerId && leaseToken) {
        const renewed = db
          .prepare(
            `UPDATE job_leases
           SET expires_at = ?, updated_at = ?
           WHERE job_id = ? AND worker_id = ? AND lease_token = ? AND expires_at > ?`,
          )
          .run(expiresAt, updatedAt, id, workerId, leaseToken, updatedAt);
        if (!renewed.changes) return null;
      }
      // Update only the heartbeat timestamp in JSON. Rewriting the entire row from
      // a stale in-memory snapshot can erase a model-switch request written by
      // the API process between getJob() and this heartbeat.
      const updated = db
        .prepare(
          `UPDATE jobs
         SET data = json_set(
           data,
           '$.updatedAt', ?,
           '$.revision', COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) + 1
         ),
         updated_at = ?
         WHERE id = ? AND status IN ('running', 'waiting_input', 'waiting_for_user')`,
        )
        .run(updatedAt, updatedAt, id);
      return updated.changes ? getJob(id) || { ...current, updatedAt } : null;
    });
  } catch (error) {
    // This runs from a timer. Missing one liveness heartbeat is harmless;
    // throwing from setInterval would be an uncaught worker exception.
    if (isSqliteBusyError(error)) {
      console.warn(`[jobs] sqlite busy; skipped heartbeat for ${id}`);
      return current;
    }
    throw error;
  }
}

export function reapExpiredJobLeases(now = iso()) {
  return transaction(() => {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT j.data
       FROM job_leases l
       JOIN jobs j ON j.id = l.job_id
       WHERE l.expires_at <= ? AND j.status = 'running'`,
      )
      .all(now);
    const requeued: AgentJob[] = [];
    for (const row of rows) {
      const job = parseData<AgentJob>(row);
      if (!job) continue;
      const updated = {
        ...job,
        status: "queued" as const,
        error: undefined,
        resumePrompt: job.resumePrompt ||
          "The worker lease expired. Resume from the last saved agent state without repeating completed tool calls.",
        resumeRequestedAt: now,
        revision: jobRevision(job) + 1,
        updatedAt: now,
      };
      delete updated.leaseOwner;
      delete updated.leaseToken;
      delete updated.leaseExpiresAt;
      const result = db
        .prepare(
          `UPDATE jobs SET data = ?, status = 'queued', updated_at = ?
         WHERE id = ? AND status = 'running'
           AND COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) = ?`,
        )
        .run(JSON.stringify(updated), now, updated.id, jobRevision(job));
      if (!result.changes) continue;
      db.prepare("DELETE FROM job_leases WHERE job_id = ?").run(updated.id);
      requeued.push(updated);
    }
    return requeued;
  });
}

export function recoverStaleJobs(maxAgeMs = 15 * 60 * 1000) {
  const jobs = listJobs();
  const cutoff = Date.now() - Math.max(0, maxAgeMs);
  const queued: AgentJob[] = [];
  const resumed: AgentJob[] = [];
  const interrupted: AgentJob[] = [];
  for (const job of jobs) {
    if (job.status === "queued") {
      queued.push(job);
      continue;
    }
    if (job.status === "switching") {
      const updated = updateJob(job.id, {
        status: "queued",
        error: undefined,
        resumePrompt:
          job.resumePrompt ||
          "Resume the model handoff from the last saved state without repeating completed work.",
        resumeRequestedAt: iso(),
      });
      if (updated) {
        queued.push(updated);
        resumed.push(updated);
      }
      continue;
    }
    if (job.status !== "running") continue;
    const updatedAt = Date.parse(job.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > cutoff) continue;
    const pendingQuestion = getDatabase()
      .prepare(
        "SELECT question_id FROM pending_questions WHERE job_id = ? AND status = 'waiting_for_user' LIMIT 1",
      )
      .get(job.id);
    const pendingRuntimeApproval = getDatabase()
      .prepare("SELECT id FROM pending_approvals WHERE job_id = ? AND status = 'waiting_for_user' LIMIT 1")
      .get(job.id);
    if (pendingQuestion || pendingRuntimeApproval) {
      updateJob(job.id, {
        status: "waiting_input",
        error: "Paused for user input after worker restart.",
      });
      updateChat(
        job.chatId,
        { runStatus: "waiting_for_user", runUpdatedAt: iso() },
        job.userId,
      );
      continue;
    }
    const updated = updateJob(job.id, {
      status: "queued",
      error: undefined,
      resumePrompt:
        "The worker restarted. Continue from the last saved agent state. Do not repeat completed tool calls or rewrite finished work.",
      resumeRequestedAt: iso(),
    });
    updateChat(
      job.chatId,
      {
        runStatus: "running",
        runUpdatedAt: iso(),
        badge: null,
      },
      job.userId,
    );
    if (updated) {
      queued.push(updated);
      resumed.push(updated);
    }
  }
  return { queued, resumed, interrupted };
}

export function appendRunEvent(
  jobId: string,
  chatId: string,
  userId: string | undefined,
  event: string,
  data: unknown,
) {
  const createdAt = iso();
  const db = getDatabase();
  if (!hasActiveWorkerLease(db, jobId, createdAt)) {
    return {
      id: 0,
      sequence: 0,
      jobId,
      chatId,
      event,
      data,
      createdAt,
      persisted: false as const,
      dropped: "stale_lease" as const,
    };
  }
  const encoded = serializeRunEventData(data);
  let result: { lastInsertRowid: number | bigint };
  try {
    result = withSqliteRetry(
      () =>
        db
          .prepare(
            "INSERT INTO run_events (job_id, chat_id, user_id, event, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(jobId, chatId, userId ?? null, event, encoded, createdAt),
      3,
    );
  } catch (error) {
    // A transient telemetry/event-store lock must never terminate the agent.
    // The durable assistant checkpoint remains the source of truth and lets
    // the UI recover on its next chat refresh even if one live event is lost.
    if (isSqliteBusyError(error)) {
      console.warn(
        `[run-events] sqlite busy; dropped ${event} event for ${jobId}`,
      );
      return {
        id: 0,
        sequence: 0,
        jobId,
        chatId,
        event,
        data,
        createdAt,
        persisted: false as const,
      };
    }
    throw error;
  }
  if (Date.now() - lastRunEventCleanupAt >= 30_000) {
    try {
      withSqliteRetry(
        () =>
          db
            .prepare(
              `DELETE FROM run_events
         WHERE id <= (SELECT MAX(id) - ? FROM run_events)`,
            )
            .run(RUN_EVENT_RETENTION),
        2,
      );
      lastRunEventCleanupAt = Date.now();
    } catch (error) {
      if (!isSqliteBusyError(error)) throw error;
      // Cleanup is maintenance only; retry on a later event.
    }
  }
  const sequence = Number(result.lastInsertRowid);
  return {
    id: sequence,
    sequence,
    jobId,
    chatId,
    event,
    data,
    createdAt,
    persisted: true as const,
  };
}

export function listRunEvents(
  chatId: string,
  userId: string | undefined,
  after = 0,
  jobId?: string,
  limit = 500,
) {
  // Keep equality predicates visible to SQLite so the existing
  // (chat_id, job_id, id) index can seek directly into this run.
  const params: Array<string | number> = [chatId, after];
  if (jobId !== undefined) params.push(jobId);
  if (userId !== undefined) params.push(userId);
  params.push(Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 500);
  const rows = getDatabase()
    .prepare(
      `SELECT id, id as sequence, job_id as jobId, chat_id as chatId, event, data, created_at as createdAt
     FROM run_events
     WHERE chat_id = ? AND id > ?
       ${jobId !== undefined ? "AND job_id = ?" : ""}
       ${userId !== undefined ? "AND user_id = ?" : ""}
     ORDER BY id ASC
     LIMIT ?`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    data: JSON.parse(String(row.data)),
  }));
}

export function requeueSwitchingJob(id: string) {
  const updatedAt = iso();
  const result = getDatabase()
    .prepare(
      `UPDATE jobs
     SET data = json_set(
           data,
           '$.status', 'queued',
           '$.updatedAt', ?,
           '$.revision', COALESCE(CAST(json_extract(data, '$.revision') AS INTEGER), 0) + 1
         ),
         status = 'queued',
         updated_at = ?
     WHERE id = ? AND status = 'switching'`,
    )
    .run(updatedAt, updatedAt, id);
  return result.changes ? getJob(id) : null;
}


function modelParamsEqual(
  left: Array<{ id: string; value: string }> | undefined,
  right: Array<{ id: string; value: string }> | undefined,
) {
  const normalize = (items: Array<{ id: string; value: string }> | undefined) =>
    (items || [])
      .map((item) => ({ id: item.id.trim(), value: item.value }))
      .filter((item) => item.id)
      .sort((a, b) => a.id.localeCompare(b.id) || a.value.localeCompare(b.value));
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((item, index) =>
    item.id === b[index]?.id && item.value === b[index]?.value,
  );
}

export function requestJobModelSwitch(
  chatId: string,
  userId: string | undefined,
  modelId: string,
  modelParams?: Array<{ id: string; value: string }>,
) {
  return transaction(() => {
  const job = getActiveJob(chatId, userId);
  if (!job) return null;
  const chat = getChat(chatId, userId);
  const projectModel = projectModelOverride(chat?.projectId, userId);
  const nextModelId = projectModel?.modelId || modelId.trim();
  if (projectModel) modelParams = projectModel.modelParams;
  if (!nextModelId) return job;

  // A queued/paused job has no active provider stream to interrupt, so the new
  // model can become effective immediately. A running job receives a pending
  // handoff request that its worker observes without changing run status.
  if (job.status !== "running") {
    const changedModel = job.modelId !== nextModelId;
    const resetWait = changedModel && job.status === "queued" && Boolean(job.providerRateLimit);
    const updated = updateJob(job.id, {
      modelId: nextModelId, modelParams,
      pendingModelId: undefined, pendingModelParams: undefined, modelSwitchRequestedAt: undefined,
      ...(resetWait ? {
        providerRateLimit: undefined,
        ...(Number.isFinite(Date.parse(job.agentRuntimeDeadlineAt || "")) && Number.isFinite(Date.parse(job.providerRateLimit?.detectedAt || "")) ? {
          agentRuntimeDeadlineAt: new Date(Date.parse(job.agentRuntimeDeadlineAt!) + Math.max(0, Date.now() - Date.parse(job.providerRateLimit!.detectedAt))).toISOString(),
        } : {}),
        resumePrompt: providerContinuationPrompt(job, `The user switched the model to ${nextModelId} during the previous provider wait.`),
        resumeRequestedAt: iso(),
      } : {}),
    }, { control: true });
    if (updated && resetWait) {
      const timestamp = iso();
      const event: ModelSwitchPart = { type: "model-switch", id: `model-switch:${job.id}:${timestamp}`, fromModelId: job.modelId || "", toModelId: nextModelId, timestamp };
      const messageId = randomUUID();
      const message = appendMessage(chatId, { id: messageId, role: "assistant", content: "", parts: [event] }, userId);
      if (message) appendRunEvent(job.id, chatId, userId, "assistantId", { messageId });
      updateChat(chatId, { runStatus: "running", queueMessage: null }, userId);
      appendRunEvent(job.id, chatId, userId, "run-event", event);
    }
    return updated;
  }
  const requestedParams = modelParams ?? job.modelParams;
  if (job.modelId === nextModelId && modelParamsEqual(job.modelParams, requestedParams)) {
    if (!job.pendingModelId && !job.pendingModelParams && !job.modelSwitchRequestedAt) return job;
    return updateJob(job.id, {
      pendingModelId: undefined,
      pendingModelParams: undefined,
      modelSwitchRequestedAt: undefined,
    }) || job;
  }
  return updateJob(job.id, {
    pendingModelId: nextModelId,
    pendingModelParams: modelParams,
    modelSwitchRequestedAt: iso(),
  }, { control: true });
  });
}

/** Explicit stops cancel the subtree; automatic expiry keeps each child’s own budget. */
export function cancelAgentJob(jobId: string, userId?: string, reason = "Cancellation requested by user.", cause?: "runtime_limit") {
  return transaction(() => {
    const job = getJob(jobId);
    if (!job || (userId !== undefined && job.userId !== userId)) return null;
    // The old attempt's runtime timer may fire during process cleanup after
    // the pause commits. Waiting has no running attempt/budget to expire.
    if (cause === "runtime_limit" && job.status === "queued"
        && (job as AgentJob & { providerRateLimit?: ProviderRateLimit }).providerRateLimit) return job;
    if (!["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(job.status)) {
      // An explicit stop after expiry must still stop the surviving child branch.
      if (!cause && job.cancellationCause === "runtime_limit") cancelChildJobs(job.id, job.userId, reason);
      return job;
    }
    const cancelled = updateJob(job.id, { status: "cancelled", error: reason, cancellationCause: cause }, { control: true });
    if (!cancelled) return null;
    if (cause === "runtime_limit") {
      // Let the existing reconciler collect synchronous children after their sender expires.
      for (const child of listChildJobs(job.id, job.userId)) {
        if (!child.subagentFollowUp && ["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(child.status)) {
          updateJob(child.id, { subagentAutoReview: true }, { control: true });
        }
      }
    } else cancelChildJobs(job.id, job.userId, reason);
    updateChat(job.chatId, { runStatus: "cancelled", runUpdatedAt: iso(), queueMessage: null, pendingQuestion: null, pendingApproval: null }, job.userId);
    appendRunEvent(job.id, job.chatId, job.userId, "done", { status: "cancelled", reason });
    return cancelled;
  });
}
export function requestJobCancel(chatId: string, userId?: string) {
  const job = getActiveParentJob(chatId, userId) || getActiveJob(chatId, userId);
  return job ? cancelAgentJob(job.id, userId) : null;
}

/** Atomically publish the pause before releasing the writer lease. No sleeping worker. */
export function deferProviderLimitedJob(jobId: string, error: unknown, checkpoint?: (event: ProviderWaitPart) => void) {
  // Old schedulers must never claim a deferred job before its reset.
  // New workers advertise support to their isolated job processes.
  if (process.env.NODE_ENV === "production" && process.env.AI_CHAT_PROVIDER_LIMIT_WAITER !== "1") return null;
  const limit = providerRateLimit(error);
  if (!limit) return null;
  return transaction(() => {
    const current = getJob(jobId);
    if (!current || current.status !== "running" || !getProviderLimitResumeEnabled(current.userId)
        || !hasActiveWorkerLease(getDatabase(), jobId, iso())) return null;
    const event: ProviderWaitPart = {
      type: "provider-wait", id: `provider-wait:${current.id}:${limit.detectedAt}`,
      resetAt: limit.resetAt, detectedAt: limit.detectedAt, detail: providerRetryDetail(error),
    };
    checkpoint?.(event);
    appendRunEvent(current.id, current.chatId, current.userId, "run-event", event);
    const message = `Provider usage limit reached. This run resumes automatically at ${limit.resetAt}.`;
    const projected = updateChat(current.chatId, {
      runStatus: "paused", runUpdatedAt: iso(), queueMessage: message,
    }, current.userId);
    if (!projected) return null;
    appendRunEvent(current.id, current.chatId, current.userId, "status", {
      status: "waiting_provider_limit", message, resetAt: limit.resetAt, source: limit.source,
    });
    const updated = updateJob(current.id, {
      status: "queued", error: undefined, providerRateLimit: limit,
      resumePrompt: providerContinuationPrompt(current, "The provider usage limit has reset. Continue this same run."),
      resumeRequestedAt: iso(),
    }, { expectedRevision: jobRevision(current) });
    if (!updated) throw new Error("Provider-limit pause lost its job revision.");
    return updated;
  });
}
