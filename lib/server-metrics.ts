import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config";
import { createServerMetricsSampler } from "./server-metrics-sampler";
import type { ServerMetric } from "./server-metrics-history";
import { createCpuSampler } from "./server-cpu";
export type { ServerMetric } from "./server-metrics-history";

const execFileAsync = promisify(execFile);
const sampleCpu = createCpuSampler();
let previousNetwork: { rx: number; tx: number; timestamp: number } | null = null;
function numberOrNull(value: string | undefined) {
  if (!value || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

async function readCpuPercent() {
  const content = await readFile("/proc/stat", "utf8");
  return sampleCpu(content);
}

async function readMemory() {
  const content = await readFile("/proc/meminfo", "utf8");
  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const total = values.get("MemTotal") || 0;
  const available = values.get("MemAvailable") || values.get("MemFree") || 0;
  return { total, used: Math.max(0, total - available) };
}

async function readNetwork() {
  const content = await readFile("/proc/net/dev", "utf8");
  let rx = 0;
  let tx = 0;
  for (const line of content.split("\n").slice(2)) {
    const [name, rest] = line.trim().split(":");
    if (!name || !rest || name === "lo") continue;
    const values = rest.trim().split(/\s+/).map(Number);
    rx += values[0] || 0;
    tx += values[8] || 0;
  }
  const now = Date.now();
  const elapsed = previousNetwork ? Math.max(0.1, (now - previousNetwork.timestamp) / 1000) : 1;
  const result = {
    rx: previousNetwork ? Math.max(0, (rx - previousNetwork.rx) / elapsed) : 0,
    tx: previousNetwork ? Math.max(0, (tx - previousNetwork.tx) / elapsed) : 0,
  };
  previousNetwork = { rx, tx, timestamp: now };
  return result;
}

async function readNvidia() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], { timeout: 2500 });
    return stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [id, name, utilization, memoryUsed, memoryTotal, temperature] = line.split(",").map((value) => value.trim());
      return {
        id: `nvidia-${id}`,
        name: name || `NVIDIA GPU ${id}`,
        utilizationPercent: numberOrNull(utilization),
        memoryUsedBytes: numberOrNull(memoryUsed) === null ? null : Number(memoryUsed) * 1024 * 1024,
        memoryTotalBytes: numberOrNull(memoryTotal) === null ? null : Number(memoryTotal) * 1024 * 1024,
        temperatureC: numberOrNull(temperature),
      };
    });
  } catch {
    return [];
  }
}

async function readAmd() {
  try {
    const { stdout } = await execFileAsync("rocm-smi", ["--showuse", "--showmemuse", "--showtemp", "--csv"], { timeout: 2500 });
    const rows = stdout.split("\n").filter((line) => /GPU\d+/i.test(line));
    return rows.map((line, index) => ({
      id: `amd-${index}`,
      name: `AMD GPU ${line.match(/GPU\d+/i)?.[0] || index}`,
      utilizationPercent: numberOrNull(line.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]),
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      temperatureC: numberOrNull(line.match(/(\d+(?:\.\d+)?)\s*C/)?.[1]),
    }));
  } catch {
    return [];
  }
}

async function sample(): Promise<ServerMetric> {
  const [cpu, memory, network, gpus] = await Promise.all([
    readCpuPercent(),
    readMemory(),
    readNetwork(),
    readNvidia().then(async (nvidia) => nvidia.length ? nvidia : readAmd()),
  ]);
  const metric: ServerMetric = {
    timestamp: new Date().toISOString(),
    ...cpu,
    ramUsedBytes: memory.used,
    ramTotalBytes: memory.total,
    load: os.loadavg().map((value) => Number(value.toFixed(2))),
    networkRxBytesPerSecond: network.rx,
    networkTxBytesPerSecond: network.tx,
    gpus,
  };
  return metric;
}

const shared = globalThis as typeof globalThis & {
  __metisServerMetricsSampler?: ReturnType<typeof createServerMetricsSampler>;
};
function sampler() {
  return shared.__metisServerMetricsSampler ??= createServerMetricsSampler({
    filePath: path.join(config.dataDir, "server-metrics.json"), sample,
  });
}
export function startServerMetrics() { return sampler().start(); }
export function getServerMetrics() { return sampler().read(); }
