import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import http from "node:http";
import { randomUUID } from "node:crypto";
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
test("plain credential forms cannot be created or answered through legacy endpoints", async () => {
  const chat = store.createChat("Credential guard", undefined, owner.id);
  const unsafe = {questions:[{question:"Passwort",key:"password",type:"text" as const}]};
  assert.throws(()=>questions.createPendingQuestion(unsafe,chat.id,owner.id),/Protected credentials required/);
  const pending=questions.createPendingQuestion({questions:[{question:"Normal input",key:"value",type:"text"}]},chat.id,owner.id);
  try {
    const row=sqlite.getDatabase().prepare("SELECT data FROM pending_questions WHERE question_id=?").get(pending.questionId) as {data:string};
    const legacy=JSON.parse(row.data);legacy.questions=unsafe.questions.map(q=>({...q,id:"legacy"}));
    sqlite.getDatabase().prepare("UPDATE pending_questions SET data=? WHERE question_id=?").run(JSON.stringify(legacy),pending.questionId);
    const marker="SYNTHETIC-SECRET-MUST-NOT-PERSIST";
    const response=await submit(pending.questionId,{password:marker});
    assert.equal(response.status,409);assert.equal((await response.json()).code,"secure_credentials_required");
    assert.equal(questions.resolveQuestion(pending.questionId,{password:marker},owner.id),false);
    const stored=sqlite.getDatabase().prepare("SELECT data FROM pending_questions WHERE question_id=?").get(pending.questionId) as {data:string};
    assert(!stored.data.includes(marker));assert.equal(JSON.parse(stored.data).status,"waiting_for_user");
    assert(!JSON.stringify(store.getChat(chat.id,owner.id)?.messages).includes(marker));
  } finally { questions.cancelQuestion(pending.questionId,owner.id);pending.stop(); }
});
test("internal tool endpoint rejects login identity requests before creating a question", async () => {
  const chat=store.createChat("Login routing guard",undefined,owner.id);
  const job=jobs.enqueueJob({chatId:chat.id,userId:owner.id,message:"login"});
  const lease=jobs.claimNextJob({workerId:"credential-guard-worker"})!;
  try {
    const response=await internal.POST(new Request("http://localhost/api/internal/mcp-question",{
      method:"POST",headers:{authorization:"Bearer question-test-token","content-type":"application/json",
        "x-ai-chat-id":chat.id,"x-ai-chat-user-id":owner.id,"x-ai-chat-job-id":job.id,
        "x-ai-chat-worker-id":lease.leaseOwner!,"x-ai-chat-lease-token":lease.leaseToken!},
      body:JSON.stringify({title:"Login",questions:[{question:"Username",type:"text"}]}),
    }));
    assert.equal(response.status,400);assert.match((await response.json()).error,/browser_request_login/);
    assert(!store.getChat(chat.id,owner.id)?.pendingQuestion);
  } finally { jobs.updateJob(job.id,{status:"cancelled"}); }
});
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
    const rejected=await gateway.dispatchGatewayTool("ask_user",{questions:[{question:"Passwort",type:"text"}]},{auditCall:false,context:{chatId:"fixture",jobId:"fixture",runtimeMode:"auto"}});
    assert.equal(rejected.isError,true);assert.equal(forwarded,undefined);
    assert.match(rejected.content.find(item=>item.type==="text")!.text!,/browser_request_login/);
    const result = await gateway.dispatchGatewayTool("ask_user", input, { auditCall: false, context: { chatId: "fixture", jobId: "fixture", runtimeMode: "auto" } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(forwarded, input);
    assert.deepEqual(JSON.parse(result.content.find(item => item.type === "text")!.text!).values, { hz: 60 });
  } finally { globalThis.fetch = originalFetch; }
  const compatible = await import("../lib/questions");
  assert.equal(compatible.createPendingQuestion, questions.createPendingQuestion);
});

function internalRequest(chatId: string, jobId: string, lease: { leaseOwner?: string; leaseToken?: string }, body: unknown) {
  return new Request("http://localhost/api/internal/mcp-question", {
    method: "POST", headers: {
      authorization: "Bearer question-test-token", "content-type": "application/json",
      "x-ai-chat-id": chatId, "x-ai-chat-user-id": owner.id, "x-ai-chat-job-id": jobId,
      "x-ai-chat-worker-id": lease.leaseOwner!, "x-ai-chat-lease-token": lease.leaseToken!,
    }, body: JSON.stringify(body),
  });
}

