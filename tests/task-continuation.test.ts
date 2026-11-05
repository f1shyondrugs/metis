import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";
import type { ChatMessage, ToolPart } from "../lib/store";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-task-continuation-"));
mkdirSync(path.join(dir, "agent-traces"));
Object.assign(process.env, {
  CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"),
  AI_CHAT_ROOT: dir, AGENT_CWD: dir, AI_CHAT_SECRETS_KEY: "00".repeat(32), AI_CHAT_MCP_STATE_DIR: path.join(dir, "mcp-state"),
});
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
test.after(() => rmSync(dir, { recursive: true, force: true }));

const loaded = Promise.all([
  import("../lib/sqlite"), import("../lib/db-store"), import("../lib/db-jobs"),
  import("../lib/provider-connections"), import("../lib/task-continuation"),
]);
const todo = (status = "pending"): ToolPart => ({
  id: "tasks", name: "write_todos", kind: "todo", status: "completed",
  input: JSON.stringify({ todos: [{ id: "verify", content: "Verify the export", status }] }),
});
const partial = (id = "current"): ChatMessage => ({
  id, role: "assistant", content: "The artifact is saved; verification remains.", createdAt: "2026-10-31T10:00:00.000Z", tools: [todo()],
});

async function fixture(goal: string | null = "Deliver and verify the export", providerKey: "codex" | "cursor" = "codex") {
  const [sqlite, store, jobs, connections, continuation] = await loaded;
  const userId = crypto.randomUUID();
  sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, userId, "unused", new Date().toISOString());
  const connection = connections.upsertProviderConnection(userId, {
    providerKey, slug: "continuation-fixture", label: "Continuation fixture", authType: "api_key", secret: "unused", enabled: true,
  })!;
  const modelId = `${providerKey}:${connection.id}:fixture-model`;
  const chat = store.createChat("Goal continuation", undefined, userId, { id: modelId });
  store.updateChat(chat.id, { sessionState: { goal } }, userId);
  store.appendMessage(chat.id, { id: "user", role: "user", content: "Build the export" }, userId);
  const deadline = new Date(Date.now() + 600_000).toISOString();
  const queued = jobs.enqueueJob({ chatId: chat.id, userId, modelId, message: "Build the export", messageId: "user", agentRuntimeDeadlineAt: deadline });
  const job = jobs.claimNextJob({ workerId: "continuation-worker" })!;
  assert.equal(job.id, queued.id);
  return { sqlite, store, jobs, continuation, userId, connection, modelId, chat, job, deadline };
}

test("real alternative runner hands off unfinished Goal work after cleanup, with no duplicate writer or model-switch event", async t => {
  const f = await fixture();
  const [{ codexAdapter }, { runAlternativeProviderJob }] = await Promise.all([
    import("../lib/providers/adapters/codex"), import("../lib/providers/runner"),
  ]);
  let calls = 0;
  t.mock.method(codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    context.onText(calls === 1 ? "Artifact saved. Verification remains." : "Export verified.");
    context.onTool(todo(calls === 1 ? "in_progress" : "completed"));
    if (calls === 2) {
      assert.match(context.job.resumePrompt!, /Verify the export/);
      assert.match(context.job.resumePrompt!, /Build the export/);
      assert.equal(context.job.agentRuntimeDeadlineAt, f.deadline);
    }
    return { agentId: "codex:fixture-thread" };
  });
  await runAlternativeProviderJob(f.job, f.chat);
  const first = f.jobs.getJob(f.job.id)!;
  assert.equal(first.status, "switching");
  assert.equal(first.taskContinuationCount, 1);
  assert.equal(first.modelId, f.modelId);
  assert.equal(first.agentRuntimeDeadlineAt, f.deadline);
  assert.equal(f.jobs.isJobLeaseActive(first.id, f.job.leaseOwner!, f.job.leaseToken!), false);
  assert.equal(f.jobs.claimNextJob(), null, "handoff must wait for the old process to retire");
  assert.equal(f.store.getChat(f.chat.id)!.messages.at(-1)!.content, "Artifact saved. Verification remains.");
  f.jobs.requeueSwitchingJob(first.id);
  const resumed = f.jobs.claimNextJob()!;
  assert.equal(resumed.id, first.id);
  await runAlternativeProviderJob(resumed, f.store.getChat(f.chat.id)!);
  assert.equal(f.jobs.getJob(first.id)!.status, "completed");
  assert.equal(calls, 2);
  const messages = f.store.getChat(f.chat.id)!.messages;
  assert.equal(messages.filter(message => message.role === "user").length, 1);
  assert.equal(messages.flatMap(message => message.parts || []).some(part => part.type === "model-switch"), false);
  const events = f.jobs.listRunEvents(f.chat.id, f.userId, 0, first.id);
  assert.equal(events.filter(event => "event" in event && event.event === "done").length, 1);
});

