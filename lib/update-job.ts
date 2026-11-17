import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import {
  initializeInstallerUpdateLog,
  installerLogForJob,
  installerExitCode,
  installerProcessIsRunning,
  installerLogIndicatesFailure,
  installerLogIndicatesSuccess,
  installerUpdateIsRunning,
  readInstallerUpdateLog,
  runInstallerUpdate,
  type InstallerUpdateInput,
} from "@/lib/installer-update";
import { historyEntryFromJob, upsertUpdateHistoryEntry, type UpdateJobRange } from "@/lib/update-history";
import { clearMaintenanceState, setMaintenanceState } from "@/lib/maintenance-state";
import { boundInstallerLogLines, readBoundedUpdateJson } from "./installer-update-log";

type UpdateJobResult = {
  tag: string;
  commit?: string;
  method?: "installer" | "package";
  asset: string;
  activeSlot?: ".next-a" | ".next-b";
  preparedSlot?: ".next-a" | ".next-b";
};

export type UpdateJob = {
  jobId: string;
  status: "preparing" | "ready" | "failed";
  startedAt: string;
  startedByPid?: number;
  finishedAt?: string;
  result?: UpdateJobResult;
  error?: string;
  logs: string[];
} & Partial<UpdateJobRange>;

const jobs = new Map<string, UpdateJob>();
const INSTALLER_REASON = "Metis is being updated with the same installer used for a fresh install. Keep this page open.";

function jobStorePath(dataDir = config.dataDir) {
  return path.join(dataDir, "metis-update-job.json");
}

let jobPersistence: Promise<void> = Promise.resolve();

function persistJob(job: UpdateJob, required = false) {
  // Polling and installer completion may write concurrently. Serialize snapshots
  // so an older write cannot replace a terminal job or truncate the JSON file.
  const snapshot = { ...job, logs: boundInstallerLogLines(job.logs) };
  jobPersistence = jobPersistence.catch(() => {}).then(() => writeJobSnapshot(snapshot, required));
  return jobPersistence;
}

