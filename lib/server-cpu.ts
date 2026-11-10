import { MAX_CPU_CORES, type CpuCoreMetric } from "./server-metrics-history";

type Counter = { total: number; idle: number };
function utilization(current: Counter, previous?: Counter): number | null {
  if (!previous) return null;
  const elapsed = current.total - previous.total, idle = current.idle - previous.idle;
  if (elapsed <= 0 || idle < 0) return null;
  return Math.round(Math.max(0, Math.min(100, (elapsed - idle) / elapsed * 100)) * 10) / 10;
}

/** One interval baseline for aggregate and logical CPUs; never derive utilization from lifetime totals. */
export function createCpuSampler() {
  let previous = new Map<string, Counter>();
  return (stat: string): { cpuPercent: number; cpuCores: CpuCoreMetric[] } => {
    const current = new Map<string, Counter>();
    for (const line of stat.split("\n")) {
      const [name, ...fields] = line.trim().split(/\s+/);
      if (!/^cpu(?:\d+)?$/.test(name)) continue;
      // guest and guest_nice are already included in user/nice by Linux.
      const values = fields.slice(0, 8).map(Number);
      if (values.length < 4 || !values.every(value => Number.isSafeInteger(value) && value >= 0)) continue;
      current.set(name, { total: values.reduce((sum, value) => sum + value, 0), idle: values[3] + (values[4] ?? 0) });
    }
    if (!current.has("cpu")) throw new Error("CPU counters are unavailable.");
    const cpuCores: CpuCoreMetric[] = [];
    for (const [name, counters] of current) {
      if (name === "cpu") continue;
      cpuCores.push({ id: Number(name.slice(3)), percent: utilization(counters, previous.get(name)) });
    }
    if (cpuCores.length > MAX_CPU_CORES) throw new Error("CPU telemetry exceeds the supported processor count.");
    cpuCores.sort((a, b) => a.id - b.id);
    const cpuPercent = utilization(current.get("cpu")!, previous.get("cpu")) ?? 0;
    previous = current;
    return { cpuPercent, cpuCores };
  };
}