test("real Cursor success exit uses the same bounded Goal handoff and preserves its session", async t => {
  const f = await fixture(undefined, "cursor");
  const require = createRequire(import.meta.url);
  const sdk = require("@cursor/sdk") as typeof import("@cursor/sdk");
  const mcpPath = require.resolve("../lib/mcp");
  const mcp = require(mcpPath), cached = require.cache[mcpPath]!, original = cached.exports;
  cached.exports = { ...mcp, getMcpServers: () => ({}) };
  t.after(() => { cached.exports = original; });
  const [access, discovery, runner] = await Promise.all([
    import("../lib/model-access"), import("../lib/providers/discovery"), import("../lib/worker-runner"),
  ]);
  access.ensureAllModelAccess(f.userId);
  discovery.persistDiscoveredModels(f.connection.id, [{ id: "fixture-model", displayName: "Fixture" }]);
  let calls = 0, disposals = 0;
  const agent = () => ({
    agentId: "fixture-cursor-session",
    async send(prompt: string, options: { onDelta: (data: { update: Record<string, unknown> }) => void }) {
      calls++;
      if (calls === 2) assert.match(prompt, /Verify the export/);
      options.onDelta({ update: { type: "text-delta", text: calls === 1 ? "Artifact saved." : "Export verified." } });
      options.onDelta({ update: { type: "tool-call-completed", callId: "tasks", name: "write_todos", input: JSON.parse(todo(calls === 1 ? "in_progress" : "completed").input!), status: "completed" } });
      return { async *stream() {}, async wait() { return { status: "completed" }; }, async cancel() {} };
    },
    async [Symbol.asyncDispose]() { disposals++; },
  });
  t.mock.method(sdk.Agent, "create", async () => agent() as unknown as Awaited<ReturnType<typeof sdk.Agent.create>>);
  t.mock.method(sdk.Agent, "resume", async () => {
    assert.equal(disposals, 1);
    return agent() as unknown as Awaited<ReturnType<typeof sdk.Agent.resume>>;
  });
  await runner.runQueuedJob(f.job);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "switching", JSON.stringify(f.store.getChat(f.chat.id)!.messages));
  assert.equal(disposals, 1);
  assert.equal(f.jobs.claimNextJob(), null);
  f.jobs.requeueSwitchingJob(f.job.id);
  const resumed = f.jobs.claimNextJob()!;
  await runner.runQueuedJob(resumed);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "completed");
  assert.equal(calls, 2);
  assert.equal(disposals, 2);
  assert.equal(f.jobs.getJob(f.job.id)!.agentRuntimeDeadlineAt, f.deadline);
});

