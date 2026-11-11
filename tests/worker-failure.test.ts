import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-worker-failure-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AI_CHAT_ROOT = dataDir;
process.env.AGENT_CWD = dataDir;
function supervisor() {
  delete process.env.AI_CHAT_JOB_ID;
  delete process.env.AI_CHAT_WORKER_ID;
  delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
}
supervisor();
let store!: typeof import("../lib/db-store");
let jobs!: typeof import("../lib/db-jobs");
let sqlite!: typeof import("../lib/sqlite");
let failure!: typeof import("../lib/worker-failure");
before(async () => {
  [store, jobs, sqlite, failure] = await Promise.all([
    import("../lib/db-store"), import("../lib/db-jobs"),
    import("../lib/sqlite"), import("../lib/worker-failure"),
  ]);
});
after(() => { supervisor(); rmSync(dataDir, { recursive: true, force: true }); });
test("an early failure publishes chat status, visible error and event before releasing the child lease", () => {
  const { chat, job, claimed } = fixture();
  store.appendMessage(chat.id, { role: "user", content: "Original assistant request" });
  store.updateChat(chat.id, { runStatus: "running" });
  process.env.AI_CHAT_JOB_ID = job.id;
  process.env.AI_CHAT_WORKER_ID = claimed.leaseOwner;
  process.env.AI_CHAT_JOB_LEASE_TOKEN = claimed.leaseToken;
  try {
    assert.equal(failure.markWorkerJobError(claimed, "No model is selected for this chat.")?.status, "error");
    assert.equal(store.getChat(chat.id)!.runStatus, "error");
    assert.equal(store.getChat(chat.id)!.messages.at(-2)?.content, "Original assistant request");
    assert.equal(store.getChat(chat.id)!.messages.at(-1)?.errorMessage, "No model is selected for this chat.");
    assert.equal(jobs.getJob(job.id)!.status, "error");
    assert.equal(sqlite.getDatabase().prepare("SELECT 1 FROM job_leases WHERE job_id=?").get(job.id), undefined);
    assert.equal(store.appendMessage(chat.id, { role: "assistant", content: "late" }), null);
    assert.equal(failure.markWorkerJobError(claimed, "duplicate"), null);
  } finally { supervisor(); }
  assert.equal(sqlite.getDatabase().prepare("SELECT COUNT(*) AS count FROM run_events WHERE job_id=? AND event=?").get(job.id, "error")?.count, 1);
});

test("an expired child's early failure cannot overwrite the chat or replacement run", () => {
  const { chat, job, claimed } = fixture();
  store.appendMessage(chat.id, { role: "user", content: "Original assistant request" });
  store.updateChat(chat.id, { runStatus: "running" });
  sqlite.getDatabase().prepare("UPDATE job_leases SET expires_at=? WHERE job_id=?").run(new Date(Date.now()-1000).toISOString(), job.id);
  process.env.AI_CHAT_JOB_ID=job.id;process.env.AI_CHAT_WORKER_ID=claimed.leaseOwner;process.env.AI_CHAT_JOB_LEASE_TOKEN=claimed.leaseToken;
  try {
    assert.equal(failure.markWorkerJobError(claimed, "stale failure"), null);
    assert.equal(jobs.getJob(job.id)!.status, "running");
    assert.equal(store.getChat(chat.id)!.runStatus, "running");
    assert.equal(store.getChat(chat.id)!.messages.length, 1);
    assert.equal(store.getChat(chat.id)!.messages[0].content, "Original assistant request");
  } finally { supervisor(); jobs.updateJob(job.id, { status: "cancelled" }); }
});

const message = "Isolated worker exited cleanly without publishing a terminal run state.";
function fixture() {
  supervisor();
  const chat = store.createChat("Worker failure");
  const job = jobs.enqueueJob({ chatId: chat.id, message: "test" });
  const claimed = jobs.claimNextJob({ workerId: "fixture-worker" })!;
  assert.equal(claimed.id, job.id);
  return { chat, job, claimed };
}