async function writeJobSnapshot(job: UpdateJob, required: boolean) {
  try {
    await mkdir(config.dataDir, { recursive: true });
    const temporary = `${jobStorePath()}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, jobStorePath());
    // History is secondary; failure here must not invalidate a saved job.
    await upsertUpdateHistoryEntry(historyEntryFromJob(job)).catch(() => {});
  } catch (error) {
    if (required) throw error;
    // A later poll can retry a snapshot; the initial durable record is mandatory.
  }
}

function parseStoredJob(raw: string): UpdateJob | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateJob>;
    if (!parsed.jobId || (parsed.status !== "preparing" && parsed.status !== "ready" && parsed.status !== "failed")) return null;
    return {
      jobId: parsed.jobId,
      status: parsed.status,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString(),
      ...(typeof parsed.startedByPid === "number" ? { startedByPid: parsed.startedByPid } : {}),
      ...(parsed.finishedAt ? { finishedAt: parsed.finishedAt } : {}),
      ...(parsed.result ? { result: parsed.result } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
      ...(parsed.fromLabel ? { fromLabel: parsed.fromLabel } : {}),
      ...(parsed.toLabel ? { toLabel: parsed.toLabel } : {}),
      ...(parsed.fromTag !== undefined ? { fromTag: parsed.fromTag } : {}),
      ...(parsed.fromCommit !== undefined ? { fromCommit: parsed.fromCommit } : {}),
      ...(parsed.toTag !== undefined ? { toTag: parsed.toTag } : {}),
      ...(parsed.toCommit !== undefined ? { toCommit: parsed.toCommit } : {}),
      logs: Array.isArray(parsed.logs) ? boundInstallerLogLines(parsed.logs) : [],
    };
  } catch {
    return null;
  }
}

async function readPersistedJob(): Promise<UpdateJob | null> {
  try {
    return parseStoredJob(await readBoundedUpdateJson(jobStorePath(), 1024 * 1024));
  } catch {
    return null;
  }
}

export function settleUpdateJobFromInstaller(
  job: UpdateJob,
  input: { installerRunning: boolean; logText: string; currentPid?: number; now?: string },
): UpdateJob {
  if (job.status !== "preparing") return job;
  const scopedLog = installerLogForJob(input.logText, job.jobId);
  if (!scopedLog) return job;

  const logs = scopedLog.trim().split(/\r?\n/);
  if (input.installerRunning || installerProcessIsRunning(scopedLog)) return { ...job, logs };

  const now = input.now || new Date().toISOString();
  const last = logs.filter(Boolean).at(-1);
  const exitCode = installerExitCode(scopedLog);
  if ((exitCode !== undefined && exitCode !== 0) || (exitCode === undefined && installerLogIndicatesFailure(scopedLog))) {
    return { ...job, status: "failed", error: last || "Installer update failed.", finishedAt: now, logs };
  }
  if (!installerLogIndicatesSuccess(scopedLog)) {
    const age = Date.parse(now) - Date.parse(job.startedAt);
    if (exitCode === 0 || (age > 60_000 && /\[metis-update-pid:\d+\]/.test(scopedLog))) {
      return { ...job, status: "failed", error: "Installer stopped without a verified successful installation. Check the update log and retry.", finishedAt: now, logs };
    }
    return { ...job, logs };
  }

  const currentPid = input.currentPid ?? process.pid;
  if (!job.startedByPid || currentPid === job.startedByPid) {
    return { ...job, logs };
  }

  return {
    ...job,
    status: "ready",
    finishedAt: now,
    logs,
    result: job.result || { tag: job.toTag || (job.toCommit ? "master" : "latest"), commit: job.toCommit || undefined, asset: "installer", method: "installer" },
  };
}

async function applyInstallerState(job: UpdateJob) {
  if (job.status !== "preparing") return job;
  const [running, logs] = await Promise.all([
    installerUpdateIsRunning(config.serviceName),
    readInstallerUpdateLog(config.dataDir, 200, job.jobId),
  ]);
  const next = settleUpdateJobFromInstaller(job, {
    installerRunning: running,
    logText: logs.join("\n"),
    currentPid: process.pid,
  });
  jobs.set(next.jobId, next);
  if (next.status !== "preparing") {
    await persistJob(next);
    await clearMaintenanceState();
  } else if (next.logs !== job.logs) {
    await persistJob(next);
  }
  return next;
}

async function startUpdateJob(
  prepare: (logger: (message: string) => void) => Promise<UpdateJobResult>,
  reason = INSTALLER_REASON,
  initialize?: (job: UpdateJob) => Promise<void>,
) {
  const job: UpdateJob = {
    jobId: randomUUID(),
    status: "preparing",
    startedAt: new Date().toISOString(),
    startedByPid: process.pid,
    logs: ["Update job created."],
  };
  const log = (message: string) => { job.logs = boundInstallerLogLines([...job.logs, `${new Date().toISOString()} ${message}`]); };

  await initialize?.(job);
  log("Maintenance mode enabled.");
  await setMaintenanceState(job.jobId, reason);
  jobs.set(job.jobId, job);
  try {
    await persistJob(job, true);
  } catch (error) {
    jobs.delete(job.jobId);
    await clearMaintenanceState();
    throw error;
  }

  void prepare(log).then(async (result) => {
    job.result = result;
    log("Installer process finished; waiting for the restarted Metis process.");
    jobs.set(job.jobId, job);
    await persistJob(job);
  }).catch(async (error) => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    log(`Update failed: ${job.error}`);
    jobs.set(job.jobId, job);
    await persistJob(job);
    await clearMaintenanceState();
  });
  return job;
}

let startingJob: Promise<UpdateJob> | undefined;

export function startInstallerUpdateJob(input: InstallerUpdateInput, range?: UpdateJobRange): Promise<UpdateJob> {
  if (startingJob) return startingJob;
  startingJob = withUpdateStartLock(() => startExclusiveInstallerUpdate(input, range)).finally(() => { startingJob = undefined; });
  return startingJob;
}

async function withUpdateStartLock(start: () => Promise<UpdateJob>) {
  await mkdir(config.dataDir, { recursive: true });
  const lock = path.join(config.dataDir, "metis-update-start.lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // This lock covers job creation only; it is released before the build starts.
    const age = Date.now() - (await stat(lock)).mtimeMs;
    if (age <= 60_000) throw new Error("Another update request is starting. Please retry shortly.");
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock);
  }
  try { return await start(); } finally { await rm(lock, { recursive: true, force: true }); }
}

async function startExclusiveInstallerUpdate(input: InstallerUpdateInput, range?: UpdateJobRange) {
  const stored = await readPersistedJob();
  if (stored?.status === "preparing") {
    const existing = await applyInstallerState(jobs.get(stored.jobId) || stored);
    if (existing.status === "preparing") return existing;
  }
  if (await installerUpdateIsRunning(input.serviceName, input.platform ?? process.platform)) {
    throw new Error("An installer update is already running.");
  }
  const labels = range || {
    fromLabel: "unknown",
    toLabel: input.commit || input.tag || (input.channel === "commits" ? "master" : "latest"),
    toTag: input.tag,
    toCommit: input.commit,
  };
  return startUpdateJob(async (log) => {
    const result = await runInstallerUpdate(input, log);
    return { ...result, commit: input.commit };
  }, INSTALLER_REASON, async (job) => {
    Object.assign(job, labels);
    await initializeInstallerUpdateLog(input.dataDir, job.jobId, labels);
  });
}

export function getUpdateJob(jobId: string) {
  return jobs.get(jobId) || null;
}

export async function resolveUpdateJob(jobId: string): Promise<UpdateJob | null> {
  const id = jobId.trim();
  if (!id) return null;
  const remembered = jobs.get(id) || (await readPersistedJob());
  if (remembered && remembered.jobId === id) {
    jobs.set(remembered.jobId, remembered);
    return applyInstallerState(remembered);
  }
  return null;
}
