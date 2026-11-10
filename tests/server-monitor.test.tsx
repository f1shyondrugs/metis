import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServerMetricsSampler } from "../lib/server-metrics-sampler";
import { METRIC_MAX_SAMPLES, METRIC_RETENTION_MS, METRIC_MAX_FILE_BYTES, MAX_CPU_CORES, isServerMetric, recentMetrics, type ServerMetric } from "../lib/server-metrics-history";
import { monitorRows } from "../lib/server-monitor-view";
import { MetricTooltip, ServerMonitorView } from "../components/server-monitor";
Object.assign(globalThis, { React });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function metric(time: number, cpu = 25): ServerMetric {
  return { timestamp: new Date(time).toISOString(), cpuPercent: cpu, ramUsedBytes: 4 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3,
    load: [1.25, 2.5, 3.75], networkRxBytesPerSecond: 1024 ** 2, networkTxBytesPerSecond: 2048,
    gpus: [{ id: "test", name: "Test GPU", utilizationPercent: 50, memoryUsedBytes: 1024 ** 3, memoryTotalBytes: 8 * 1024 ** 3, temperatureC: 42 }] };
}
async function temporary() { const directory = await mkdtemp(path.join(os.tmpdir(), "metis-metrics-")); return { directory, filePath: path.join(directory, "metrics.json") }; }

test("retention uses actual timestamps, rejects invalid/future samples and deduplicates", () => {
  const now = Date.now(), good = metric(now);
  assert.deepEqual(recentMetrics([metric(now - METRIC_RETENTION_MS - 1), metric(now + 1), { ...good, cpuPercent: NaN }, good, { ...good, cpuPercent: 80 }], now), [{ ...good, cpuPercent: 80 }]);
  assert.equal(recentMetrics([metric(now - METRIC_RETENTION_MS)], now).length, 1);
});