test("a recurring failure is appended after current output despite an identical historic error", () => {
  const { chat, job } = fixture();
  store.appendMessage(chat.id, { role: "assistant", content: "", errorMessage: message });
  store.appendMessage(chat.id, { role: "user", content: "continue" });
  store.appendMessage(chat.id, { role: "assistant", content: "Current research progress" });
  jobs.updateJob(job.id, { status: "error", error: message });
  failure.persistWorkerFailureMessage(job.id, message);
  const messages = store.getChat(chat.id)!.messages;
  assert.equal(messages.filter(m => m.errorMessage === message).length, 2);
  assert.equal(messages.at(-2)?.content, "Current research progress");
  assert.equal(messages.at(-1)?.id, `worker-error:${job.id}:1`);
  assert.equal(messages.at(-1)?.errorMessage, message);
});

test("repeated failure publication for the same attempt creates one message", () => {
  const { chat, job } = fixture();
  jobs.updateJob(job.id, { status: "error", error: message });
  failure.persistWorkerFailureMessage(job.id, message);
  failure.persistWorkerFailureMessage(job.id, message);
  assert.equal(store.getChat(chat.id)!.messages.length, 1);
});

test("a second failed attempt of the same job gets its own message", () => {
  const { chat, job } = fixture();
  jobs.updateJob(job.id, { status: "error", error: message });
  failure.persistWorkerFailureMessage(job.id, message);
  jobs.updateJob(job.id, { status: "queued" });
  assert.equal(jobs.claimNextJob()!.attempts, 2);
  jobs.updateJob(job.id, { status: "error", error: message });
  failure.persistWorkerFailureMessage(job.id, message);
  assert.deepEqual(store.getChat(chat.id)!.messages.map(m => m.id),
    [`worker-error:${job.id}:1`, `worker-error:${job.id}:2`]);
});

test("the supervisor can publish after the child loses its writer lease", () => {
  const { chat, job, claimed } = fixture();
  sqlite.getDatabase().prepare("UPDATE job_leases SET expires_at = ? WHERE job_id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), job.id);
  process.env.AI_CHAT_JOB_ID = job.id;
  process.env.AI_CHAT_WORKER_ID = claimed.leaseOwner;
  process.env.AI_CHAT_JOB_LEASE_TOKEN = claimed.leaseToken;
  try {
    assert.equal(store.upsertMessage(chat.id, { id: "child-error", role: "assistant", content: "", errorMessage: message }), null);
    assert.equal(jobs.touchJob(job.id), null);
  } finally { supervisor(); }
  jobs.updateJob(job.id, { status: "error", error: message });
  assert.ok(failure.persistWorkerFailureMessage(job.id, message));
  assert.equal(store.getChat(chat.id)!.messages.at(-1)?.errorMessage, message);
});

test("failure publication does not change cancelled, completed or active jobs", () => {
  for (const status of ["cancelled", "completed", "running"] as const) {
    const { chat, job } = fixture();
    jobs.updateJob(job.id, { status });
    assert.equal(failure.persistWorkerFailureMessage(job.id, message), null);
    assert.equal(store.getChat(chat.id)!.messages.length, 0);
    if (status === "running") jobs.updateJob(job.id, { status: "cancelled" });
  }
});

test("lease diagnostics distinguish expiry, replacement and removal without exposing tokens", () => {
  const { job, claimed } = fixture();
  process.env.AI_CHAT_WORKER_ID = claimed.leaseOwner;
  process.env.AI_CHAT_JOB_LEASE_TOKEN = claimed.leaseToken;
  try {
    assert.equal(jobs.jobLeaseDiagnostics(job.id).leaseState, "active");
    assert.ok(!JSON.stringify(jobs.jobLeaseDiagnostics(job.id)).includes(claimed.leaseToken!));
    sqlite.getDatabase().prepare("UPDATE job_leases SET expires_at = ? WHERE job_id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), job.id);
    assert.equal(jobs.jobLeaseDiagnostics(job.id).leaseState, "expired");
    assert.ok(jobs.jobLeaseDiagnostics(job.id).expiredForMs! >= 1000);
    process.env.AI_CHAT_JOB_LEASE_TOKEN = "replacement";
    assert.equal(jobs.jobLeaseDiagnostics(job.id).leaseState, "token_mismatch");
    process.env.AI_CHAT_WORKER_ID = "replacement-worker";
    assert.equal(jobs.jobLeaseDiagnostics(job.id).leaseState, "worker_mismatch");
    sqlite.getDatabase().prepare("DELETE FROM job_leases WHERE job_id = ?").run(job.id);
    assert.equal(jobs.jobLeaseDiagnostics(job.id).leaseState, "missing");
  } finally { supervisor(); jobs.updateJob(job.id, { status: "cancelled" }); }
});
