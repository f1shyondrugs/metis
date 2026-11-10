"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Cpu, Gauge, LoaderCircle, MemoryStick, Network } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMetricBytes, METRIC_INTERVAL_MS, type GpuMetric, type ServerMetric, type ServerMetricsPayload } from "@/lib/server-metrics-history";
import { monitorRows, ramPercent, type MonitorRange, type MonitorRow } from "@/lib/server-monitor-view";

type Kind = "cpu" | "ram" | "load" | "network" | "gpu";
type Series = { label: string; color: string; dash?: string; value: (row: ServerMetric) => number | null };
const timeLabel = (time: number) => new Date(time).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;

export function MetricTooltip({ metric, kind, gpuId, coreId, series }: { metric: ServerMetric; kind: Kind; gpuId?: string; coreId?: number; series?: Series[] }) {
  const gpu = metric.gpus.find(item => item.id === gpuId);
  const rows: Array<[string, string]> = kind === "cpu" && series ? series.map(line => [line.label, percent(line.value(metric))]) : kind === "cpu" ? [
    [coreId === undefined ? "CPU · total" : `CPU ${coreId}`, percent(coreId === undefined ? metric.cpuPercent : metric.cpuCores?.find(core => core.id === coreId)?.percent ?? null)], ["Load · 1 / 5 / 15 min", metric.load.map(n => n.toFixed(2)).join(" / ")],
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
  return <div role="tooltip" className="max-h-64 max-w-64 overflow-y-auto rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
    <p className="mb-1.5 font-medium">{new Date(metric.timestamp).toLocaleDateString("en")} · {timeLabel(Date.parse(metric.timestamp))}</p>
    <dl className="space-y-1">{rows.map(([label, value], index) => <div key={label} className="flex justify-between gap-5"><dt className="flex items-center gap-1.5 text-muted-foreground">{series?.[index] && <SeriesSwatch line={series[index]} />}{label}</dt><dd className="font-mono tabular-nums">{value}</dd></div>)}</dl>
  </div>;
}

function MonitorChart({ title, rows, series, kind, end, minutes, gpuId, coreId, controls, emptyMessage }: {
  title: string; rows: MonitorRow[]; series: Series[]; kind: Kind; end: number; minutes: MonitorRange; gpuId?: string; coreId?: number; controls?: ReactNode; emptyMessage?: string;
}) {
  const data = rows.map(row => Object.fromEntries([["time", row.time], ["metric", row.metric],
    ...series.map((line, index) => [`s${index}`, row.metric ? line.value(row.metric) : null])]));
  const summary = kind === "cpu" ? series : series.slice(0, 1);
  const values = rows.flatMap(row => { const metric = row.metric; return metric ? summary.map(line => line.value(metric)) : []; }).filter((value): value is number => value !== null && Number.isFinite(value));
  const format = (value: number) => kind === "network" ? `${formatMetricBytes(value)}/s` : kind === "load" ? value.toFixed(2) : percent(value);
  return <section className="min-w-0 rounded-lg border border-border/50 bg-card/40 p-3" aria-label={title}>
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-xs font-medium">{title}</h3>
      {values.length > 0 && <p className="text-[10px] text-muted-foreground">Avg {format(values.reduce((a, b) => a + b, 0) / values.length)} · Peak {format(values.reduce((peak, value) => Math.max(peak, value), 0))}{series.length > 1 ? kind === "cpu" ? " · shown curves" : ` · ${series[0].label}` : ""}</p>}
    </div>
    {!controls && <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{series.map(line => <span key={line.label} className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: line.color }} />{line.label}</span>)}</div>}
    {values.length ? <div className="h-48 w-full min-w-0" data-monitor-chart={kind}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={30}>
        <LineChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 4 }} accessibilityLayer>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="time" type="number" domain={[end - minutes * 60_000, end]} allowDataOverflow tickFormatter={timeLabel} minTickGap={36} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={kind === "cpu" || kind === "ram" || kind === "gpu" ? [0, 100] : [0, "auto"]} width={kind === "network" ? 66 : 42} tickFormatter={value => kind === "network" ? formatMetricBytes(value) : kind === "load" ? String(value) : `${value}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip isAnimationActive={false} wrapperStyle={{ zIndex: 20, maxWidth: "calc(100% - 8px)", pointerEvents: "auto" }} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
            const metric = payload?.[0]?.payload?.metric as ServerMetric | null | undefined;
            return active && metric ? <MetricTooltip metric={metric} kind={kind} gpuId={gpuId} coreId={coreId} series={kind === "cpu" ? series : undefined} /> : null;
          }} />
          {series.map((line, index) => <Line key={line.label} dataKey={`s${index}`} name={line.label} type="linear" stroke={line.color} strokeWidth={kind === "cpu" ? line.label === "Total" ? 2.5 : 1.5 : 1.8} strokeDasharray={line.dash} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="flex h-48 items-center justify-center text-xs text-muted-foreground">{emptyMessage ?? "No samples in this time window."}</p>}
    {controls}
  </section>;
}

const CPU_COLORS = ["#2563eb", "#d97706", "#059669", "#e11d48", "#7c3aed", "#0891b2", "#c2410c", "#4f46e5"];
function SeriesSwatch({ line }: { line: Pick<Series, "color" | "dash"> }) {
  return <svg aria-hidden="true" width="14" height="8" className="shrink-0"><line x1="0" x2="14" y1="4" y2="4" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash} /></svg>;
}

export function CpuMonitor({ current, ...chart }: { current: ServerMetric; rows: MonitorRow[]; end: number; minutes: MonitorRange }) {
  // null follows the inventory; explicit choices (including none) survive polling and range changes.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const cores = [...(current.cpuCores ?? [])].sort((a, b) => a.id - b.id);
  const lookups = new WeakMap<ServerMetric, Map<number, number | null>>();
  const all: Array<Series & { key: string; current: number | null }> = [
    { key: "total", label: "Total", color: "var(--foreground)", current: current.cpuPercent, value: row => row.cpuPercent },
    ...cores.map(core => ({
      key: String(core.id), label: `CPU ${core.id}`, current: core.percent,
      color: CPU_COLORS[core.id] ?? `hsl(${(core.id * 137.508) % 360} 65% 48%)`,
      dash: [undefined, "6 3", "2 3", "8 3 2 3"][core.id % 4],
      value: (row: ServerMetric) => {
        let values = lookups.get(row);
        if (!values) { values = new Map(row.cpuCores?.map(item => [item.id, item.percent])); lookups.set(row, values); }
        return values.get(core.id) ?? null;
      },
    })),
  ];
  const shown = all.filter(line => selected === null || selected.has(line.key));
  const totalOnly = shown.length === 1 && shown[0].key === "total";
  const coresOnly = cores.length > 0 && shown.length === cores.length && !shown.some(line => line.key === "total");
  const toggle = (key: string) => setSelected(previous => {
    const next = new Set(previous ?? all.map(line => line.key));
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const controls = <div className="mt-2 space-y-2">
    {cores.length > 0 && <div role="group" aria-label="CPU display" className="flex flex-wrap gap-1">
      {[
        { label: "All", active: shown.length === all.length, select: () => setSelected(null) },
        { label: "Total only", active: totalOnly, select: () => setSelected(new Set(["total"])) },
        { label: "Cores only", active: coresOnly, select: () => setSelected(new Set(cores.map(core => String(core.id)))) },
      ].map(preset => <button key={preset.label} type="button" aria-pressed={preset.active} onClick={preset.select}
        className={`min-h-11 rounded-md px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8 [@media(pointer:coarse)]:min-h-11 ${preset.active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{preset.label}</button>)}
    </div>}
    <div role="group" aria-label="Visible CPU curves" className="grid max-h-36 grid-cols-3 gap-1 overflow-y-auto p-0.5 sm:grid-cols-4" data-cpu-legend>
      {all.map(line => {
        const active = selected === null || selected.has(line.key);
        return <button key={line.key} type="button" data-cpu-series={line.key} data-cpu-core={line.key === "total" ? undefined : line.key} aria-pressed={active} onClick={() => toggle(line.key)}
          className={`flex min-h-11 min-w-0 items-center justify-between gap-1 rounded-md border px-1.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8 [@media(pointer:coarse)]:min-h-11 ${active ? "border-border bg-secondary/50" : "border-transparent text-muted-foreground hover:bg-secondary"}`}>
          <span className="flex min-w-0 items-center gap-1"><SeriesSwatch line={line} /><span className={active ? "truncate" : "truncate line-through"}>{line.label}</span></span>
          <span className="shrink-0 font-mono tabular-nums">{percent(line.current)}</span>
        </button>;
      })}
    </div>
    <p className="text-[11px] text-muted-foreground">{cores.length ? `${cores.length} logical CPUs · Host-wide utilization · ${shown.length} shown` : "Per-core measurements are unavailable for this sample."}{cores.some(core => core.percent === null) && " · Waiting for next sample"}</p>
  </div>;
  return <section aria-label="CPU cores">
    <MonitorChart title="CPU utilization" kind="cpu" series={shown} controls={controls}
      emptyMessage={!shown.length ? "Select Total or a CPU to show its history." : undefined} {...chart} />
  </section>;
}

export function ServerMonitorView({ data, error, now = Date.now() }: { data: ServerMetricsPayload; error?: string | null; now?: number }) {
  const [minutes, setMinutes] = useState<MonitorRange>(15);
  const rows = monitorRows(data.history, minutes, now);
  const current = data.current;
  const stale = current && now - Date.parse(current.timestamp) > METRIC_INTERVAL_MS * 3;
  const warning = error || data.warning || (stale ? "Updates are delayed. Showing the last available measurements." : null);
  const chart = { rows, end: now, minutes };
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
      <CpuMonitor current={current} {...chart} />
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