test("background timer collects and saves without any monitor read", async () => {
  const { directory, filePath } = await temporary();
  let count = 0;
  const sampler = createServerMetricsSampler({ filePath, intervalMs: 15, sample: async () => { count++; return metric(Date.now()); } });
  try {
    await sampler.start();
    await sampler.start();
    await delay(90);
    await sampler.stop();
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.ok(count >= 3, String(count));
    assert.ok(saved.history.length >= 3);
    assert.equal(saved.version, 1);
  } finally { await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("rolling disk history remains bounded to 15 minutes through a restart", async () => {
  const { directory, filePath } = await temporary();
  let now = 1_800_000;
  const sampler = createServerMetricsSampler({ filePath, now: () => now, sample: async () => metric(now) });
  try {
    await sampler.start(); await sampler.sampleNow(); await sampler.stop();
    for (let i = 0; i < 200; i++) { now += 5000; await sampler.sampleNow(); }
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(saved.history.length, METRIC_MAX_SAMPLES);
    assert.equal(Date.parse(saved.history[0].timestamp), now - METRIC_RETENTION_MS);
    const restarted = createServerMetricsSampler({ filePath, now: () => now, sample: async () => metric(now, 75) });
    try {
      const result = await restarted.read();
      assert.equal(result.history.length, METRIC_MAX_SAMPLES);
      assert.equal(Date.parse(result.history[0].timestamp), now - METRIC_RETENTION_MS);
    } finally { await restarted.stop(); }
  } finally { await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("hydrated history is served immediately while a new sample is still pending", async () => {
  const { directory, filePath } = await temporary(), now = Date.now();
  await writeFile(filePath, JSON.stringify({ version: 1, history: [metric(now - 5000)] }));
  let release!: (value: ServerMetric) => void;
  const sampler = createServerMetricsSampler({ filePath, sample: () => new Promise(resolve => { release = resolve; }) });
  try {
    const result = await Promise.race([sampler.read(), delay(200).then(() => { throw Error("Blocked on sampler"); })]);
    assert.equal(result.history.length, 1);
    assert.equal(result.current?.cpuPercent, 25);
  } finally { release(metric(now)); await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("failed samples keep saved history, recover and never overlap", async () => {
  const { directory, filePath } = await temporary();
  let now = Date.now(), fail = true, calls = 0;
  const sampler = createServerMetricsSampler({ filePath, now: () => now, sample: async () => {
    calls++; await delay(5); if (fail) throw Error("temporary"); return metric(now);
  } });
  try {
    await sampler.start();
    await Promise.all([sampler.sampleNow(), sampler.sampleNow(), sampler.sampleNow()]);
    assert.equal(calls, 1);
    const empty = await sampler.read();
    assert.equal(empty.current, null); assert.match(empty.warning!, /could not be collected/);
    fail = false; now += 5000; await sampler.sampleNow();
    assert.equal((await sampler.read()).warning, null);
    fail = true; now += 5000; await sampler.sampleNow();
    assert.equal((await sampler.read()).history.length, 1);
    now += METRIC_RETENTION_MS + 1;
    assert.equal((await sampler.read()).current, null);
  } finally { await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("corrupt persisted history is replaced with a valid fresh sample", async () => {
  const { directory, filePath } = await temporary();
  await writeFile(filePath, "{broken");
  const sampler = createServerMetricsSampler({ filePath, sample: async () => metric(Date.now()) });
  try {
    assert.equal((await sampler.read()).history.length, 1);
    await sampler.sampleNow();
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).history.length, 1);
  } finally { await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("persistence failures keep live metrics and report the missing durable history", async () => {
  const { directory } = await temporary();
  const sampler = createServerMetricsSampler({ filePath: directory, sample: async () => metric(Date.now()) });
  try {
    await sampler.start(); await sampler.sampleNow();
    const result = await sampler.read();
    assert.ok(result.current);
    assert.match(result.warning!, /History could not be saved/);
  } finally { await sampler.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("1/5/15 minute windows filter by time and leave real gaps in the graph", () => {
  const now = Date.now(), history = [metric(now - 14 * 60_000), metric(now - 4 * 60_000), metric(now - 30_000), metric(now)];
  assert.equal(monitorRows(history, 1, now).filter(row => row.metric).length, 2);
  assert.equal(monitorRows(history, 5, now).filter(row => row.metric).length, 3);
  assert.equal(monitorRows(history, 15, now).filter(row => row.metric).length, 4);
  assert.ok(monitorRows(history, 15, now).some(row => row.metric === null));
  assert.deepEqual(monitorRows([metric(now - METRIC_RETENTION_MS - 1)], 15, now), []);
});

test("tooltips show historical RAM bytes, network directions, load periods and GPU details", () => {
  const sample = metric(Date.now(), 31.4);
  const render = (kind: "cpu" | "ram" | "load" | "network" | "gpu") => renderToStaticMarkup(<MetricTooltip metric={sample} kind={kind} gpuId="test" />);
  assert.match(render("cpu"), /31.4%/);
  assert.match(render("ram"), /4.0 GB/); assert.match(render("ram"), /16 GB/);
  assert.match(render("network"), /Receive/); assert.match(render("network"), /1.0 MB\/s/); assert.match(render("network"), /2.0 KB\/s/);
  assert.match(render("load"), /1 min/); assert.match(render("load"), /5 min/); assert.match(render("load"), /15 min/);
  assert.match(render("gpu"), /42.0 °C/); assert.match(render("gpu"), /VRAM/);
});

test("monitor exposes time selection and explicit loading/error states", () => {
  const empty = renderToStaticMarkup(<ServerMonitorView data={{ current: null, history: [] }} />);
  assert.match(empty, /Loading recorded server metrics/);
  assert.match(empty, /aria-pressed="true"[^>]*>15 min/);
  const failed = renderToStaticMarkup(<ServerMonitorView data={{ current: null, history: [] }} error="Offline" />);
  assert.match(failed, /role="alert"/); assert.match(failed, /Retrying automatically/);
});

test("per-core telemetry validates bounds and stable identities while legacy samples remain valid",()=>{
 const base=metric(Date.now());
 assert.ok(isServerMetric(base));
 assert.ok(isServerMetric({...base,cpuCores:[{id:0,percent:null},{id:7,percent:100}]}));
 for(const cpuCores of [[{id:0,percent:101}],[{id:0,percent:-1}],[{id:-1,percent:5}],[{id:0.5,percent:5}],[{id:0,percent:NaN}],[{id:0,percent:5},{id:0,percent:6}],Array.from({length:MAX_CPU_CORES+1},(_,id)=>({id,percent:1}))])assert.equal(isServerMetric({...base,cpuCores}),false);
});
test("per-core history larger than the legacy cache limit survives a restart",async()=>{
 const {directory,filePath}=await temporary(),now=Date.now();
 const history=Array.from({length:METRIC_MAX_SAMPLES},(_,i)=>({...metric(now-(METRIC_MAX_SAMPLES-1-i)*5000),cpuCores:Array.from({length:MAX_CPU_CORES},(_,id)=>({id,percent:12.3}))}));
 const content=JSON.stringify({version:1,history});assert(content.length>2*1024*1024&&content.length<METRIC_MAX_FILE_BYTES);
 await writeFile(filePath,content);
 let release!:(value:ServerMetric)=>void;
 const sampler=createServerMetricsSampler({filePath,now:()=>now,sample:()=>new Promise(resolve=>{release=resolve;})});
 try{const result=await sampler.read();assert.equal(result.history.length,METRIC_MAX_SAMPLES);assert.equal(result.current?.cpuCores?.length,MAX_CPU_CORES);}
 finally{release(metric(now));await sampler.stop();await rm(directory,{recursive:true,force:true});}
});
test("CPU tooltips use the selected logical CPU, including CPU zero and unavailable historical readings",()=>{
 const base={...metric(Date.now()),cpuCores:[{id:0,percent:98.4},{id:7,percent:null}]};
 const render=(coreId:number)=>renderToStaticMarkup(<MetricTooltip metric={base} kind="cpu" coreId={coreId}/>);
 assert.match(render(0),/CPU 0/);assert.match(render(0),/98.4%/);assert.doesNotMatch(render(0),/25.0%/);
 assert.match(render(7),/—/);assert.match(render(9),/—/);
});
test("old telemetry shows a per-core unavailable state; warmup readings remain unknown",()=>{
 const old=renderToStaticMarkup(<ServerMonitorView data={{current:metric(Date.now()),history:[]}}/>);
 assert.match(old,/Per-core measurements are unavailable/);assert.doesNotMatch(old,/data-cpu-core=/);
 const warmup={...metric(Date.now()),cpuCores:[{id:0,percent:null}]};
 const html=renderToStaticMarkup(<ServerMonitorView data={{current:warmup,history:[warmup]}}/>);
 assert.match(html,/Waiting for next sample/);assert.match(html,/CPU 0/);assert.match(html,/logical CPUs/);
});

test("real app startup samples before HTTP requests; monitor auth and cache headers stay intact", async () => {
  const { directory } = await temporary();
  Object.assign(process.env, { AI_CHAT_ROOT: directory, AI_CHAT_INSTALL_DIR: directory, CHAT_DATA_DIR: directory,
    CHAT_DB_PATH: path.join(directory, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp-state"),
    METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" });
  const { getDatabase } = await import("../lib/sqlite");
  const db = getDatabase();
  const { register } = await import("../instrumentation");
  const route = await import("../app/api/monitor/route");
  const filePath = path.join(directory, "server-metrics.json");
  try {
    await register();
    await assert.rejects(readFile(filePath, "utf8"));
    assert.equal((await route.GET(new Request("http://localhost/api/monitor"))).status, 401);
    delete process.env.NEXT_PHASE;
    await register();
    await delay(5400);
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.ok(saved.history.length >= 2, saved.history);
    db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)").run("metrics", "metrics", "test", new Date().toISOString(), 1);
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update("metric-token").digest("hex"), "metrics", new Date(Date.now() + 60_000).toISOString());
    const response = await route.GET(new Request("http://localhost/api/monitor", { headers: { cookie: "ai_chat_auth=metric-token" } }));
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const payload = await response.json();
    assert.ok(payload.history.length >= 2); assert.equal(payload.retentionMs, METRIC_RETENTION_MS);
    assert.equal(payload.current.cpuCores.length, os.cpus().length);
    assert.ok(payload.current.cpuCores.every((core: {id:number;percent:number|null}) => Number.isInteger(core.id) && core.percent !== null && Number.isFinite(core.percent)));
  } finally {
    const shared = globalThis as typeof globalThis & { __metisServerMetricsSampler?: ReturnType<typeof createServerMetricsSampler> };
    await shared.__metisServerMetricsSampler?.stop(); delete shared.__metisServerMetricsSampler;
    db.close(); await rm(directory, { recursive: true, force: true });
  }
});
