import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
const dir = mkdtempSync(path.join(os.tmpdir(), "metis-question-flow-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"), AGENT_CWD: dir, AI_CHAT_ROOT: dir, MCP_BEARER_TOKEN: "question-test-token" });
delete process.env.AI_CHAT_JOB_ID; delete process.env.AI_CHAT_WORKER_ID; delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const loaded = Promise.all([
  import("../lib/auth"), import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/db-questions"), import("../lib/sqlite"),
  import("../app/api/chat/answer/route"), import("../app/api/internal/mcp-question/route"),
]);
let auth!: Awaited<typeof loaded>[0]; let store!: Awaited<typeof loaded>[1]; let jobs!: Awaited<typeof loaded>[2];
let questions!: Awaited<typeof loaded>[3]; let sqlite!: Awaited<typeof loaded>[4]; let answer!: Awaited<typeof loaded>[5]; let internal!: Awaited<typeof loaded>[6];
let owner: { id: string }; let foreign: { id: string }; let cookie: string; let foreignCookie: string;
before(async () => {
  [auth, store, jobs, questions, sqlite, answer, internal] = await loaded;
  owner = auth.createUser("form-owner", "test-password"); foreign = auth.createUser("form-foreign", "test-password");
  cookie = "ai_chat_auth=" + auth.authenticateUser("form-owner", "test-password")!.token;
  foreignCookie = "ai_chat_auth=" + auth.authenticateUser("form-foreign", "test-password")!.token;
});
after(() => rmSync(dir, { recursive: true, force: true }));
function submit(id: string, values: unknown, session = cookie, version?: number) {
  return answer.POST(new Request("http://localhost/api/chat/answer", { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify({ questionId: id, values, version }) }));
}
test("typed submission persists values, emits one readable message and preserves the lease", async () => {
  const chat = store.createChat("Form flow", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "diagnose" });
  const lease = jobs.claimNextJob({ workerId: "form-worker" })!;
  const pending = questions.createPendingQuestion({ title: "Diagnosis", columns: 2, responseTemplate: "Display {{hz}}. Enabled: {{enabled}}.", questions: [
    { question: "Refresh rate", key: "hz", type: "select", options: [{ label: "60 Hz", value: 60 }] },
    { question: "Enabled?", key: "enabled", type: "toggle" },
  ] }, chat.id, owner.id, { jobId: job.id, runId: job.id });
  jobs.updateJob(job.id, { status: "waiting_input" });
  store.appendMessage(chat.id, { id: "form-assistant", role: "assistant", content: "Before.After.", parts: [
    { type: "text", content: "Before." }, { type: "tool", id: "ask-call", name: "ask_user", status: "running" }, { type: "text", content: "After." },
  ] }, owner.id);
  store.updateChat(chat.id, { pendingQuestion: { ...pending, status: "waiting_for_user" } }, owner.id);
  try {
    assert.equal((await submit(pending.questionId, { hz: 60, enabled: false }, foreignCookie)).status, 404);
    assert.equal((await submit(pending.questionId, { hz: 60, enabled: false }, cookie, 99)).status, 409);
    const response = await submit(pending.questionId, { hz: 60, enabled: false }, cookie, 1);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.values, { hz: 60, enabled: false });
    assert.equal(result.summary, "Display 60 Hz. Enabled: No.");
    assert.deepEqual(result.message.questionAnswer, {
      questionId: pending.questionId, assistantMessageId: "form-assistant", toolCallId: "ask-call", cursor: { partIndex: 2 },
      display: { summary: "Display 60 Hz. Enabled: No.", fields: [{ question: "Refresh rate", answer: "60 Hz" }, { question: "Enabled?", answer: "No" }] },
    });
    const firstAnswerMessage = result.message;
    assert.deepEqual(await pending.promise, ["60", "false"]);
    assert.equal(jobs.isJobLeaseActive(job.id, lease.leaseOwner!, lease.leaseToken!), true);
    assert.equal(jobs.claimNextJob({ workerId: "duplicate-worker" }), null);
    const repeated = await submit(pending.questionId, { hz: 60, enabled: true }, cookie, 1);
    assert.equal(repeated.status, 200);
    assert.deepEqual((await repeated.json()).message, firstAnswerMessage);
    const restored = questions.getPendingQuestion(pending.questionId, owner.id)!;
    assert.deepEqual(restored.values, { hz: 60, enabled: false });
    assert.equal(restored.title, "Diagnosis");
    assert.equal(restored.columns, 2);
    assert.equal(store.getChat(chat.id, owner.id)!.messages.filter(m => m.id === "question-answer-" + pending.questionId).length, 1);
  } finally { pending.stop(); jobs.updateJob(job.id, { status: "cancelled" }); }
});
test("wrapped ask_user answers persist their exact transcript boundary before the tool result returns", async () => {
  const chat = store.createChat("Wrapped form flow", undefined, owner.id);
  const pending = questions.createPendingQuestion([{ question: "Choice", key: "choice", type: "text" }], chat.id, owner.id);
  store.appendMessage(chat.id, { id: "wrapped-assistant", role: "assistant", content: "Before.", parts: [
    { type: "text", content: "Before." },
    { type: "tool", id: "wrapped-ask", name: "mcp", input: JSON.stringify({ toolName: "ask_user", arguments: { questions: [{ question: "Choice" }] } }), status: "running" },
  ] }, owner.id);
  store.updateChat(chat.id, { pendingQuestion: { ...pending, status: "waiting_for_user" } }, owner.id);
  try {
    const response = await submit(pending.questionId, { choice: "Keep this answer here" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.message.questionAnswer, {
      questionId: pending.questionId, assistantMessageId: "wrapped-assistant", toolCallId: "wrapped-ask", cursor: { partIndex: 2 },
      display: { summary: "Choice: Keep this answer here", fields: [{ question: "Choice", answer: "Keep this answer here" }] },
    });
    assert.deepEqual(await pending.promise, ["Keep this answer here"]);
    const restored = store.getChat(chat.id, owner.id)!;
    assert.deepEqual(restored.messages.at(-1)!.questionAnswer, result.message.questionAnswer);
    assert.equal(restored.pendingQuestion, undefined);
    const repeated = await submit(pending.questionId, { choice: "Changed" });
    assert.equal(repeated.status, 200);
    assert.deepEqual((await repeated.json()).message, result.message);
  } finally { pending.stop(); }
});
test("opaque provider questions persist their submission cursor and stay before later streamed text", async () => {
  const { projectQuestionTranscript } = await import("../lib/question-transcript");
  const chat = store.createChat("Opaque form flow", undefined, owner.id);
  const pending = questions.createPendingQuestion([{ question: "Choice", key: "choice", type: "text" }], chat.id, owner.id);
  store.appendMessage(chat.id, {
    id: "opaque-assistant", role: "assistant", content: "Before.",
    parts: [{ type: "text", content: "Before." }],
  }, owner.id);
  try {
    const response = await submit(pending.questionId, { choice: "Accepted" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.message.questionAnswer, {
      questionId: pending.questionId, assistantMessageId: "opaque-assistant",
      cursor: { partIndex: 0, textOffset: 7 },
      display: { summary: "Choice: Accepted", fields: [{ question: "Choice", answer: "Accepted" }] },
    });
    assert.deepEqual(await pending.promise, ["Accepted"]);
    store.checkpointAssistantMessage(chat.id, {
      id: "opaque-assistant", role: "assistant", content: "Before.After.",
      parts: [{ type: "text", content: "Before.After." }],
    });
    const restored = store.getChat(chat.id, owner.id)!;
    assert.deepEqual(projectQuestionTranscript(restored.messages).map(message => message.content), [
      "Before.", result.summary, "After.",
    ]);
    const repeated = await submit(pending.questionId, { choice: "Changed" });
    assert.deepEqual((await repeated.json()).message, result.message);
  } finally { pending.stop(); }
});

test("invalid values return field errors and leave the durable form open", async () => {
  const chat = store.createChat("Validation", undefined, owner.id);
  const pending = questions.createPendingQuestion([{ question: "Count", key: "count", type: "number", min: 1, max: 10 }], chat.id, owner.id);
  try {
    const response = await submit(pending.questionId, { count: 11 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).fieldErrors.count, /Maximum/);
    assert.equal(questions.getPendingQuestion(pending.questionId, owner.id)?.status, "waiting_for_user");
    assert.equal(store.getChat(chat.id, owner.id)?.messages.length, 0);
    assert.equal((await submit(pending.questionId, { count: 5 })).status, 200);
    assert.deepEqual(await pending.promise, ["5"]);
  } finally { pending.stop(); }
});
test("internal ask_user route keeps all form metadata in events and returns typed values", async () => {
  const chat = store.createChat("Internal form", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "ask" });
  const lease = jobs.claimNextJob({ workerId: "internal-form-worker" })!;
  const request = new Request("http://localhost/api/internal/mcp-question", {
    method: "POST", headers: { authorization: "Bearer question-test-token", "content-type": "application/json",
      "x-ai-chat-id": chat.id, "x-ai-chat-user-id": owner.id, "x-ai-chat-job-id": job.id,
      "x-ai-chat-worker-id": lease.leaseOwner!, "x-ai-chat-lease-token": lease.leaseToken!,
    },
    body: JSON.stringify({ title: "Details", columns: 2, submitLabel: "Diagnose", responseTemplate: "Count: {{count}}", questions: [{ question: "Count", key: "count", type: "number", min: 0, icon: "cpu" }] }),
  });
  const running = internal.POST(request);
  let pendingId: string | undefined;
  try {
    for (let i = 0; i < 20 && !pendingId; i++) { pendingId = store.getChat(chat.id, owner.id)?.pendingQuestion?.questionId; if (!pendingId) await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(pendingId);
    const state = store.getChat(chat.id, owner.id)!.pendingQuestion!;
    assert.equal(state.title, "Details"); assert.equal(state.columns, 2); assert.equal(state.questions[0].icon, "cpu");
    const row = sqlite.getDatabase().prepare("SELECT data FROM run_events WHERE job_id = ? AND event = 'question'").get(job.id) as { data: string } | undefined;
    assert.ok(row); assert.equal(JSON.parse(row.data).submitLabel, "Diagnose");
    assert.equal((await submit(pendingId, { count: 0 })).status, 200);
    const response = await running;
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.values, { count: 0 }); assert.equal(result.summary, "Count: 0");
    assert.equal(jobs.getJob(job.id)?.status, "running");
  } finally { if (pendingId) questions.cancelQuestion(pendingId, owner.id); await running.catch(() => undefined); jobs.updateJob(job.id, { status: "cancelled" }); }
});

test("gateway exposes only ask_user and forwards the complete shared form contract", async () => {
  process.env.AI_CHAT_INTERNAL_ORIGIN = "http://127.0.0.1:1";
  process.env.AI_CHAT_MCP_STATE_DIR = path.join(dir, "gateway");
  // @ts-expect-error The gateway entrypoint is JavaScript.
  const gateway = await import("../packages/mcp-gateway/index.mjs") as {
    tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
    dispatchGatewayTool: (name: string, input: unknown, options: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;
  };
  const { ASK_USER_INPUT_SCHEMA } = await import("../lib/mcp-core/question-schema.mjs");
  assert.equal(gateway.tools.filter(tool => tool.name === "ask_user").length, 1);
  assert.deepEqual(gateway.tools.find(tool => tool.name === "ask_user")!.inputSchema, ASK_USER_INPUT_SCHEMA);
  const input = { title: "Monitor test", columns: 2, submitLabel: "Diagnose", responseTemplate: "Rate {{hz}}", questions: [{ key: "hz", question: "Rate", type: "select", options: [{ label: "60 Hz", value: 60 }] }] };
  const originalFetch = globalThis.fetch;
  let forwarded: unknown;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /api\/internal\/mcp-question$/);
    forwarded = JSON.parse(String(init?.body));
    return Response.json({ questionId: "gateway-fixture", answers: ["60"], values: { hz: 60 }, summary: "Rate 60 Hz" });
  };
  try {
    const result = await gateway.dispatchGatewayTool("ask_user", input, { auditCall: false, context: { chatId: "fixture", jobId: "fixture", runtimeMode: "auto" } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(forwarded, input);
    assert.deepEqual(JSON.parse(result.content.find(item => item.type === "text")!.text!).values, { hz: 60 });
  } finally { globalThis.fetch = originalFetch; }
  const compatible = await import("../lib/questions");
  assert.equal(compatible.createPendingQuestion, questions.createPendingQuestion);
});
