import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { awaitUserQuestionGate, withUserQuestionBarrier, USER_INPUT_TRANSPORT_TIMEOUT_MS } from "../lib/mcp-core/user-question-gate.mjs";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-user-question-wait-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir, AI_CHAT_ROOT: dir, MCP_BEARER_TOKEN: "wait-test" });
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[key];
const loaded = Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/db-questions"), import("../lib/user-question-wait"), import("../app/api/internal/mcp-question/route")]);
after(() => rmSync(dir, { recursive: true, force: true }));
async function fixture() {
 const [auth, store, jobs, questions, wait, route] = await loaded;
 const owner = auth.createUser(crypto.randomUUID(), "password").id;
 const chat = store.createChat("Wait fixture", undefined, owner);
 const job = jobs.enqueueJob({ chatId: chat.id, userId: owner, message: "ask" });
 const lease = jobs.claimNextJob({ workerId: "wait-worker" })!;
 assert.equal(lease.id, job.id);
 return { owner, chat, job, lease, store, jobs, questions, wait, route };
}
function request(f: Awaited<ReturnType<typeof fixture>>, controller = new AbortController(), owner: string = f.owner) {
 return new Request("http://localhost/api/internal/mcp-question", { signal: controller.signal, headers: {
 authorization: "Bearer wait-test", "x-ai-chat-id": f.chat.id, "x-ai-chat-user-id": owner, "x-ai-chat-job-id": f.job.id,
 "x-ai-chat-worker-id": f.lease.leaseOwner!, "x-ai-chat-lease-token": f.lease.leaseToken!,
 }});
}
test("durable question gate blocks later work until explicit submission, including defaults", async () => {
 const f = await fixture();
 const pending = f.questions.createPendingQuestion([{ question: "Proceed?", key: "proceed", type: "toggle", default: true }], f.chat.id, f.owner, { jobId: f.job.id });
 f.jobs.updateJob(f.job.id, { status: "waiting_input" });
 let continued = false;
 const running = f.route.GET(request(f)).then(response => { continued = true; return response; });
 try {
  await delay(320);
  assert.equal(continued, false);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "waiting_input");
  assert.equal(f.questions.resolveQuestion(pending.questionId, { proceed: false }, f.owner) !== false, true);
  assert.equal((await running).status, 200);
  assert.equal(continued, true);
 } finally { pending.stop(); f.jobs.updateJob(f.job.id, { status: "cancelled" }); }
});
test("disconnect leaves the question open; reconnect still waits and foreign users cannot release it", async () => {
 const f = await fixture();
 const pending = f.questions.createPendingQuestion([{ question: "Value", key: "value" }], f.chat.id, f.owner, { jobId: f.job.id });
 f.jobs.updateJob(f.job.id, { status: "waiting_input" });
 const controller = new AbortController();
 const disconnected = f.route.GET(request(f, controller));
 controller.abort();
 assert.equal((await disconnected).status, 499);
 assert.equal(f.questions.getPendingQuestion(pending.questionId, f.owner)?.status, "waiting_for_user");
 assert.equal((await f.route.GET(request(f, undefined, "foreign"))).status, 401);
 let continued = false;
 const retry = f.route.GET(request(f)).then(response => { continued = true; return response; });
 try {
  await delay(280); assert.equal(continued, false);
  f.questions.resolveQuestion(pending.questionId, { value: "Actual answer" }, f.owner);
  assert.equal((await retry).status, 200);
 } finally { pending.stop(); f.jobs.updateJob(f.job.id, { status: "cancelled" }); }
});
test("stopping a run rejects queued work instead of treating cancellation as an answer", async () => {
 const f = await fixture();
 const pending = f.questions.createPendingQuestion([{ question: "Value" }], f.chat.id, f.owner, { jobId: f.job.id });
 const running = f.route.GET(request(f));
 f.jobs.updateJob(f.job.id, { status: "cancelled" });
 assert.equal((await running).status, 409);
 pending.stop();
});
test("parallel tools cannot execute while ask_user is still outstanding; other runs remain independent", async () => {
 const context = { userId: "owner", jobId: "parallel" };
 let answer!: () => void; let executed = false;
 const question = withUserQuestionBarrier("ask_user", context, () => new Promise<void>(resolve => { answer = resolve; }));
 const later = withUserQuestionBarrier("write_file", context, async () => { executed = true; });
 await withUserQuestionBarrier("read_file", { userId: "other", jobId: "parallel" }, async () => {});
 await delay(10); assert.equal(executed, false);
 answer(); await question; await later; assert.equal(executed, true);
});
test("cancelled parallel tool is never executed", async () => {
 const context = { userId: "owner", jobId: "parallel-cancel" };
 let answer!: () => void; let executed = false;
 const question = withUserQuestionBarrier("ask_user", context, () => new Promise<void>(resolve => { answer = resolve; }));
 const controller = new AbortController();
 const later = withUserQuestionBarrier("write_file", context, async () => { executed = true; }, controller.signal);
 controller.abort(); await assert.rejects(later);
 assert.equal(executed, false); answer(); await question;
});
test("gateway fails closed if the durable gate times out, fails or remains unresolved", async () => {
 const context = { jobId: "j", chatId: "c", userId: "u", workerId: "w", leaseToken: "l" };
 for (const response of [Response.json({ waitingForUser: true }), Response.json({}, { status: 409 })]) {
  await assert.rejects(awaitUserQuestionGate({ context, url: "http://test.invalid", token: "fixture", leaseHeaders: { "X-AI-Chat-Worker-Id": "w", "X-AI-Chat-Lease-Token": "l" }, fetcher: (async () => response) as typeof fetch }));
 }
});
test("question transport follows the blocking contract even after schema sanitization", async () => {
 const { bridgeToolTimeoutMs } = await import("../lib/mcp-bridge");
 const { ASK_USER_INPUT_SCHEMA } = await import("../lib/mcp-core/question-schema.mjs");
 assert.equal(bridgeToolTimeoutMs({}, ASK_USER_INPUT_SCHEMA), USER_INPUT_TRANSPORT_TIMEOUT_MS);
 assert.equal(bridgeToolTimeoutMs({}, {}), 300000);
});

test("answering a newer form cannot release another unanswered form in the same run", async () => {
 const f = await fixture();
 const first = f.questions.createPendingQuestion([{ question: "First", key: "first" }], f.chat.id, f.owner, { jobId: f.job.id });
 const second = f.questions.createPendingQuestion([{ question: "Second", key: "second" }], f.chat.id, f.owner, { jobId: f.job.id });
 let continued = false;
 const running = f.wait.waitForJobUserInput(f.job.id, f.owner).then(() => { continued = true; });
 try {
  f.questions.resolveQuestion(second.questionId, { second: "answer" }, f.owner);
  await delay(300); assert.equal(continued, false);
  f.questions.resolveQuestion(first.questionId, { first: "answer" }, f.owner);
  await running; assert.equal(continued, true);
 } finally { first.stop(); second.stop(); f.jobs.updateJob(f.job.id, { status: "cancelled" }); }
});
