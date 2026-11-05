"use client";

import { useEffect, useState } from "react";
import { Cpu, Gauge, LoaderCircle, MemoryStick, Network } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMetricBytes, METRIC_INTERVAL_MS, type GpuMetric, type ServerMetric, type ServerMetricsPayload } from "@/lib/server-metrics-history";
import { monitorRows, ramPercent, type MonitorRange, type MonitorRow } from "@/lib/server-monitor-view";

type Kind = "cpu" | "ram" | "load" | "network" | "gpu";
type Series = { label: string; color: string; value: (row: ServerMetric) => number | null };
const timeLabel = (time: number) => new Date(time).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;

export function MetricTooltip({ metric, kind, gpuId }: { metric: ServerMetric; kind: Kind; gpuId?: string }) {
  const gpu = metric.gpus.find(item => item.id === gpuId);
  const rows: Array<[string, string]> = kind === "cpu" ? [
    ["CPU", percent(metric.cpuPercent)], ["Load · 1 / 5 / 15 min", metric.load.map(n => n.toFixed(2)).join(" / ")],
  ] : kind === "ram" ? [
    ["RAM", percent(ramPercent(metric))], ["Used", formatMetricBytes(metric.ramUsedBytes)],
    ["Total", formatMetricBytes(metric.ramTotalBytes)], ["Available", formatMetricBytes(metric.ramTotalBytes - metric.ramUsedBytes)],
  ] : kind === "network" ? [
    ["Receive ↓", `${formatMetricBytes(metric.networkRxBytesPerSecond)}/s`],
    ["Send ↑", `${formatMetricBytes(metric.networkTxBytesPerSecond)}/s`],
    ["Combined", `${formatMetricBytes(metric.networkRxBytesPerSecond + metric.networkTxBytesPerSecond)}/s`],
  ] : kind === "load" ? metric.load.map((value, index) => [`Load · ${[1, 5, 15][index]} min`, value.toFixed(2)]) : gpu ? [
    ["GPU", percent(gpu.utilizationPercent)], ["VRAM", `${formatMetricBytes(gpu.memoryUsedBytes)} / ${formatMetricBytes(gpu.memoryTotalBytes)}`],
    ["Temperature", gpu.temperatureC === null ? "—" : `${gpu.temperatureC.toFixed(1)} °C`],
  ] : [];
  return <div role="tooltip" className="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
    <p className="mb-1.5 font-medium">{new Date(metric.timestamp).toLocaleDateString("en")} · {timeLabel(Date.parse(metric.timestamp))}</p>
    <dl className="space-y-1">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-5"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value}</dd></div>)}</dl>
  </div>;
}

