export const METRIC_INTERVAL_MS = 5_000;
export const METRIC_RETENTION_MS = 15 * 60_000;
export const METRIC_MAX_SAMPLES = METRIC_RETENTION_MS / METRIC_INTERVAL_MS + 1;

export const MAX_CPU_CORES = 1024;
// Bounded restart cache, including 181 samples of per-core telemetry on large hosts.
export const METRIC_MAX_FILE_BYTES = 16 * 1024 * 1024;
export type CpuCoreMetric = { id: number; percent: number | null };

export type GpuMetric = {
  id: string; name: string; utilizationPercent: number | null;
  memoryUsedBytes: number | null; memoryTotalBytes: number | null; temperatureC: number | null;
};
export type ServerMetric = {
  timestamp: string; cpuPercent: number; cpuCores?: CpuCoreMetric[]; ramUsedBytes: number; ramTotalBytes: number;
  load: number[]; networkRxBytesPerSecond: number; networkTxBytesPerSecond: number; gpus: GpuMetric[];
};
export type ServerMetricsPayload = {
  current: ServerMetric | null; history: ServerMetric[];
  warning?: string | null; sampleIntervalMs?: number; retentionMs?: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullable = (value: unknown) => value === null || finite(value);
export function isServerMetric(value: unknown): value is ServerMetric {
  if (!value || typeof value !== "object") return false;
  const row = value as ServerMetric;
  return typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp)) &&
    [row.cpuPercent, row.ramUsedBytes, row.ramTotalBytes, row.networkRxBytesPerSecond, row.networkTxBytesPerSecond].every(finite) &&
    (row.cpuCores === undefined || (Array.isArray(row.cpuCores) && row.cpuCores.length <= MAX_CPU_CORES &&
      row.cpuCores.every(core => core && Number.isSafeInteger(core.id) && core.id >= 0 &&
        (core.percent === null || (finite(core.percent) && core.percent >= 0 && core.percent <= 100))) &&
      new Set(row.cpuCores.map(core => core.id)).size === row.cpuCores.length)) &&
    Array.isArray(row.load) && row.load.length === 3 && row.load.every(finite) &&
    Array.isArray(row.gpus) && row.gpus.length <= 64 && row.gpus.every(gpu => gpu && typeof gpu.id === "string" &&
      typeof gpu.name === "string" && [gpu.utilizationPercent, gpu.memoryUsedBytes, gpu.memoryTotalBytes, gpu.temperatureC].every(nullable));
}

export function recentMetrics(rows: unknown[], now: number, duration = METRIC_RETENTION_MS): ServerMetric[] {
  const unique = new Map<number, ServerMetric>();
  for (const row of rows) {
    if (!isServerMetric(row)) continue;
    const timestamp = Date.parse(row.timestamp);
    if (timestamp >= now - duration && timestamp <= now) unique.set(timestamp, row);
  }
  return [...unique.entries()].sort(([a], [b]) => a - b).slice(-METRIC_MAX_SAMPLES).map(([, row]) => row);
}

export function formatMetricBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value), unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
