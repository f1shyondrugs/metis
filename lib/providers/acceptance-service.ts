import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, fchownSync, closeSync } from "node:fs";
import path from "node:path";
import { getDatabase, transaction } from "@/lib/sqlite";
import { createChat, updateChat } from "@/lib/db-store";
import { cancelAgentJob, getJob, getJobForMessageId, jobLeaseDiagnostics, listRunEvents } from "@/lib/db-jobs";
import { listChatProviderConnections, listProviderModels, getProviderConnection } from "@/lib/provider-connections";
import { getUserAccess, getUserExecutionIdentity } from "@/lib/user-access";
import { isModelAllowed } from "@/lib/model-access";
import { submitChat } from "@/lib/chat-submit";
import { ensureSafeDirectory, openSafeDirectory, readSafeFile, writeSafeFile } from "@/lib/safe-file-read";
import { listProviderDefinitions } from "./registry";
import { modelKey, type ProviderModel, type ProviderCapabilities } from "./types";
import { buildAcceptanceMatrix, type AcceptanceReport, type AcceptanceTarget, type AcceptanceCheck, type AcceptanceCell } from "./acceptance";
import { AUTOMATED_ACCEPTANCE_CHECKS, ACCEPTANCE_CHECK_LABELS, acceptanceProbeQueue, newAcceptanceChallenge, probePrompt,
  acceptanceVisionImage, verifyAcceptanceProbe, type AcceptanceProbe, type AcceptanceChallenge } from "./acceptance-probes";
import type { Chat } from "@/lib/store";