function MonitorChart({ title, rows, series, kind, end, minutes, gpuId }: {
  title: string; rows: MonitorRow[]; series: Series[]; kind: Kind; end: number; minutes: MonitorRange; gpuId?: string;
}) {
  const data = rows.map(row => Object.fromEntries([["time", row.time], ["metric", row.metric],
    ...series.map((line, index) => [`s${index}`, row.metric ? line.value(row.metric) : null])]));
  const values = rows.flatMap(row => row.metric ? [series[0].value(row.metric)] : []).filter((value): value is number => value !== null && Number.isFinite(value));
  const format = (value: number) => kind === "network" ? `${formatMetricBytes(value)}/s` : kind === "load" ? value.toFixed(2) : percent(value);
  return <section className="min-w-0 rounded-lg border border-border/50 bg-card/40 p-3" aria-label={title}>
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-xs font-medium">{title}</h3>
      {values.length > 0 && <p className="text-[10px] text-muted-foreground">Avg {format(values.reduce((a, b) => a + b, 0) / values.length)} · Peak {format(Math.max(...values))}{series.length > 1 ? ` · ${series[0].label}` : ""}</p>}
    </div>
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{series.map(line => <span key={line.label} className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: line.color }} />{line.label}</span>)}</div>
    {values.length ? <div className="h-48 w-full min-w-0" data-monitor-chart={kind}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={30}>
        <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 4 }} accessibilityLayer>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="time" type="number" domain={[end - minutes * 60_000, end]} allowDataOverflow tickFormatter={timeLabel} minTickGap={36} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={kind === "cpu" || kind === "ram" || kind === "gpu" ? [0, 100] : [0, "auto"]} width={kind === "network" ? 66 : 42} tickFormatter={value => kind === "network" ? formatMetricBytes(value) : kind === "load" ? String(value) : `${value}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip isAnimationActive={false} wrapperStyle={{ zIndex: 20, maxWidth: "calc(100% - 8px)" }} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
            const metric = payload?.[0]?.payload?.metric as ServerMetric | null | undefined;
            return active && metric ? <MetricTooltip metric={metric} kind={kind} gpuId={gpuId} /> : null;
          }} />
          {series.map((line, index) => <Line key={line.label} dataKey={`s${index}`} name={line.label} type="linear" stroke={line.color} strokeWidth={1.8} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="flex h-48 items-center justify-center text-xs text-muted-foreground">No samples in this time window.</p>}
  </section>;
}

export function ServerMonitorView({ data, error, now = Date.now() }: { data: ServerMetricsPayload; error?: string | null; now?: number }) {
  const [minutes, setMinutes] = useState<MonitorRange>(15);
  const rows = monitorRows(data.history, minutes, now);
  const current = data.current;
  const stale = current && now - Date.parse(current.timestamp) > METRIC_INTERVAL_MS * 3;
  const warning = error || data.warning || (stale ? "Updates are delayed. Showing the last available measurements." : null);
  const chart = { rows, end: now, minutes };
  const cpu: Series[] = [{ label: "CPU utilization", color: "#22d3ee", value: row => row.cpuPercent }];
  const ram: Series[] = [{ label: "RAM utilization", color: "#a78bfa", value: ramPercent }];
  const load: Series[] = [1, 5, 15].map((duration, index) => ({ label: `${duration} min`, color: ["#fbbf24", "#fb923c", "#f87171"][index], value: row => row.load[index] ?? null }));
  const network: Series[] = [{ label: "Receive ↓", color: "#34d399", value: row => row.networkRxBytesPerSecond }, { label: "Send ↑", color: "#60a5fa", value: row => row.networkTxBytesPerSecond }];
  return <div className="min-w-0 space-y-3" data-server-monitor>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-medium">Server monitor</h2><p className="text-[10px] text-muted-foreground">15-minute rolling history · sampled every 5 seconds</p></div>
      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Time range">{([1, 5, 15] as const).map(value => <button key={value} type="button" aria-pressed={minutes === value} onClick={() => setMinutes(value)} className={`rounded px-2.5 py-1.5 text-xs transition-colors ${minutes === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{value} min</button>)}</div>
    </div>
    {warning && <p role="alert" className="rounded-md border border-amber-500/25 px-3 py-2 text-xs text-amber-400">{warning}</p>}
    {current ? <>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "CPU", value: percent(current.cpuPercent), detail: "utilization", Icon: Cpu },
          { label: "RAM", value: percent(ramPercent(current)), detail: `${formatMetricBytes(current.ramUsedBytes)} / ${formatMetricBytes(current.ramTotalBytes)}`, Icon: MemoryStick },
          { label: "Load", value: current.load[0].toFixed(2), detail: `5 min ${current.load[1].toFixed(2)} · 15 min ${current.load[2].toFixed(2)}`, Icon: Gauge },
          { label: "Network", value: `↓ ${formatMetricBytes(current.networkRxBytesPerSecond)}/s`, detail: `↑ ${formatMetricBytes(current.networkTxBytesPerSecond)}/s`, Icon: Network },
        ].map(({ label, value, detail, Icon }) => <div key={label} className="min-w-0 rounded-lg border border-border/50 px-3 py-2"><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="size-3.5" />{label}</span><p className="mt-1 break-words text-sm font-medium tabular-nums">{value}</p><p className="mt-0.5 break-words text-[10px] text-muted-foreground">{detail}</p></div>)}
      </div>
      <p className="flex flex-wrap justify-between gap-1 text-[10px] text-muted-foreground"><span>{rows.filter(row => row.metric).length} samples · Last {minutes} min</span><span>Updated {timeLabel(Date.parse(current.timestamp))}</span></p>
      <MonitorChart title="CPU" kind="cpu" series={cpu} {...chart} />
      <MonitorChart title="RAM" kind="ram" series={ram} {...chart} />
      <MonitorChart title="Network · bytes/s" kind="network" series={network} {...chart} />
      <MonitorChart title="System load" kind="load" series={load} {...chart} />
      {current.gpus.length ? current.gpus.map(gpu => <GpuChart key={gpu.id} gpu={gpu} {...chart} />) : <p className="rounded-lg border border-dashed border-border/50 p-3 text-xs text-muted-foreground">GPU telemetry is unavailable on this server.</p>}
    </> : <div className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">{warning ? "No server measurements available yet. Retrying automatically." : <><LoaderCircle className="mr-2 size-4 animate-spin" />Loading recorded server metrics…</>}</div>}
  </div>;
}
function GpuChart({ gpu, ...chart }: { gpu: GpuMetric; rows: MonitorRow[]; end: number; minutes: MonitorRange }) {
  return <div className="space-y-1">
    <MonitorChart title={gpu.name} kind="gpu" gpuId={gpu.id} series={[{ label: "GPU utilization", color: "#a78bfa", value: row => row.gpus.find(item => item.id === gpu.id)?.utilizationPercent ?? null }]} {...chart} />
    <p className="px-1 text-[10px] text-muted-foreground">VRAM {formatMetricBytes(gpu.memoryUsedBytes)} / {formatMetricBytes(gpu.memoryTotalBytes)} · {gpu.temperatureC === null ? "Temperature unavailable" : `${gpu.temperatureC.toFixed(0)} °C`}</p>
  </div>;
}

export function ServerMonitor() {
  const [data, setData] = useState<ServerMetricsPayload>({ current: null, history: [] });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/monitor", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Server metrics are unavailable. Retrying automatically.");
        const next = await response.json() as ServerMetricsPayload;
        if (!controller.signal.aborted) { setData(next); setError(null); setNow(Date.now()); }
      } catch {
        if (!controller.signal.aborted) { setError("Server metrics are unavailable. Retrying automatically."); setNow(Date.now()); }
      } finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), METRIC_INTERVAL_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return <ServerMonitorView data={data} error={error} now={now} />;
}