test("private login readiness returns to the agent without opening a question or claiming credential fill", async () => {
  const chat = store.createChat("Login school selection", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Read the assigned homework" });
  const lease = jobs.claimNextJob({ workerId: "school-selection-worker" })!;
  const originalFetch = globalThis.fetch;
  const readiness = { status: "protected_browser_ready", code: "credential_fields_not_visible", missingFields: ["username", "password"] };
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).action, "secure_input_prepare");
    return Response.json(readiness);
  };
  try {
    const response = await internal.POST(internalRequest(chat.id, job.id, lease, { browserLogin: { fields: ["username", "password"] } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), readiness);
    assert.equal(store.getChat(chat.id, owner.id)?.pendingQuestion, undefined);
    assert.equal(jobs.getJob(job.id)?.status, "running");
    const stored = sqlite.getDatabase().prepare("SELECT count(*) AS n FROM pending_questions WHERE job_id = ?").get(job.id) as { n: number };
    assert.equal(stored.n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    jobs.updateJob(job.id, { status: "cancelled" });
  }
});

test("login preparation exposes fixed failure codes while malformed requests remain validation errors", async () => {
  const chat = store.createChat("Login diagnostic boundary", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Read homework" });
  const lease = jobs.claimNextJob({ workerId: "login-error-worker" })!;
  const originalFetch = globalThis.fetch;
  let reply: unknown;
  globalThis.fetch = async () => Response.json(reply, { status: 403 });
  try {
    for (const [payload, expected] of [
      [{ code: "unsafe_target", error: "TEST-PRIVATE-RAW-DIAGNOSTIC" }, "unsafe_target"],
      [{ code: "TEST-PRIVATE-RAW-CODE", error: "TEST-PRIVATE-RAW-DIAGNOSTIC" }, "protected_login_unavailable"],
      [null, "protected_login_unavailable"],
    ] as const) {
      reply = payload;
      const response = await internal.POST(internalRequest(chat.id, job.id, lease, { browserLogin: { fields: ["password"] } }));
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.code, expected);
      assert(!JSON.stringify(body).includes("TEST-PRIVATE"));
    }
    const invalid = await internal.POST(internalRequest(chat.id, job.id, lease, { browserLogin: { fields: ["not-a-credential"] } }));
    assert.equal(invalid.status, 400);
    assert.equal(store.getChat(chat.id, owner.id)?.pendingQuestion, undefined);
    assert.equal(jobs.getJob(job.id)?.status, "running");
  } finally {
    globalThis.fetch = originalFetch;
    jobs.updateJob(job.id, { status: "cancelled" });
  }
});

