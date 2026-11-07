import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-memory-queue-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root });
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];

test("RAM queue transitions, owner override and normal scheduler guards", async t => {
  const [store, jobs, { getDatabase }, { POST }, labels] = await Promise.all([
    import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/sqlite"),
    import("../app/api/runs/memory-override/route"), import("../lib/memory-queue"),
  ]);
  const db = getDatabase();
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const account = () => {
    const id = randomUUID(), token = randomUUID();
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), id, "2099-01-01T00:00:00.000Z");
    return { id, token };
  };
  const owner = account(), stranger = account();
  const fixture = (extra = {}) => {
    const chat = store.createChat("Memory fixture", undefined, owner.id);
    const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "fixture", ...extra });
    return { chat, job };
  };
  const post = (jobId: unknown, token: string = owner.token) => POST(new Request("http://fixture/api/runs/memory-override", {
    method: "POST", headers: { cookie: "ai_chat_auth=" + token }, body: JSON.stringify({ jobId }),
  }));
  const clear = () => { db.exec("DELETE FROM job_leases; DELETE FROM jobs"); };

  await t.test("waiting is persisted, replayed and idempotent without reordering the queue", () => {
    clear();
    const { job, chat } = fixture();
    assert.equal(jobs.syncQueuedMemoryWait(true), 1);
    const waiting = jobs.getJob(job.id)!;
    assert.equal(waiting.memoryWaiting, true);
    assert.equal(waiting.updatedAt, job.updatedAt);
    assert.equal(store.getChatMetadata(chat.id, owner.id)?.queueMessage, labels.MEMORY_WAIT_MESSAGE);
    assert.equal(jobs.listRunEvents(chat.id, owner.id, 0, job.id).at(-1)?.data.message, labels.MEMORY_WAIT_MESSAGE);
    assert.equal(jobs.syncQueuedMemoryWait(true), 0);
    assert.equal(jobs.getJob(job.id)?.revision, waiting.revision);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null);
  });

  await t.test("authentication and exact job ownership are enforced", async () => {
    clear();
    const { job } = fixture();
    jobs.syncQueuedMemoryWait(true);
    assert.equal((await post(job.id, "invalid")).status, 401);
    assert.equal((await post(job.id, stranger.token)).status, 404);
    assert.equal((await post({ malformed: true })).status, 400);
    assert.equal(jobs.getJob(job.id)?.memoryOverrideRequestedAt, undefined);
    assert.equal((await post(job.id)).status, 200);
    const revision = jobs.getJob(job.id)?.revision;
    assert.equal((await post(job.id)).status, 200);
    assert.equal(jobs.getJob(job.id)?.revision, revision);
  });

  await t.test("only the acknowledged job starts under pressure, once, and clears the chat wait", async () => {
    clear();
    const earlier = fixture(), allowed = fixture();
    jobs.syncQueuedMemoryWait(true);
    assert.equal((await post(allowed.job.id)).status, 200);
    jobs.syncQueuedMemoryWait(true);
    const claimed = jobs.claimNextJob({ memoryOverrideOnly: true, workerId: "ram-test" })!;
    assert.equal(claimed.id, allowed.job.id);
    assert.equal(claimed.memoryOverrideRequestedAt, undefined);
    assert.equal(claimed.memoryWaiting, undefined);
    assert.equal(store.getChatMetadata(allowed.chat.id, owner.id)?.queueMessage, undefined);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null);
    assert.equal(jobs.getJob(earlier.job.id)?.status, "queued");
    assert.equal((await post(allowed.job.id)).status, 409);
    assert.ok(jobs.updateJob(claimed.id, { status: "queued" }, { control: true }));
    jobs.syncQueuedMemoryWait(true);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null, "retries need a fresh acknowledgement");
  });

  await t.test("ordinary recovery clears the notice and starts without a click", () => {
    clear();
    const { job, chat } = fixture();
    jobs.syncQueuedMemoryWait(true);
    assert.equal(jobs.syncQueuedMemoryWait(false), 1);
    assert.equal(store.getChatMetadata(chat.id, owner.id)?.queueMessage, labels.WORKER_QUEUE_MESSAGE);
    assert.equal(jobs.getJob(job.id)?.memoryWaiting, undefined);
    assert.equal(jobs.claimNextJob()?.id, job.id);
  });

  await t.test("provider reset waits cannot be overridden or mislabeled as RAM waits", async () => {
    clear();
    const { job } = fixture({ providerRateLimit: { resetAt: "2099-01-01T00:00:00.000Z" } });
    assert.equal(jobs.syncQueuedMemoryWait(true), 0);
    assert.equal((await post(job.id)).status, 409);
    // Even a stored acknowledgement must not bypass the independent provider guard.
    const raw = jobs.getJob(job.id)!;
    db.prepare("UPDATE jobs SET data=? WHERE id=?").run(JSON.stringify({ ...raw, memoryOverrideRequestedAt: new Date().toISOString() }), job.id);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null);
  });

  await t.test("the reserved interactive slot remains unavailable to heavy jobs", async () => {
    clear();
    const { job } = fixture({ modeId: "browser" });
    jobs.syncQueuedMemoryWait(true);
    assert.equal((await post(job.id)).status, 200);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true, interactiveOnly: true }), null);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true })?.id, job.id);
  });

  await t.test("an override cannot start a second parent run in an occupied chat", async () => {
    clear();
    const { job } = fixture();
    assert.equal(jobs.claimNextJob()?.id, job.id);
    const queued = { ...job, id: randomUUID(), message: "racing submission" };
    db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES(?,?,?,?,?,?)")
      .run(queued.id, queued.chatId, owner.id, JSON.stringify(queued), "queued", queued.updatedAt);
    jobs.syncQueuedMemoryWait(true);
    assert.equal((await post(queued.id)).status, 200);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null);
    assert.equal(jobs.getJob(job.id)?.status, "running");
  });

  await t.test("cancelled runs stay cancelled and no override leaks into a new run", async () => {
    clear();
    const { job, chat } = fixture();
    jobs.syncQueuedMemoryWait(true);
    jobs.cancelAgentJob(job.id, owner.id);
    assert.equal((await post(job.id)).status, 409);
    const next = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "new run" });
    assert.equal(next.memoryOverrideRequestedAt, undefined);
    assert.equal(jobs.claimNextJob({ memoryOverrideOnly: true }), null);
  });
});