test("real Deep Research runner cannot finish before its approved report is attached", async t => {
  const f = await fixture(null);
  f.jobs.updateJob(f.job.id, { modeId: "deep-research" });
  const [{ codexAdapter }, { runAlternativeProviderJob }, { createResearchWorkflow }] = await Promise.all([
    import("../lib/providers/adapters/codex"), import("../lib/providers/runner"), import("../lib/mcp-core/research-workflow.mjs"),
  ]);
  const context = { userId: f.userId, chatId: f.chat.id, jobId: f.job.id };
  const workflow = createResearchWorkflow({
    stateDir: path.join(dir, "mcp-state"),
    ask: async () => ({ questionId: "approved-fixture", values: { decision: "approve", plan: ["Read evidence", "Write report"], source_target: 1, minimum_words: 500 } }),
    evidence: async () => ({ readCount: 1 }),
    attachReport: async () => ({ downloadUrl: "/fixture-report.md", markdown: "[Report](/fixture-report.md)" }),
  });
  await workflow.plan({ title: "Fixture research", plan: ["Read evidence", "Write report"] }, context);
  let calls = 0;
  t.mock.method(codexAdapter, "runTurn", async (providerContext: ProviderContext) => {
    calls++;
    if (calls === 1) providerContext.onText("Evidence gathering is incomplete.");
    else {
      assert.match(providerContext.job.resumePrompt!, /already approved Deep Research plan/);
      await workflow.report({ title: "Fixture report", content: "evidence ".repeat(500) }, context);
      providerContext.onText("The report is attached.");
    }
    return {};
  });
  await runAlternativeProviderJob(f.jobs.getJob(f.job.id)!, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "switching");
  assert.equal(f.jobs.getJob(f.job.id)!.researchContinuationState?.count, 1);
  assert.equal(f.jobs.claimNextJob(), null);
  f.jobs.requeueSwitchingJob(f.job.id);
  await runAlternativeProviderJob(f.jobs.claimNextJob()!, f.store.getChat(f.chat.id)!);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "completed");
  assert.equal((await workflow.state(context))!.status, "report_attached");
  assert.equal(calls, 2);
});

test("a stop arriving during the async completion check cannot fall through to successful finalization", async () => {
  const f = await fixture();
  f.jobs.updateJob(f.job.id, { status: "cancelled" });
  assert.equal(f.continuation.requestTaskContinuation({
    jobId: f.job.id, assistantMessage: partial(), outcome: "success", checkpoint: () => assert.fail("cancelled checkpoint"),
  }), true);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "cancelled");
  assert.equal(f.jobs.getJob(f.job.id)!.taskContinuationCount, undefined);
});

test("an active Goal cannot relaunch research that the user explicitly denied or cancelled", async () => {
  const f = await fixture();
  const saved = partial();
  assert.equal(f.continuation.requestTaskContinuation({
    jobId: f.job.id, assistantMessage: saved, outcome: "success",
    research: { required: false, stopped: true },
    checkpoint: () => assert.fail("deliberately stopped research must not checkpoint a continuation"),
  }), false);
  const job = f.jobs.getJob(f.job.id)!;
  assert.equal(job.status, "running", "normal successful finalization remains available");
  assert.equal(job.taskContinuationCount, undefined);
  assert.equal(job.researchContinuationState, undefined);
  assert.equal(f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id).some(event => "event" in event && event.event === "error"), false);
  f.jobs.updateJob(f.job.id, { status: "completed" });
});

test("an expired lease cannot checkpoint, release the real writer or schedule work", async () => {
  const f = await fixture();
  process.env.AI_CHAT_WORKER_ID = f.job.leaseOwner;
  process.env.AI_CHAT_JOB_LEASE_TOKEN = "wrong-token";
  try {
    assert.equal(f.continuation.requestTaskContinuation({
      jobId: f.job.id, assistantMessage: partial(), outcome: "success", checkpoint: () => assert.fail("stale writer checkpoint"),
    }), true);
    assert.equal(f.jobs.getJob(f.job.id)!.status, "running");
    assert.equal(f.jobs.isJobLeaseActive(f.job.id, f.job.leaseOwner!, f.job.leaseToken!), true);
  } finally {
    delete process.env.AI_CHAT_WORKER_ID;
    delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
    f.jobs.updateJob(f.job.id, { status: "cancelled" });
  }
});

test("a pending form in authoritative storage blocks continuation even without the chat projection", async () => {
  const f = await fixture();
  const questions = await import("../lib/db-questions");
  const question = questions.createPendingQuestion([{ question: "Account?", type: "text" }], f.chat.id, f.userId, { jobId: f.job.id, runId: f.job.id });
  try {
    assert.equal(f.continuation.requestTaskContinuation({
      jobId: f.job.id, assistantMessage: partial(), outcome: "success", checkpoint: () => {},
    }), true);
    assert.equal(f.jobs.getJob(f.job.id)!.status, "waiting_input");
    assert.equal(f.jobs.getJob(f.job.id)!.userInputWriterEnded, true);
    assert.equal(f.jobs.getJob(f.job.id)!.taskContinuationCount, undefined);
  } finally {
    question.stop();
    f.jobs.updateJob(f.job.id, { status: "cancelled" });
  }
});

