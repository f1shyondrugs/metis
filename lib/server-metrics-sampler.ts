import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { METRIC_INTERVAL_MS, METRIC_RETENTION_MS, METRIC_MAX_FILE_BYTES, recentMetrics, type ServerMetric, type ServerMetricsPayload } from "./server-metrics-history";

type SamplerOptions = {
  filePath: string; sample: () => Promise<ServerMetric>;
  now?: () => number; intervalMs?: number;
};

/** One sampler per app process, independent of HTTP requests and open tabs. */
export function createServerMetricsSampler(options: SamplerOptions) {
  const now = options.now ?? Date.now;
  let history: ServerMetric[] = [];
  let pending: Promise<void> | null = null;
  let startup: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let warning: string | null = null;

  function sampleNow() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const metric = await options.sample();
        history = recentMetrics([...history, metric], now());
        warning = null;
      } catch {
        warning = "The latest sample could not be collected. Retrying automatically.";
        return;
      }
      const temporary = `${options.filePath}.${process.pid}.tmp`;
      try {
        await mkdir(path.dirname(options.filePath), { recursive: true });
        await writeFile(temporary, JSON.stringify({ version: 1, history }), { mode: 0o600 });
        await rename(temporary, options.filePath);
      } catch {
        warning = "History could not be saved. Live metrics remain available.";
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  function start() {
    if (startup) return startup;
    startup = (async () => {
      try {
        if ((await stat(options.filePath)).size <= METRIC_MAX_FILE_BYTES) {
          const saved = JSON.parse(await readFile(options.filePath, "utf8"));
          if (saved.version === 1 && Array.isArray(saved.history)) history = recentMetrics(saved.history, now());
        }
      } catch { /* Missing or corrupt cache starts with fresh measurements. */ }
      timer = setInterval(() => { void sampleNow(); }, options.intervalMs ?? METRIC_INTERVAL_MS);
      timer.unref();
      void sampleNow();
    })();
    return startup;
  }

  async function read(): Promise<ServerMetricsPayload> {
    await start();
    if (!history.length) await sampleNow();
    history = recentMetrics(history, now());
    return { current: history.at(-1) ?? null, history: [...history], warning,
      sampleIntervalMs: METRIC_INTERVAL_MS, retentionMs: METRIC_RETENTION_MS };
  }

  async function stop() {
    await startup;
    if (timer) clearInterval(timer);
    timer = null;
    await pending;
  }
  return { start, read, sampleNow, stop };
}
