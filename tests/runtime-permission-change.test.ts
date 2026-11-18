import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { RUNTIME_MODES, type RuntimeMode } from "../lib/runtime-mode";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-runtime-change-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root,
  AI_CHAT_ROOT: root, AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp"), AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1", MCP_BEARER_TOKEN: "runtime-change-fixture" });
for (const key of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN", "AI_CHAT_TEST_BYPASS_LEASE"]) delete process.env[key];
const loaded = Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../lib/db-jobs"),
  import("../lib/db-questions"), import("../app/api/internal/mcp-question/route")]);
after(() => rmSync(root, { recursive: true, force: true }));

async function fixture(mode: RuntimeMode = "approval-required", jobOptions: Partial<Pick<import("../lib/jobs").AgentJob, "automationId" | "parentJobId" | "projectHandoffId">> = {}) {
  const [auth, store, jobs, questions, route] = await loaded;
  const owner = auth.createUser(crypto.randomUUID(), "synthetic-fixture-password").id;
  const chat = store.createChat("Permission fixture", undefined, owner);
  store.updateChat(chat.id, { runtimeMode: mode, sessionState: { modeId: "ask" }, approvedPatterns: ["keep-pattern"] }, owner);
  const job = jobs.enqueueJob({ chatId: chat.id, userId: owner, message: "Permission fixture", ...jobOptions });
  const lease = jobs.claimNextJob({ workerId: "permission-fixture-worker" })!;
  assert.equal(lease.id, job.id);
  const headers = { authorization: "Bearer runtime-change-fixture", "content-type": "application/json", "x-ai-chat-control-tool": "request_runtime_mode_change",
    "x-ai-chat-id": chat.id, "x-ai-chat-user-id": owner, "x-ai-chat-job-id": job.id,
    "x-ai-chat-worker-id": lease.leaseOwner!, "x-ai-chat-lease-token": lease.leaseToken! };
  const controller = new AbortController();
  return { owner, chat, job, lease, store, jobs, questions, route, headers, controller,
    request: (runtimeMode: unknown, extra: Record<string, unknown> = {}) => new Request("http://localhost/api/internal/mcp-question", {
      method: "POST", headers, signal: controller.signal, body: JSON.stringify({ runtimeModeChange: { runtimeMode, reason: "Fixture task", ...extra } }),
    }),
    cleanup() { controller.abort(); jobs.updateJob(job.id, { status: "cancelled" }); },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function pending(f: Fixture) {
  for (let i = 0; i < 100; i++) {
    const question = f.store.getChat(f.chat.id, f.owner)?.pendingQuestion;
    if (question) return question;
    await delay(10);
  }
  throw new Error("Confirmation form was not created");
}

test("all four levels require a real typed confirmation and preserve other settings", { timeout: 15_000 }, async () => {
  for (const target of RUNTIME_MODES) {
    const initial = target === "approval-required" ? "auto" : "approval-required";
    const f = await fixture(initial);
    try {
      let returned = false;
      const running = f.route.POST(f.request(target)).then(response => { returned = true; return response; });
      const q = await pending(f);
      assert.equal(q.title, "Change runtime permissions");
      assert.match(q.description!, /Current:.*Requested:/s);
      assert.equal(q.questions[0].default, undefined);
      await delay(50);
      assert.equal(returned, false);
      assert.equal(f.store.getChat(f.chat.id, f.owner)?.runtimeMode, initial);
      assert.equal(f.questions.resolveQuestion(q.questionId, { decision: "approve" }, "foreign-owner"), false);
      assert.ok(f.questions.resolveQuestion(q.questionId, { decision: "approve" }, f.owner, q.version));
      const response = await running;
      assert.equal(response.status, 200);
      assert.equal((await response.json()).switched, true);
      const updated = f.store.getChat(f.chat.id, f.owner)!;
      assert.equal(updated.runtimeMode, target);
      assert.equal(updated.sessionState?.modeId, "ask", "Runtime access must not switch Agent/Plan/Ask");
      assert.deepEqual(updated.approvedPatterns, ["keep-pattern"]);
      const gate = await f.route.GET(new Request("http://localhost/api/internal/mcp-question", { headers: f.headers }));
      assert.equal((await gate.json()).runtimeMode, target);
    } finally { f.cleanup(); }
  }
});

test("denial, custom prose and cancellation never change permissions", { timeout: 10_000 }, async () => {
  for (const decision of ["deny", "approve please", "Accept full access", null]) {
    const f = await fixture();
    try {
      const running = f.route.POST(f.request("full-access"));
      const q = await pending(f);
      if (decision === null) f.questions.cancelQuestionAsResponse(q.questionId, f.owner, q.version);
      else f.questions.resolveQuestion(q.questionId, { decision }, f.owner, q.version);
      const response = await running;
      assert.equal(response.status, 200);
      assert.equal((await response.json()).switched, false);
      assert.equal(f.store.getChat(f.chat.id, f.owner)?.runtimeMode, "approval-required");
    } finally { f.cleanup(); }
  }
});

test("stale confirmation cannot overwrite a newer permission choice", async () => {
  const f = await fixture();
  try {
    const running = f.route.POST(f.request("full-access"));
    const q = await pending(f);
    f.store.updateChat(f.chat.id, { runtimeMode: "auto-accept-edits" }, f.owner);
    f.questions.resolveQuestion(q.questionId, { decision: "approve" }, f.owner);
    const result = await (await running).json();
    assert.equal(result.switched, false);
    assert.equal(result.reason, "permissions_changed_while_waiting");
    assert.equal(f.store.getChat(f.chat.id, f.owner)?.runtimeMode, "auto-accept-edits");
  } finally { f.cleanup(); }
});

test("invalid targets and injected approval/identity fields are rejected before a form", async () => {
  const f = await fixture();
  try {
    for (const target of ["danger-full-access", "", null, 42]) assert.equal((await f.route.POST(f.request(target))).status, 400);
    for (const extra of [{ approved: true }, { userId: "other" }, { reason: "x".repeat(1001) }]) {
      assert.equal((await f.route.POST(f.request("full-access", extra))).status, 400);
    }
    const tunneled = new Request(f.request("full-access"), { headers: { ...f.headers, "x-ai-chat-control-tool": "ask_user" } });
    assert.equal((await f.route.POST(tunneled)).status, 403);
    const bad = new Request(f.request("full-access"), { headers: { ...f.headers, "x-ai-chat-user-id": "foreign" } });
    assert.equal((await f.route.POST(bad)).status, 401);
    assert.equal(f.store.getChat(f.chat.id, f.owner)?.pendingQuestion, undefined);
    assert.equal((await f.route.POST(f.request("approval-required")).then(r => r.json())).reason, "already_active");
  } finally { f.cleanup(); }
});

test("persisted automation and delegation restrictions cannot be removed by headers", async () => {
  for (const patch of [{ automationId: "fixture" }, { parentJobId: "fixture" }, { projectHandoffId: "fixture" }]) {
    const f = await fixture("approval-required", patch);
    try {
      assert.equal((await f.route.POST(f.request("full-access"))).status, 403);
      assert.equal(f.store.getChat(f.chat.id, f.owner)?.pendingQuestion, undefined);
    } finally { f.cleanup(); }
  }
});

test("disconnect and Stop before a late approval do not elevate", async () => {
  for (const stop of [false, true]) {
    const f = await fixture();
    try {
      const running = f.route.POST(f.request("full-access"));
      const q = await pending(f);
      if (stop) {
        f.jobs.updateJob(f.job.id, { status: "cancelled" });
        f.questions.resolveQuestion(q.questionId, { decision: "approve" }, f.owner);
      } else f.controller.abort();
      assert.equal((await running).status, 499);
      assert.equal(f.store.getChat(f.chat.id, f.owner)?.runtimeMode, "approval-required");
    } finally { f.cleanup(); }
  }
});

test("gateway routes runtime requests through server-owned confirmation without runtime approval", async () => {
  const gateway = await import("../lib/mcp-core/gateway-core.mjs");
  const { selectBridgeTools, bridgeToolTimeoutMs } = await import("../lib/mcp-bridge");
  const { USER_INPUT_TRANSPORT_TIMEOUT_MS } = await import("../lib/mcp-core/user-question-gate.mjs");
  const tool = gateway.tools.find((t: { name: string }) => t.name === "request_runtime_mode_change");
  assert.ok(tool);
  const schema = tool.inputSchema as unknown as { properties: { runtimeMode: { enum: readonly string[] } } };
  assert.deepEqual(schema.properties.runtimeMode.enum, RUNTIME_MODES);
  assert.equal(gateway.modeToolCategory(tool.name), "read");
  assert.ok(selectBridgeTools([tool.name]).includes(tool.name));
  assert.equal(bridgeToolTimeoutMs({}, tool.inputSchema), USER_INPUT_TRANSPORT_TIMEOUT_MS);
  const original = globalThis.fetch;
  const context = { chatId: "fixture-chat", userId: "fixture-owner", jobId: "fixture-job", runtimeMode: "approval-required",
    modeId: "ask", modePolicy: JSON.stringify({ allowedCategories: ["read"], toolOverrides: {} }) };
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ switched: true, runtimeMode: "full-access" });
  }) as typeof fetch;
  try {
    const result = await gateway.dispatchGatewayTool(tool.name, { runtimeMode: "full-access", reason: "Fixture" }, { context, auditCall: false });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /mcp-question$/);
    assert.deepEqual(calls[0].body, { runtimeModeChange: { runtimeMode: "full-access", reason: "Fixture" } });
    assert.equal(context.runtimeMode, "full-access");
    assert.equal(context.modeId, "ask");
    const before = calls.length;
    assert.equal((await gateway.dispatchGatewayTool(tool.name, { runtimeMode: "auto" }, { context: { ...context, automation: true }, auditCall: false })).isError, true);
    assert.equal(calls.length, before);
    assert.equal((await gateway.dispatchGatewayTool(tool.name, { runtimeMode: "invalid" }, { context, auditCall: false })).isError, true);
    assert.equal(calls.length, before);
  } finally { globalThis.fetch = original; }
});