const now = () => new Date().toISOString();
export class AcceptanceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type ActiveProbe = {
  probe: AcceptanceProbe; challenge: AcceptanceChallenge; messageId: string; chatId: string; jobId?: string;
  deadlineAt: string; lastEventId: number; textEvents: number; textBeforeDone: number;
  terminalSeen: boolean; wasRunning: boolean; cancelRequested: boolean; assistantId?: string;
  executionIdentity?: { providerId: string; connectionId: string; modelId: string };
  textSegments?: Array<{ length: number; hash: string }>;
  files?: { input: string; output: string };
};
type StoredRun = {
  report: AcceptanceReport; selectedChecks: AcceptanceCheck[]; queue: AcceptanceProbe[]; cursor: number;
  active?: ActiveProbe; chats: Record<string, string>; baseline: Record<string, AcceptanceChallenge>;
  connectionVersions: Record<string, string>;
};
const deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
function database() {
  const db = getDatabase();
  db.exec("CREATE TABLE IF NOT EXISTS provider_acceptance_reports (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS provider_acceptance_owner ON provider_acceptance_reports(owner_id, updated_at DESC)");
  return db;
}
function load(ownerId: string, id: string): StoredRun {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new AcceptanceError("Report not found.", 404);
  const row = database().prepare("SELECT data FROM provider_acceptance_reports WHERE id=? AND owner_id=?").get(id, ownerId) as { data: string } | undefined;
  if (!row) throw new AcceptanceError("Report not found.", 404);
  return JSON.parse(row.data) as StoredRun;
}
function save(ownerId: string, run: StoredRun) {
  run.report.updatedAt = now();
  database().prepare("UPDATE provider_acceptance_reports SET updated_at=?, data=? WHERE id=? AND owner_id=?")
    .run(run.report.updatedAt, JSON.stringify(run), run.report.id, ownerId);
}
function change<T>(ownerId: string, id: string, action: (run: StoredRun) => T): T {
  return transaction(() => { const run = load(ownerId, id); const result = action(run); save(ownerId, run); return result; });
}
let revision: string | undefined;
export function acceptanceRevision() {
  if (revision) return revision;
  const root = process.env.AI_CHAT_SERVER_SOURCE_DIR || process.cwd();
  let git = "unknown";
  try { git = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Source packages may omit Git. */ }
  const hash = createHash("sha256");
  for (const file of ["lib/providers/acceptance.ts", "lib/providers/acceptance-service.ts", "lib/providers/acceptance-probes.ts",
    "lib/providers/registry.ts", "lib/providers/runner.ts", "lib/worker-runner.ts", "lib/agent-runtime.ts",
    "lib/providers/adapters/ai-sdk.ts", "lib/providers/adapters/codex.ts", "lib/providers/adapters/claude.ts",
    "lib/providers/adapters/antigravity.ts", "lib/providers/adapters/acp-cli.ts", "lib/providers/adapters/provider-support.ts",
    "lib/providers/discovery.ts", "lib/providers/cursor-runtime.ts",
    "lib/chat-submit.ts", "package.json", "pnpm-lock.yaml"]) {
    try { hash.update(file); hash.update(readFileSync(path.join(root, file))); } catch { hash.update("missing:" + file); }
  }
  revision = git.slice(0, 12) + ":" + hash.digest("hex").slice(0, 20);
  return revision;
}
export function acceptanceMatrixForOwner(ownerId: string): AcceptanceTarget[] {
  const connections = listChatProviderConnections(ownerId);
  const models: ProviderModel[] = connections.flatMap(connection => listProviderModels(connection.id).map(model => ({
    id: model.id, displayName: model.displayName, key: modelKey(connection.providerKey, model.id, connection.id),
    providerKey: connection.providerKey, providerName: connection.providerKey, connectionId: connection.id,
    source: "discovered" as const,
    // Do not route through UI discovery merging, which may add broad compatibility defaults.
    capabilities: Object.fromEntries(Object.entries(model.capabilities || {}).filter(([, value]) => typeof value === "boolean")) as Partial<ProviderCapabilities>,
  })));
  const matrix = buildAcceptanceMatrix({ providers: listProviderDefinitions(), connections, models });
  if (matrix.length > 5000) throw new AcceptanceError("The matrix is too large. Narrow the configured model catalog before creating a report.", 413);
  return matrix;
}
export function acceptanceOverview(ownerId: string) {
  const row = database().prepare("SELECT data FROM provider_acceptance_reports WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1").get(ownerId) as { data: string } | undefined;
  return {
    matrix: acceptanceMatrixForOwner(ownerId), revision: acceptanceRevision(),
    checks: Object.entries(ACCEPTANCE_CHECK_LABELS).map(([id, label]) => ({ id, label, automated: AUTOMATED_ACCEPTANCE_CHECKS.includes(id as AcceptanceCheck) })),
    ...(row ? { latest: getAcceptanceReport(ownerId, (JSON.parse(row.data) as StoredRun).report.id).report } : {}),
  };
}
function setCells(target: AcceptanceTarget, cells: AcceptanceCell[]) {
  for (const cell of cells) {
    const index = target.cells.findIndex(existing => existing.check === cell.check);
    if (index >= 0) target.cells[index] = cell;
  }
}
function blockProbe(run: StoredRun, probe: AcceptanceProbe, reason: string) {
  const target = run.report.targets.find(item => item.id === probe.targetId);
  if (target) setCells(target, probe.checks.map(check => ({ check, status: "blocked", reason, checkedAt: now() })));
}
export function createAcceptanceReport(ownerId: string, body: unknown): AcceptanceReport {
  if (!body || typeof body !== "object") throw new AcceptanceError("A test selection is required.");
  const input = body as Record<string, unknown>;
  if (input.confirmLive !== true) throw new AcceptanceError("Explicit live-test confirmation is required. Tests can consume paid provider quota.");
  const { maxTurns, timeoutMs } = input;
  if (!Number.isInteger(maxTurns) || Number(maxTurns) < 1 || Number(maxTurns) > 20) throw new AcceptanceError("maxTurns must be an integer from 1 to 20.");
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 15000 || Number(timeoutMs) > 300000) throw new AcceptanceError("timeoutMs must be an integer from 15000 to 300000.");
  if (!Array.isArray(input.targetIds) || input.targetIds.length < 1 || input.targetIds.length > 20
    || !input.targetIds.every(id => typeof id === "string")) throw new AcceptanceError("Select 1 to 20 matrix targets.");
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 13
    || !input.checks.every(check => AUTOMATED_ACCEPTANCE_CHECKS.includes(check as AcceptanceCheck))) throw new AcceptanceError("Select implemented automated checks.");
  const targets = acceptanceMatrixForOwner(ownerId);
  const ids = [...new Set(input.targetIds as string[])];
  if (ids.some(id => !targets.some(target => target.id === id))) throw new AcceptanceError("A target is unavailable or belongs to another account.", 404);
  const checks = [...new Set(input.checks as AcceptanceCheck[])];
  const connectionVersions: Record<string, string> = {};
  for (const target of targets.filter(target => ids.includes(target.id))) {
    if (target.connectionId) {
      const connection = getProviderConnection(target.connectionId, ownerId);
      if (connection) connectionVersions[connection.id] = connection.updatedAt;
    }
  }
  const timestamp = now();
  const report: AcceptanceReport = {
    schemaVersion: 1, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp,
    mode: "live", state: "planned", revision: acceptanceRevision(), targets,
    limits: { maxTurns: Number(maxTurns), timeoutMs: Number(timeoutMs) }, turnsUsed: 0,
    notes: [
      "Creating or viewing this report does not call a model. Explicit Next/Start actions submit private test chats through authenticated Metis chat submission and the normal worker.",
      "The turn limit counts submitted Metis jobs, not billable upstream requests. Tool loops, SDK reconnects and the account's existing retry policy may use additional provider requests. This is not a currency budget.",
      "Test chats are private, outside projects, and expire after 24 hours. Only randomized test fixtures are created in a dedicated acceptance subdirectory of the account workspace. No provider credentials are exported.",
      "Streaming checks incremental durable runtime events, not browser paint or network SSE delivery. Interactive input, model switching, browser, skills, subagents, audio and cross-account isolation are not certified by this live suite.",
      "Blocked, unsupported and untested cases are never passes. Cached/catalog metadata and a successful connection test are not live verification. Every offered model and authentication path remains separately visible.",
      "Selected targets: " + ids.join(", ") + ". Selected checks: " + checks.join(", ") + ".",
    ],
  };
  const run: StoredRun = { report, selectedChecks: checks, queue: acceptanceProbeQueue(targets, ids, checks),
    cursor: 0, chats: {}, baseline: {}, connectionVersions };
  transaction(() => {
    const pending = database().prepare("SELECT COUNT(*) AS count FROM provider_acceptance_reports WHERE owner_id=? AND json_extract(data, '$.report.state') IN ('planned','running')").get(ownerId) as { count: number };
    if (pending.count >= 3) throw new AcceptanceError("Finish or cancel an existing acceptance run before creating another.", 409);
    database().prepare("INSERT INTO provider_acceptance_reports (id,owner_id,updated_at,data) VALUES (?,?,?,?)")
      .run(report.id, ownerId, timestamp, JSON.stringify(run));
  });
  return report;
}
function readCanonicalTestChat(ownerId: string, chatId: string): Chat | undefined {
  // These are small synthetic chats. Read canonical SQLite JSON, not the in-process chat cache.
  const row = getDatabase().prepare("SELECT data FROM chats WHERE id=? AND owner_id=?").get(chatId, ownerId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as Chat : undefined;
}
function observe(run: StoredRun, ownerId: string) {
  const active = run.active;
  if (!active) return;
  const target = run.report.targets.find(item => item.id === active.probe.targetId)!;
  const job = active.jobId ? getJob(active.jobId) : getJobForMessageId(active.chatId, active.messageId);
  if (!job) {
    if (Date.now() >= Date.parse(active.deadlineAt)) {
      blockProbe(run, active.probe, "Submission could not be confirmed before its deadline. It was not retried.");
      delete run.active;
    }
    return;
  }
  if (job.userId !== ownerId || job.chatId !== active.chatId || job.providerAcceptance?.reportId !== run.report.id) {
    blockProbe(run, active.probe, "The recorded job identity did not match this account and report.");
    delete run.active;
    return;
  }
  active.jobId = job.id;
  // Incrementally process a bounded page; repeated polls cannot double-count events.
  const events = listRunEvents(active.chatId, ownerId, active.lastEventId, job.id, 500) as Array<{ id: number; event: string; data: unknown }>;
  for (const event of events) {
    active.lastEventId = Number(event.id);
    const data = event.data as Record<string, unknown> | null;
    if (event.event === "assistantId" && typeof data?.messageId === "string") active.assistantId = data.messageId;
    if (event.event === "providerExecution" && typeof data?.providerId === "string" && typeof data.connectionId === "string" && typeof data.modelId === "string") active.executionIdentity = { providerId: data.providerId, connectionId: data.connectionId, modelId: data.modelId };
    if (event.event === "text" && typeof data?.text === "string" && data.text.length > 0) {
      active.textEvents++;
      if (!active.terminalSeen) {
        active.textBeforeDone++;
        active.textSegments ??= [];
        if (active.textSegments.length < 1024) active.textSegments.push({ length: data.text.length, hash: createHash("sha256").update(data.text).digest("hex") });
      }
    }
    if (event.event === "done") active.terminalSeen = true;
  }
  active.wasRunning ||= job.status === "running";
  if (active.probe.kind === "cancellation" && job.status === "running" && active.textEvents > 0 && !active.cancelRequested) {
    cancelAgentJob(job.id, ownerId, "Provider acceptance cancellation probe.");
    active.cancelRequested = true;
  }
  if (["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(job.status)) {
    if (Date.now() >= Date.parse(active.deadlineAt) || job.providerRateLimit || job.status === "waiting_input" || job.status === "waiting_for_user") {
      cancelAgentJob(job.id, ownerId, "Provider acceptance blocked or deadline reached.");
      blockProbe(run, active.probe, job.providerRateLimit ? "Provider quota/reset wait blocked the test; the waiting job was cancelled."
        : "The test deadline, queue admission or required interactive input prevented completion.");
      delete run.active;
    }
    return;
  }
  if (events.length === 500) return; // Drain remaining event pages before verifying.
  const leaseReleased = jobLeaseDiagnostics(job.id).leaseState !== "active";
  if (job.status === "cancelled" && !leaseReleased && Date.now() < Date.parse(active.deadlineAt) + 15000) return;
  const chat = readCanonicalTestChat(ownerId, active.chatId);
  const message = active.assistantId ? chat?.messages.find(item => item.id === active.assistantId) : chat?.messages.filter(item => item.role === "assistant").at(-1);
  let position = 0;
  const streamedAnswerMatches = Boolean(message && active.textSegments?.length && active.textSegments.length === active.textBeforeDone && active.textSegments.every(segment => {
    const fragment = message.content.slice(position, position + segment.length);
    position += segment.length;
    return createHash("sha256").update(fragment).digest("hex") === segment.hash;
  }) && position === message.content.length);
  let fileOutput: string | undefined;
  if (active.files) try { fileOutput = readSafeFile(active.files.output, 4096).toString("utf8"); } catch { /* Missing/unsafe output fails. */ }
  if (active.probe.kind === "cancellation" && job.status === "completed" && !active.cancelRequested) blockProbe(run, active.probe, "The generation completed before a running-turn cancellation could be observed.");
  else if (run.report.state === "cancelled") blockProbe(run, active.probe, "The user stopped this test run before verification finished.");
  else setCells(target, verifyAcceptanceProbe({ probe: active.probe, target, challenge: active.challenge, checkedAt: now(), observation: {
    job, message, persistedMessage: message, streamedAnswerMatches, fixturePaths: active.files, textEvents: active.textEvents, textBeforeDone: active.textBeforeDone,
    wasRunning: active.wasRunning, cancelRequested: active.cancelRequested, leaseReleased, fileOutput, executionIdentity: active.executionIdentity,
  } }));
  if (active.probe.kind === "baseline" && job.status === "completed" && message?.content.includes(active.challenge.nonce)) run.baseline[target.id] = active.challenge;
  delete run.active;
}
function scheduleDeadline(ownerId: string, id: string, jobId: string, deadlineAt: string) {
  if (deadlineTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    deadlineTimers.delete(jobId);
    try {
      change(ownerId, id, run => {
        if (run.active?.jobId === jobId) {
          const job = getJob(jobId);
          if (job?.userId === ownerId && job.providerAcceptance?.reportId === id) cancelAgentJob(jobId, ownerId, "Provider acceptance deadline reached.");
        }
      });
    } catch { /* A missing report must not touch another run. Worker deadline remains authoritative. */ }
  }, Math.max(1, Date.parse(deadlineAt) - Date.now()));
  timer.unref?.();
  deadlineTimers.set(jobId, timer);
}
export function getAcceptanceReport(ownerId: string, id: string) {
  return change(ownerId, id, run => {
    observe(run, ownerId);
    if (!run.active && run.report.state === "running" && run.cursor >= run.queue.length) run.report.state = "completed";
    if (run.active?.jobId) scheduleDeadline(ownerId, id, run.active.jobId, run.active.deadlineAt);
    return { report: run.report, active: Boolean(run.active) };
  });
}
function fixtureFiles(ownerId: string, reportId: string, challenge: AcceptanceChallenge) {
  const access = getUserAccess(ownerId);
  const identity = getUserExecutionIdentity(ownerId);
  const base = path.join(access.workspaceRoot, ".metis-provider-acceptance", reportId);
  const directory = path.join(base, randomUUID());
  for (const dir of [path.join(access.workspaceRoot, ".metis-provider-acceptance"), base, directory]) {
    ensureSafeDirectory(dir, { mode: 0o700 });
    if (typeof identity?.uid === "number" && typeof identity?.gid === "number") {
      const fd = openSafeDirectory(dir);
      try { fchownSync(fd, identity.uid, identity.gid); } finally { closeSync(fd); }
    }
  }
  const files = { input: path.join(directory, "input.json"), output: path.join(directory, "output.json") };
  writeSafeFile(files.input, JSON.stringify({ nonce: challenge.nonce, numbers: challenge.numbers }), { exclusive: true, mode: 0o644 });
  return files;
}
export async function advanceAcceptanceReport(ownerId: string, id: string, request: Request) {
  const reserved = change(ownerId, id, run => {
    observe(run, ownerId);
    if (run.report.state === "completed" || run.report.state === "cancelled" || run.active) return undefined;
    if (run.report.revision !== acceptanceRevision()) throw new AcceptanceError("Code or SDK revision changed. Create a new report.", 409);
    run.report.state = "running";
    while (run.cursor < run.queue.length) {
      const probe = run.queue[run.cursor++];
      const target = run.report.targets.find(item => item.id === probe.targetId)!;
      const connection = target.connectionId ? getProviderConnection(target.connectionId, ownerId) : null;
      if (!connection?.enabled || connection.updatedAt !== run.connectionVersions[connection.id]
        || connection.providerKey !== target.providerKey || connection.authType !== target.authType) {
        blockProbe(run, probe, "The exact connection is missing, disabled or changed. Refresh the matrix and create a new report.");
        continue;
      }
      if (!target.modelKey || !isModelAllowed(ownerId, target.modelKey)) {
        blockProbe(run, probe, "The selected model is not available to this account.");
        continue;
      }
      if (probe.kind === "continuation" && !run.baseline[target.id]) {
        blockProbe(run, probe, "Continuation requires a successfully completed baseline turn in the same chat.");
        continue;
      }
      if (run.report.turnsUsed >= run.report.limits.maxTurns) {
        blockProbe(run, probe, "The confirmed logical-turn limit was exhausted. No further job was submitted.");
        continue;
      }
      const challenge = probe.kind === "continuation" ? run.baseline[target.id] : newAcceptanceChallenge();
      let chatId = run.chats[target.id];
      if (!chatId || probe.kind === "cancellation") {
        const chat = createChat("Provider acceptance - " + target.providerName, undefined, ownerId, { id: target.modelKey }, { incognito: true });
        // A fresh restricted test chat; never elevate another chat's permissions.
        updateChat(chat.id, { runtimeMode: "auto", sessionState: { modeId: "agent" } }, ownerId);
        chatId = chat.id;
        if (probe.kind !== "cancellation") run.chats[target.id] = chatId;
      }
      const active: ActiveProbe = { probe, challenge, chatId, messageId: randomUUID(),
        deadlineAt: new Date(Date.now() + run.report.limits.timeoutMs).toISOString(),
        lastEventId: 0, textEvents: 0, textBeforeDone: 0, terminalSeen: false, wasRunning: false, cancelRequested: false };
      run.active = active;
      run.report.turnsUsed++;
      return { active, timeoutMs: run.report.limits.timeoutMs };
    }
    run.report.state = "completed";
    return undefined;
  });
  if (!reserved) return getAcceptanceReport(ownerId, id);
  const { active, timeoutMs } = reserved;
  try {
    let attachments: Array<{ name: string; mimeType: string; data: string }> | undefined;
    if (active.probe.kind === "mcp") active.files = fixtureFiles(ownerId, id, active.challenge);
    if (active.probe.kind === "vision") attachments = [{ name: "color-grid.png", mimeType: "image/png", data: await acceptanceVisionImage(active.challenge) }];
    change(ownerId, id, run => {
      if (run.report.state !== "running" || run.active?.messageId !== active.messageId) throw new AcceptanceError("The test run was stopped.", 409);
      run.active = active;
    });
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    const response = await submitChat(new Request(new URL("/api/chat", request.url), {
      method: "POST", headers, body: JSON.stringify({ chatId: active.chatId, messageId: active.messageId,
        modelId: load(ownerId, id).report.targets.find(item => item.id === active.probe.targetId)!.modelKey,
        message: probePrompt(active.probe.kind, active.challenge, active.files), ...(attachments ? { attachments } : {}) }),
    }), {
      maxRuntimeMs: timeoutMs, providerAcceptance: { reportId: id, deadlineAt: active.deadlineAt },
      beforeEnqueue: () => {
        const current = load(ownerId, id);
        if (current.report.state !== "running" || current.active?.messageId !== active.messageId) throw new AcceptanceError("The test run was stopped.", 409);
        if (Date.now() >= Date.parse(active.deadlineAt)) throw new AcceptanceError("The test deadline expired before submission.", 409);
      },
    });
    const submitted = await response.json() as { jobId?: string };
    change(ownerId, id, run => {
      if (!response.ok || !submitted.jobId) {
        blockProbe(run, active.probe, "Authenticated chat submission was rejected (HTTP " + response.status + "). No retry was attempted.");
        if (run.active?.messageId === active.messageId) delete run.active;
        return;
      }
      const job = getJob(submitted.jobId);
      if (!job || job.userId !== ownerId || job.chatId !== active.chatId || job.providerAcceptance?.reportId !== id) throw new AcceptanceError("Submitted job identity could not be verified.", 409);
      if (run.report.state === "cancelled") cancelAgentJob(job.id, ownerId, "Provider acceptance was stopped during submission.");
      if (run.active?.messageId === active.messageId) run.active.jobId = job.id;
      scheduleDeadline(ownerId, id, job.id, active.deadlineAt);
    });
  } catch {
    change(ownerId, id, run => {
      // Reconcile unknown submission outcomes by the stable message ID. Never submit twice.
      const job = getJobForMessageId(active.chatId, active.messageId);
      if (job?.userId === ownerId && job.providerAcceptance?.reportId === id) {
        if (run.active?.messageId === active.messageId) run.active.jobId = job.id;
        scheduleDeadline(ownerId, id, job.id, active.deadlineAt);
        if (run.report.state === "cancelled") cancelAgentJob(job.id, ownerId, "Provider acceptance was stopped.");
      } else {
        blockProbe(run, active.probe, "The test fixture or authenticated submission could not be prepared. No provider retry was attempted.");
        if (run.active?.messageId === active.messageId) delete run.active;
      }
    });
  }
  return getAcceptanceReport(ownerId, id);
}
export function cancelAcceptanceReport(ownerId: string, id: string) {
  return change(ownerId, id, run => {
    if (run.report.state === "completed") return { report: run.report, active: false };
    run.report.state = "cancelled";
    const active = run.active;
    if (active) {
      const job = active.jobId ? getJob(active.jobId) : getJobForMessageId(active.chatId, active.messageId);
      if (job?.userId === ownerId && job.chatId === active.chatId && job.providerAcceptance?.reportId === id) cancelAgentJob(job.id, ownerId, "Provider acceptance stopped by user.");
    }
    for (const probe of run.queue.slice(run.cursor)) blockProbe(run, probe, "The user stopped the test run before this probe was submitted.");
    run.cursor = run.queue.length;
    observe(run, ownerId);
    return { report: run.report, active: Boolean(run.active) };
  });
}
