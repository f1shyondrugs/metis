import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, afterEach, before } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-reset-wait-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root, AI_CHAT_PROVIDER_LIMIT_WAITER: "1" });
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];
let jobs!: typeof import("../lib/db-jobs");
let store!: typeof import("../lib/db-store");
let db!: ReturnType<typeof import("../lib/sqlite").getDatabase>;
let api!: typeof import("../app/api/chat/provider-wait/route");
before(async () => {
  jobs = await import("../lib/db-jobs"); store = await import("../lib/db-store");
  db = (await import("../lib/sqlite")).getDatabase();
  api = await import("../app/api/chat/provider-wait/route");
});
afterEach(() => { for (const job of jobs.listJobs()) if (["queued", "running"].includes(job.status)) jobs.cancelAgentJob(job.id, job.userId); });
after(() => rmSync(root, { recursive: true, force: true }));

function owner() {
  const id = randomUUID(), token = randomUUID();
  db.prepare("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)").run(id,id,"unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(createHash("sha256").update(token).digest("hex"),id,new Date(Date.now()+86400000).toISOString());
  return { id, cookie: "ai_chat_auth="+token };
}
function fixture() {
  const user = owner();
  const chat = store.createChat("Reset wait", undefined, user.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: user.id, message: "Continue this task" });
  const claimed = jobs.claimNextJob({ workerId: "fixture-worker" })!;
  assert.equal(claimed.id, job.id);
  jobs.updateJob(job.id, { runId: "original-run", agentId: "original-session", agentRuntimeDeadlineAt: new Date(Date.now()+60000).toISOString() });
  const paused = jobs.deferProviderLimitedJob(job.id, { statusCode: 429, responseHeaders: { "retry-after": "3600" } })!;
  assert.ok(paused);
  return { user, chat, job: paused, wait: { jobId: job.id, detectedAt: paused.providerRateLimit!.detectedAt, resetAt: paused.providerRateLimit!.resetAt } };
}
const read = (chatId: string, cookie: string) => api.GET(new Request("http://localhost/api/chat/provider-wait?chatId="+chatId, { headers: { cookie } }));
const act = (f: ReturnType<typeof fixture>, action: string, fields: Record<string, unknown> = {}, cookie = f.user.cookie) => api.POST(new Request("http://localhost/api/chat/provider-wait", {
  method: "POST", headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ chatId: f.chat.id, ...f.wait, action, ...fields }),
}));

test("wait metadata survives a reload and remains private to the owner", async () => {
  const f = fixture();
  const response = await read(f.chat.id, f.user.cookie);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).wait, f.wait);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal((await read(f.chat.id, owner().cookie)).status, 404);
  assert.equal((await read(f.chat.id, "")).status, 401);
});

test("Wake now resumes the same job and preserves the remaining budget exactly once", async t => {
  const start = Date.parse("2026-11-06T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  t.mock.timers.setTime(start + 20*60000);
  const response = await act(f, "wake");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).wait, null);
  const woken = jobs.getJob(f.job.id)!;
  assert.equal(woken.status, "queued");
  assert.equal(woken.providerRateLimit, undefined);
  assert.equal(woken.agentId, "original-session");
  assert.equal(woken.runId, "original-run");
  assert.equal(woken.agentRuntimeDeadlineAt, new Date(start + 21*60000).toISOString());
  assert.match(woken.resumePrompt || "", /user requested a manual retry/i);
  assert.equal((await act(f, "wake")).status, 409);
  assert.equal(jobs.getJob(f.job.id)!.agentRuntimeDeadlineAt, woken.agentRuntimeDeadlineAt);
  const claimed = jobs.claimNextJob({ workerId: "next-worker" })!;
  assert.equal(claimed.id, f.job.id);
  assert.equal(claimed.attempts, 2);
  assert.equal(claimed.agentRuntimeDeadlineAt, woken.agentRuntimeDeadlineAt);
  assert.equal(jobs.listJobs(f.chat.id, f.user.id).length, 1);
});

test("Cancel auto-resume cancels only the displayed wait and never resumes at reset", async t => {
  const start = Date.parse("2026-11-06T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const f = fixture();
  assert.equal((await act(f, "cancel")).status, 200);
  assert.equal(jobs.getJob(f.job.id)!.status, "cancelled");
  assert.equal((await act(f, "cancel")).status, 200);
  assert.equal((await (await read(f.chat.id, f.user.cookie)).json()).wait, null);
  t.mock.timers.setTime(start+7200000);
  assert.equal(jobs.claimNextJob(), null);
  assert.equal(store.getChat(f.chat.id, f.user.id)!.runStatus, "cancelled");
});

test("stale cycle, foreign owner, wrong job and invalid actions cannot control a wait", async () => {
  const f = fixture();
  assert.equal((await act(f, "cancel", {}, owner().cookie)).status, 404);
  assert.equal((await act(f, "wake", { jobId: randomUUID() })).status, 409);
  assert.equal((await act(f, "cancel", { detectedAt: "2020-01-01T00:00:00Z" })).status, 409);
  assert.equal((await act(f, "consume-credit")).status, 400);
  assert.equal(jobs.getJob(f.job.id)!.status, "queued");
  assert.deepEqual(jobs.getJob(f.job.id)!.providerRateLimit, f.job.providerRateLimit);
});

test("a historical wait cannot cancel a run that has already resumed", async () => {
  const f = fixture();
  jobs.updateJob(f.job.id, { providerRateLimit: { ...f.job.providerRateLimit!, resetAt: new Date(Date.now()-1).toISOString() } }, { control: true });
  assert.equal(jobs.claimNextJob({ workerId: "already-running" })!.id, f.job.id);
  assert.equal((await act(f, "cancel")).status, 409);
  assert.equal(jobs.getJob(f.job.id)!.status, "running");
});