test("permission confirmations do not count as work after the user's answer", async () => {
  const { hasUserInputResponse, userInputProgress } = await import("../lib/user-input-progress");
  const empty = { id: "assistant", role: "assistant", content: "" };
  for (const name of ["request_mode_change", "request_runtime_mode_change"]) {
    const confirmation = { ...empty, tools: [{ id: "confirmation", name: "mcp__metis_ai__" + name, result: JSON.stringify({ switched: true }) }] };
    assert.equal(hasUserInputResponse(confirmation), false);
    assert.deepEqual(userInputProgress([confirmation]), userInputProgress([empty]));
  }
  assert.equal(hasUserInputResponse({ ...empty, tools: [{ id: "write", name: "write_file" }] }), true);
});

test("fresh gateway contexts refresh both elevations and restrictions from the authenticated gate", async () => {
  const { awaitUserQuestionGate } = await import("../lib/mcp-core/user-question-gate.mjs");
  for (const mode of RUNTIME_MODES) {
    const context: Record<string, unknown> = { jobId: "job", chatId: "chat", userId: "owner", runtimeMode: "full-access" };
    await awaitUserQuestionGate({ context, url: "http://localhost/gate", token: "fixture", leaseHeaders: { "X-AI-Chat-Worker-Id": "worker", "X-AI-Chat-Lease-Token": "lease" },
      fetcher: async () => Response.json({ waitingForUser: false, runtimeMode: mode }) });
    assert.equal(context.runtimeMode, mode);
  }
});