test("an exhausted Goal repair budget preserves the partial work and reports incomplete rather than completed", async () => {
  const f = await fixture();
  f.jobs.updateJob(f.job.id, { taskContinuationCount: 2 });
  const saved = partial();
  assert.equal(f.continuation.requestTaskContinuation({
    jobId: f.job.id, assistantMessage: saved, outcome: "success",
    checkpoint: () => { f.store.appendMessage(f.chat.id, saved, f.userId); },
  }), true);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "error");
  assert.match(f.jobs.getJob(f.job.id)!.error!, /not completed/);
  assert.equal(f.store.getChat(f.chat.id)!.messages.at(-1)!.content, saved.content);
  assert.equal(f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id).some(event => "event" in event && event.event === "done"), false);
});

test("Research repair count resets only for changed authoritative progress and retains the deadline", async () => {
  const f = await fixture(null);
  for (const [index, signature] of ["sources:10", "sources:10", "sources:20", "sources:20", "sources:20"].entries()) {
    assert.equal(f.continuation.requestTaskContinuation({
      jobId: f.job.id, assistantMessage: { ...partial("attempt-" + index), tools: [] }, outcome: "success",
      research: { required: true, prompt: "Open the remaining sources and deliver the report.", signature }, checkpoint: () => {},
    }), true);
    const saved = f.jobs.getJob(f.job.id)!;
    assert.equal(saved.agentRuntimeDeadlineAt, f.deadline);
    if (index === 4) {
      assert.equal(saved.status, "error");
      assert.match(saved.error!, /without new verified progress/);
    } else {
      assert.equal(saved.status, "switching");
      assert.equal(saved.researchContinuationState?.count, index % 2 + 1);
      assert.equal(saved.researchContinuationState?.signature, signature);
      assert.equal(f.jobs.claimNextJob(), null);
      f.jobs.requeueSwitchingJob(f.job.id);
      assert.equal(f.jobs.claimNextJob()!.id, f.job.id);
    }
  }
});

test("a deadline reached during completion cancels canonically instead of extending or completing the run", async () => {
  const f = await fixture();
  f.jobs.updateJob(f.job.id, { agentRuntimeDeadlineAt: new Date(Date.now() - 1).toISOString() });
  const saved = partial();
  assert.equal(f.continuation.requestTaskContinuation({
    jobId: f.job.id, assistantMessage: saved, outcome: "success",
    checkpoint: () => { f.store.appendMessage(f.chat.id, saved, f.userId); },
  }), true);
  const job = f.jobs.getJob(f.job.id)!;
  assert.equal(job.status, "cancelled");
  assert.equal(job.cancellationCause, "runtime_limit");
  assert.equal(job.taskContinuationCount, undefined);
  assert.equal(f.store.getChat(f.chat.id)!.runStatus, "cancelled");
  assert.equal(f.store.getChat(f.chat.id)!.messages.at(-1)!.content, saved.content);
});

test("checkpoint failure rolls back the handoff and keeps the original writer lease", async () => {
  const f = await fixture();
  assert.throws(() => f.continuation.requestTaskContinuation({
    jobId: f.job.id, assistantMessage: partial(), outcome: "success", checkpoint: () => { throw new Error("checkpoint failed"); },
  }), /checkpoint failed/);
  assert.equal(f.jobs.getJob(f.job.id)!.status, "running");
  assert.equal(f.jobs.getJob(f.job.id)!.taskContinuationCount, undefined);
  assert.equal(f.jobs.isJobLeaseActive(f.job.id, f.job.leaseOwner!, f.job.leaseToken!), true);
  f.jobs.updateJob(f.job.id, { status: "cancelled" });
});