test("secure completion resumes the original run using only broker-confirmed status", async () => {
  const chat = store.createChat("Read homework after login", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Read homework without changing portal data" });
  const lease = jobs.claimNextJob({ workerId: "secure-resume-worker" })!;
  const requestId = randomUUID();
  const previousSocket = process.env.METIS_BROWSER_LOGIN_SOCKET;
  const previousIsolation = process.env.METIS_NATIVE_ISOLATION;
  process.env.METIS_NATIVE_ISOLATION = "1";
  const socket = path.join(dir, "secure-status.sock");
  const brokerRequests: Array<Record<string, unknown>> = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    brokerRequests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ filled: true, scope: "permanent" }));
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  process.env.METIS_BROWSER_LOGIN_SOCKET = socket;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    status: "input_required",
    secureInput: { requestId, origin: "https://portal.example", expiresAt: new Date(Date.now() + 60000).toISOString(), fields: ["username", "password"] },
  });
  const running = internal.POST(internalRequest(chat.id, job.id, lease, { browserLogin: { fields: ["username", "password"] } }));
  let pendingId: string | undefined;
  try {
    for (let i = 0; i < 50 && !pendingId; i++) {
      pendingId = store.getChat(chat.id, owner.id)?.pendingQuestion?.questionId;
      if (!pendingId) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(pendingId);
    assert.equal(jobs.getJob(job.id)?.status, "waiting_input");
    const clientSecret = "TEST-ACCIDENTAL-CLIENT-SECRET";
    const response = await answer.POST(new Request("http://localhost/api/chat/answer", {
      method: "POST", headers: { cookie, host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ questionId: pendingId, values: { secure_login: clientSecret }, answers: [clientSecret] }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.summary, "Credentials entered securely.");
    assert.match(result.values.secure_login, /entered securely and saved permanently/);
    const resumed = await running;
    assert.equal(resumed.status, 200);
    assert(!JSON.stringify(await resumed.json()).includes(clientSecret));
    assert.equal(jobs.getJob(job.id)?.status, "running");
    assert.equal(jobs.getJob(job.id)?.message, "Read homework without changing portal data");
    assert.match(jobs.getJob(job.id)?.resumePrompt ?? "", /entered securely/);
    assert(!JSON.stringify(store.getChat(chat.id, owner.id)).includes(clientSecret));
    assert(!jobs.getJob(job.id)?.resumePrompt?.includes(clientSecret));
    assert.deepEqual(brokerRequests, [{ owner: owner.id, chat: chat.id, operation: "status", input: { requestId }, management: true }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (pendingId) questions.cancelQuestion(pendingId, owner.id);
    await running.catch(() => undefined);
    if (previousIsolation === undefined) delete process.env.METIS_NATIVE_ISOLATION;
    else process.env.METIS_NATIVE_ISOLATION = previousIsolation;
    if (previousSocket === undefined) delete process.env.METIS_BROWSER_LOGIN_SOCKET;
    else process.env.METIS_BROWSER_LOGIN_SOCKET = previousSocket;
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    jobs.updateJob(job.id, { status: "cancelled" });
  }
});

test("ordinary credential forms are rejected before MCP transmission and API/database persistence", async () => {
  // @ts-expect-error The gateway entrypoint is JavaScript.
  const gateway = await import("../packages/mcp-gateway/index.mjs") as {
    dispatchGatewayTool: (name: string, input: unknown, options: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;
  };
  const marker = "TEST-PRIVATE-FORM-MARKER";
  const unsafe = { questions: [{ question: "Password", key: "password", type: "text", default: marker }] };
  const originalFetch = globalThis.fetch;
  let transmitted = false;
  globalThis.fetch = async () => { transmitted = true; throw Error("An unsafe question reached transport"); };
  try {
    const result = await gateway.dispatchGatewayTool("ask_user", unsafe, { auditCall: false, context: { chatId: "fixture", jobId: "fixture", runtimeMode: "auto" } });
    assert.equal(result.isError, true);
    assert.equal(transmitted, false);
    assert.match(result.content[0].text ?? "", /browser_request_login/);
    assert(!JSON.stringify(result).includes(marker));
  } finally { globalThis.fetch = originalFetch; }

  const chat = store.createChat("Credential-form guards", undefined, owner.id);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner.id, message: "Read homework" });
  const lease = jobs.claimNextJob({ workerId: "credential-form-guard-worker" })!;
  try {
    const response = await internal.POST(internalRequest(chat.id, job.id, lease, unsafe));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "protected_credentials_required");
    assert(!JSON.stringify(body).includes(marker));
    assert.equal(store.getChat(chat.id, owner.id)?.pendingQuestion, undefined);
    assert.throws(() => questions.createPendingQuestion(unsafe as Parameters<typeof questions.createPendingQuestion>[0], chat.id, owner.id), /protected input/);
    const row = sqlite.getDatabase().prepare("SELECT count(*) AS n FROM pending_questions WHERE chat_id = ?").get(chat.id) as { n: number };
    assert.equal(row.n, 0);
  } finally { jobs.updateJob(job.id, { status: "cancelled" }); }
});

test("legacy ordinary credential forms cannot persist direct answers; protected metadata remains usable", async () => {
  const chat = store.createChat("Legacy form boundary", undefined, owner.id);
  const pending = questions.createPendingQuestion({ questions: [{ question: "Which school?", key: "value", type: "text" }] }, chat.id, owner.id);
  const db = sqlite.getDatabase();
  const original = db.prepare("SELECT data FROM pending_questions WHERE question_id = ?").get(pending.questionId) as { data: string };
  const legacy = JSON.parse(original.data);
  legacy.questions[0].question = "Password";
  db.prepare("UPDATE pending_questions SET data = ? WHERE question_id = ?").run(JSON.stringify(legacy), pending.questionId);
  const marker = "TEST-ACCIDENTAL-LEGACY-ANSWER";
  try {
    const response = await submit(pending.questionId, { value: marker });
    assert.equal(response.status, 409);
    const stored = db.prepare("SELECT data FROM pending_questions WHERE question_id = ?").get(pending.questionId) as { data: string };
    assert(!stored.data.includes(marker));
    assert.equal(questions.getPendingQuestion(pending.questionId, owner.id)?.status, "waiting_for_user");
    assert.equal(store.getChat(chat.id, owner.id)?.messages.length, 0);
  } finally { pending.stop(); }
  const protectedQuestion = questions.createPendingQuestion({
    questions: [{ question: "Password", key: "password", type: "text" }],
  }, chat.id, owner.id, { secureBrowserInput: {
    requestId: randomUUID(), origin: "https://portal.example", expiresAt: new Date(Date.now() + 60000).toISOString(),
  } });
  protectedQuestion.stop();
});
