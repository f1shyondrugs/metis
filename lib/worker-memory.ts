import { readFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import path from "node:path";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
export const WORKER_MEMORY_STARTUP_RESERVE_MS = 30_000;

export function countStartingJobs(startedAt: Iterable<number>, now = Date.now()) {
  let count = 0;
  for (const time of startedAt) if (now - time < WORKER_MEMORY_STARTUP_RESERVE_MS) count++;
  return count;
}
export type MemoryConstraint = { limitBytes: number; usedBytes: number };
export type WorkerMemoryState = { totalBytes: number; availableBytes: number; constraints: MemoryConstraint[] };

const readText = (file: string) => readFile(file, "utf8").catch(() => "");
function finiteLimit(raw: string) {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}
let cgroupPaths: Promise<string[]> | undefined;
async function workerCgroupPaths() {
  if (process.platform !== "linux") return [];
  cgroupPaths ??= readText("/proc/self/cgroup").then(text => {
    const group = text.split("\n").find(line => line.startsWith("0::"))?.slice(3);
    if (group === undefined) return [];
    const base = "/sys/fs/cgroup";
    let current = path.resolve(base, "." + group);
    if (current !== base && !current.startsWith(base + "/")) return [];
    const paths: string[] = [];
    while (current.startsWith(base)) {
      paths.push(current);
      if (current === base) break;
      current = path.dirname(current);
    }
    return paths;
  });
  return cgroupPaths;
}

/** Reads the worker's own cgroup and ancestors; no shell, subprocess or provider call. */
export async function readWorkerMemoryState(): Promise<WorkerMemoryState> {
  const state: WorkerMemoryState = { totalBytes: totalmem(), availableBytes: freemem(), constraints: [] };
  if (process.platform !== "linux") return state;
  const [meminfo, groups] = await Promise.all([readText(process.env.METIS_MEMORY_INFO_FILE || "/proc/meminfo"), workerCgroupPaths()]);
  const available = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if (available) state.availableBytes = Number(available[1]) * 1024;
  const constraints = await Promise.all(groups.map(async group => {
    const [max, high, current, stat] = await Promise.all([
      readText(path.join(group, "memory.max")), readText(path.join(group, "memory.high")),
      readText(path.join(group, "memory.current")), readText(path.join(group, "memory.stat")),
    ]);
    const limitBytes = Math.min(finiteLimit(max), finiteLimit(high));
    const currentBytes = Number(current);
    if (!Number.isFinite(limitBytes) || !current.trim() || !Number.isFinite(currentBytes) || currentBytes < 0) return null;
    // File cache can be reclaimed; do not confuse cached database pages with live agent heaps.
    const inactiveFile = Number(stat.match(/^inactive_file\s+(\d+)/m)?.[1] || 0);
    return { limitBytes, usedBytes: Math.max(0, currentBytes - inactiveFile) };
  }));
  state.constraints = constraints.filter((value): value is MemoryConstraint => value !== null);
  return state;
}

export function workerMemoryAdmission(state: WorkerMemoryState, startingJobs: number, perJobRaw = process.env.AI_CHAT_WORKER_MEMORY_PER_JOB_MB) {
  const total = Math.min(state.totalBytes, ...state.constraints.map(c => c.limitBytes));
  const configured = Number(perJobRaw);
  const perJobBytes = Number.isFinite(configured) && configured > 0
    ? Math.max(64 * MiB, configured * MiB)
    : Math.min(GiB, Math.max(128 * MiB, total / 4));
  const starting = Math.max(0, startingJobs);
  const hostReserve = Math.min(state.totalBytes / 4, Math.max(256 * MiB, state.totalBytes * .15), 4 * GiB);
  // Reserve capacity for newly spawned jobs before their RSS has grown. Otherwise
  // a fast claim loop can admit every job against the same still-free RAM.
  // After startup, actual cgroup usage replaces the reservation. Long-lived
  // parents waiting for child agents must not monopolize hypothetical RAM.
  const pendingReservation = starting * perJobBytes;
  let availableBytes = state.availableBytes - hostReserve - pendingReservation;
  for (const constraint of state.constraints) {
    const reserve = Math.min(constraint.limitBytes / 4, Math.max(128 * MiB, constraint.limitBytes * .1));
    availableBytes = Math.min(availableBytes, constraint.limitBytes - constraint.usedBytes - pendingReservation - reserve);
  }
  return { additionalJobs: Math.max(0, Math.floor(availableBytes / perJobBytes)), availableBytes, perJobBytes };
}
