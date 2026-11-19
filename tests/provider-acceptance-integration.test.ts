import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";

// Set every storage boundary BEFORE loading application modules. No .env or live DB.
const root = mkdtempSync(path.join(os.tmpdir(), "metis-acceptance-integration-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
  CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root,
  AI_CHAT_SECRETS_KEY: "ac".repeat(32), CHAT_PASSWORD: "",
  METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const imports = Promise.all([
  import("../lib/auth"), import("../lib/provider-connections"),
  import("../lib/providers/discovery"), import("../lib/providers/acceptance-service"),
  import("../app/api/providers/acceptance/route"), import("../app/api/providers/acceptance/[id]/route"),
  import("../lib/db-jobs"), import("../lib/db-store"), import("../lib/sqlite"),
  import("../lib/model-access"), import("../lib/providers/acceptance-probes"),
]);
let m: Awaited<typeof imports>;
let owner: string, foreign: string, token: string, foreignToken: string, connection: string;
let target: any;
let baseUrl = "";
const requests: any[] = [];
const nativeFetch = globalThis.fetch;
const server = createServer(async (req, res) => {
  try {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ body, authorization: req.headers.authorization, url: req.url });
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(body.model, "fixture-exact-model");
    assert.equal(req.headers.authorization, "Bearer protected-fake-key");
    const nonce = JSON.stringify(body.messages).match(/Remember this test marker for the next turn: ([a-f0-9]{36})/)?.[1];
    assert.ok(nonce, "fixture only answers a genuine baseline prompt");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (content: string) => res.write("data: " + JSON.stringify({
      id: "fixture-completion", object: "chat.completion.chunk", created: 1,
      model: body.model, choices: [{ index: 0, delta: { content }, finish_reason: null }],
    }) + "\n\n");
    chunk(nonce + " This is a real local transport fixture. ");
    await new Promise(resolve => setTimeout(resolve, 25));
    chunk("Incremental response delivered through the unchanged AI SDK adapter.");
    res.write("data: " + JSON.stringify({ id: "fixture-completion", object: "chat.completion.chunk",
      created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }) + "\n\n");
    res.end("data: [DONE]\n\n");
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
before(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + (server.address() as any).port + "/v1";
  // Fail closed on ALL non-fixture networking, including accidental paid calls.
  globalThis.fetch = ((input: any, init: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.ok(url.startsWith(baseUrl + "/"), "unexpected network destination: " + url);
    return nativeFetch(input, init);
  }) as typeof fetch;
  m = await imports;
  owner = m[0].createUser("acceptance-owner", "synthetic-password").id;
  foreign = m[0].createUser("acceptance-foreign", "synthetic-password").id;
  token = m[0].authenticateUser("acceptance-owner", "synthetic-password")!.token;
  foreignToken = m[0].authenticateUser("acceptance-foreign", "synthetic-password")!.token;
  m[9].ensureAllModelAccess(owner);
  // Synthetic admin mapping avoids creating/deleting host OS users. The local
  // compatible adapter is in-process; this is NOT an OS-isolation certification.
  const access = await import("../lib/user-access");
  const host = os.userInfo();
  const identity = host.uid === 0 ? access.lookupPosixUser("nobody")! : host;
  assert.ok(identity);
  m[8].getDatabase().prepare("UPDATE users SET is_admin=1 WHERE id=?").run(owner);
  m[8].getDatabase().prepare(
    "INSERT INTO user_workspace_access(user_id,workspace_root,os_username,uid,gid,created_at,updated_at) VALUES(?,?,?,?,?,'fixture','fixture')"
  ).run(owner, path.join(root, "owner"), identity.username, identity.uid, identity.gid);
  mkdirSync(path.join(root, "owner"), { recursive: true });
  mkdirSync(path.join(root, "foreign"), { recursive: true });
  m[8].getDatabase().prepare(
    "INSERT INTO user_workspace_access(user_id,workspace_root,created_at,updated_at) VALUES(?,?,'fixture','fixture')"
  ).run(foreign, path.join(root, "foreign"));
  connection = m[1].upsertProviderConnection(owner, { providerKey: "compatible", slug: "local-fixture",
    label: "Local fixture", authType: "api_key", baseUrl, secret: "protected-fake-key", enabled: true })!.id;
  m[2].persistDiscoveredModels(connection, [{ id: "fixture-exact-model", displayName: "Fixture",
    contextWindow: 32768, contextWindowDiscovered: true,
    capabilities: { streaming: true, tools: false, vision: true } }]);
  target = m[3].acceptanceOverview(owner).matrix.find(t => t.connectionId === connection);
  assert.ok(target?.modelKey);
});
after(async () => {
  globalThis.fetch = nativeFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});
function req(body?: unknown, session = token, origin = "http://localhost") {
  return new Request("http://localhost/api/providers/acceptance", {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: "ai_chat_auth=" + session, origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function selection(patch = {}) { return { confirmLive: true, maxTurns: 2, timeoutMs: 15000,
  targetIds: [target.id], checks: ["response", "streaming", "persistence"], ...patch }; }
async function create(patch = {}) {
  const response = await m[4].POST(req(selection(patch)));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).report;
}
const stored = (id: string) => JSON.parse((m[8].getDatabase().prepare(
  "SELECT data FROM provider_acceptance_reports WHERE id=?").get(id) as any).data);
const jobCount = () => (m[8].getDatabase().prepare("SELECT COUNT(*) AS n FROM jobs").get() as any).n;
const cancel = (id: string) => m[3].cancelAcceptanceReport(owner, id);

test("API authentication, CSRF, consent, limits and owner-isolated reads/exports/actions", async () => {
  assert.equal((await m[4].GET(req(undefined, ""))).status, 401);
  assert.equal((await m[4].POST(req(selection(), ""))).status, 401);
  assert.equal((await m[4].POST(req(selection(), token, "https://attacker.invalid"))).status, 403);
  for (const patch of [{ confirmLive: false }, { confirmLive: "true" }, { maxTurns: 0 },
    { maxTurns: 21 }, { maxTurns: 1.5 }, { timeoutMs: 14999 }, { timeoutMs: 300001 },
    { checks: ["browser"] }, { checks: [] }, { targetIds: [] }]) {
    assert.equal((await m[4].POST(req(selection(patch)))).status, 400, JSON.stringify(patch));
  }
  assert.equal((await m[4].POST(req(selection({ targetIds: ["foreign-or-missing"] })))).status, 404);
  const count = jobCount(), report = await create();
  for (const format of ["", "?format=json", "?format=html", "?format=markdown"]) {
    const request = new Request("http://localhost/api/providers/acceptance/" + report.id + format,
      { headers: { cookie: "ai_chat_auth=" + foreignToken } });
    assert.equal((await m[5].GET(request, params(report.id))).status, 404);
  }
  assert.equal((await m[5].POST(req({ action: "next" }, foreignToken), params(report.id))).status, 404);
  assert.equal((await m[5].POST(req({ action: "cancel" }, token, "https://attacker.invalid"), params(report.id))).status, 403);
  assert.equal((await m[5].GET(req(), params(report.id))).status, 200);
  assert.equal(jobCount(), count, "creation and GET never enqueue");
  assert.equal(requests.length, 0);
  assert.doesNotMatch(JSON.stringify(report), /protected-fake-key/);
  cancel(report.id);
});

test("concurrent Next reserves one stable message ID; real local SSE crosses worker/adapter/persistence", async t => {
  // Only MCP server assembly is stubbed to empty. Transport, adapter, worker,
  // auth, protected connection secrets, durable events and DB writes are real.
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve("../lib/mcp");
  const original = require(modulePath);
  require.cache[modulePath]!.exports = { ...original, getMcpServers: () => ({ gateway: { type: "fixture" } }) };
  const bridgePath = require.resolve("../lib/mcp-bridge");
  const bridge = require(bridgePath);
  require.cache[bridgePath]!.exports = { ...bridge, mcpBridgeTools: async () => ({}) };
  t.after(() => {
    require.cache[modulePath]!.exports = original;
    require.cache[bridgePath]!.exports = bridge;
  });
  const report = await create();
  t.after(() => cancel(report.id));
  const before = jobCount();
  await Promise.all(Array.from({ length: 5 }, () => m[5].POST(req({ action: "next" }), params(report.id))));
  const run = stored(report.id);
  assert.equal(jobCount(), before + 1);
  assert.equal(run.report.turnsUsed, 1);
  const job = m[6].getJobForMessageId(run.active.chatId, run.active.messageId)!;
  assert.ok(job, "authenticated submit must enqueue");
  assert.equal(job.modelId, target.modelKey);
  assert.equal(job.providerAcceptance?.reportId, report.id);
  // Simulate loss of submission response, not another submission: recovery uses
  // the already persisted message ID and must rediscover the same job.
  delete run.active.jobId;
  m[8].getDatabase().prepare("UPDATE provider_acceptance_reports SET data=? WHERE id=?").run(JSON.stringify(run), report.id);
  await m[5].POST(req({ action: "next" }), params(report.id));
  assert.equal(stored(report.id).active.jobId, job.id);
  assert.equal(jobCount(), before + 1);
  const claimed = m[6].claimNextJob({ workerId: "acceptance-local-worker" })!;
  assert.equal(claimed.id, job.id);
  mkdirSync(path.join(root, "agent-traces"), { recursive: true });
  const { runQueuedJob } = await import("../lib/worker-runner");
  await runQueuedJob(claimed);
  assert.equal(m[6].getJob(job.id)?.status, "completed", m[6].getJob(job.id)?.error);
  assert.equal(requests.length, 1, "actual HTTP request, no simulated live result");
  const observedJobs = jobCount();
  const result = m[3].acceptanceOverview(owner).latest!;
  assert.equal(jobCount(), observedJobs, "refresh reconciles saved evidence without dispatching another job");
  const cells = result.targets.find(t => t.id === target.id)!.cells;
  for (const check of ["response", "streaming", "persistence"]) {
    assert.equal(cells.find(c => c.check === check)?.status, "passed", JSON.stringify(cells));
  }
});

test("changed exact connection blocks without selecting another connection or model", async () => {
  const report = await create();
  const before = jobCount();
  m[1].updateProviderConnection(connection, owner, { enabled: false });
  try {
    const result = await m[3].advanceAcceptanceReport(owner, report.id, req());
    assert.equal(jobCount(), before);
    assert.equal(result.report.targets.find(t => t.id === target.id)!.cells.find(c => c.check === "response")!.status, "blocked");
  } finally { m[1].updateProviderConnection(connection, owner, { enabled: true }); cancel(report.id); }
});

test("agent-runtime cancels by persisted deadline without any browser/polling connection", async () => {
  const chat = m[7].createChat("Disconnected deadline fixture", undefined, owner, { id: target.modelKey });
  const job = m[6].enqueueJob({ chatId: chat.id, userId: owner, modelId: target.modelKey, message: "never send",
    providerAcceptance: { reportId: "deadline-fixture", deadlineAt: new Date(Date.now() + 50).toISOString() } });
  const unrelatedChat = m[7].createChat("Unrelated", undefined, foreign);
  const unrelated = m[6].enqueueJob({ chatId: unrelatedChat.id, userId: foreign, message: "never send" });
  const { armAgentRuntime } = await import("../lib/agent-runtime");
  const disarm = armAgentRuntime(job);
  try {
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(m[6].getJob(job.id)?.status, "cancelled");
    assert.equal(m[6].getJob(unrelated.id)?.status, "queued");
  } finally { disarm(); m[6].cancelAgentJob(unrelated.id, foreign); }
});

test("confirmed turn limit and pending-report cap cannot be bypassed", async () => {
  const report = await create({ maxTurns: 1, checks: ["response", "vision"] });
  const second = await create(), third = await create();
  try {
    assert.equal((await m[4].POST(req(selection()))).status, 409);
    await m[5].POST(req({ action: "next" }), params(report.id));
    const run = stored(report.id);
    const job = m[6].getJobForMessageId(run.active.chatId, run.active.messageId)!;
    assert.ok(job);
    const count = jobCount();
    m[6].cancelAgentJob(job.id, owner, "Interrupted fixture");
    await m[5].POST(req({ action: "next" }), params(report.id));
    assert.equal(jobCount(), count, "turn budget must prevent the vision job");
    const result = m[3].getAcceptanceReport(owner, report.id).report;
    const cells = result.targets.find(t => t.id === target.id)!.cells;
    assert.notEqual(cells.find(c => c.check === "response")!.status, "passed");
    assert.equal(cells.find(c => c.check === "vision")!.status, "blocked");
    assert.equal(result.turnsUsed, 1);
  } finally { for (const r of [report, second, third]) cancel(r.id); }
});

test("cancellation must prove the exact selected connection/model, not an unrelated stopped job", () => {
  const result = m[10].verifyAcceptanceProbe({
    probe: { targetId: target.id, kind: "cancellation", checks: ["cancellation"] },
    target, challenge: { nonce: "unused", numbers: [], sum: 0 }, checkedAt: new Date().toISOString(),
    observation: {
      job: { id: "wrong-job", chatId: "wrong-chat", modelId: "other-model", status: "cancelled" } as any,
      message: { id: "wrong-answer", content: "", role: "assistant",
        runMetadata: { providerId: "other-provider", connectionId: "other-connection", modelId: "other-model" } } as any,
      textEvents: 2, textBeforeDone: 2, wasRunning: true, cancelRequested: true, leaseReleased: true,
    },
  });
  assert.notEqual(result[0].status, "passed", "unrelated cancellation is not selected-provider evidence");
});

test("pure evidence verifier rejects fabricated, interrupted and mismatched results", () => {
  const challenge = { nonce: "independent-marker", numbers: [12, 23], sum: 35, colors: Array(9).fill("red") };
  const message: any = { id: "answer", role: "assistant", content: challenge.nonce, tools: [],
    runMetadata: { providerId: target.providerKey, connectionId: connection, modelId: target.modelId } };
  const observation: any = { job: { id: "pure-job", chatId: "pure-chat", status: "completed", modelId: target.modelKey },
    message, persistedMessage: structuredClone(message), streamedAnswerMatches: true,
    fixturePaths: { input: "input.json", output: "output.json" }, textEvents: 2, textBeforeDone: 2,
    wasRunning: true, leaseReleased: true, cancelRequested: true,
    executionIdentity: { providerId: target.providerKey, connectionId: connection, modelId: target.modelId } };
  const verify = (kind: any, checks: any[], patch: any = {}, msg: any = message) => m[10].verifyAcceptanceProbe({
    probe: { targetId: target.id, kind, checks }, target, challenge, checkedAt: new Date().toISOString(),
    observation: { ...observation, ...patch, message: msg } });
  assert.ok(verify("baseline", ["response", "streaming", "persistence"]).every(c => c.status === "passed"));
  for (const status of ["queued", "running", "cancelled", "failed", "waiting_input"]) {
    assert.ok(verify("baseline", ["response", "streaming", "persistence"], {
      job: { ...observation.job, status },
    }).every(c => c.status !== "passed"), status);
  }
  assert.equal(verify("baseline", ["streaming"], { textBeforeDone: 1 })[0].status, "failed");
  assert.equal(verify("baseline", ["persistence"], { streamedAnswerMatches: false })[0].status, "failed");
  assert.equal(verify("baseline", ["persistence"], { persistedMessage: { ...message, content: "other" } })[0].status, "failed");
  for (const runMetadata of [{ ...message.runMetadata, connectionId: "other" },
    { ...message.runMetadata, modelId: "fallback" }, { ...message.runMetadata, providerId: "other" }]) {
    assert.equal(verify("baseline", ["response"], {}, { ...message, runMetadata })[0].status, "failed");
  }
  assert.equal(verify("continuation", ["continuation"])[0].status, "passed");
  assert.equal(verify("continuation", ["continuation"], {}, { ...message, content: "wrong" })[0].status, "failed");
  assert.equal(verify("vision", ["vision"], {}, { ...message, content: Array(9).fill("red").join(" ") })[0].status, "passed");
  assert.equal(verify("vision", ["vision"], {}, { ...message, content: "red" })[0].status, "failed");
  const tools = ["read_file", "write_file"].map((name, i) => ({ type: "tool", name,
    input: i ? "output.json" : "input.json", status: "completed", source: "mcp" }));
  const fileOutput = JSON.stringify({ nonce: challenge.nonce, sum: challenge.sum });
  assert.equal(verify("mcp", ["mcp"], { fileOutput }, { ...message, tools })[0].status, "passed");
  for (const badTools of [[], tools.map(tool => ({ ...tool, source: "native" })), tools.map(tool => ({ ...tool, status: "failed" }))]) {
    assert.equal(verify("mcp", ["mcp"], { fileOutput }, { ...message, tools: badTools })[0].status, "failed");
  }
  assert.equal(verify("mcp", ["mcp"], { fileOutput: "{}" }, { ...message, tools })[0].status, "failed");
  const cancelled = { ...observation.job, status: "cancelled" };
  assert.equal(verify("cancellation", ["cancellation"], { job: cancelled })[0].status, "passed");
  for (const patch of [{ wasRunning: false }, { leaseReleased: false }, { cancelRequested: false }]) {
    assert.equal(verify("cancellation", ["cancellation"], { job: cancelled, ...patch })[0].status, "failed");
  }
});
