import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-provider-retry-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"),
  AI_CHAT_ROOT: dir, AGENT_CWD: dir, AI_CHAT_SECRETS_KEY: "00".repeat(32),
});
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
after(() => rmSync(dir, { recursive: true, force: true }));

async function fixture(enabled = true, incognito = false) {
  const sqlite = await import("../lib/sqlite");
  const connections = await import("../lib/provider-connections");
  const store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs");
  const settings = await import("../lib/provider-retry-settings");
  const sessions = await import("../lib/providers/session-bindings");
  const { codexAdapter } = await import("../lib/providers/adapters/codex");
  const { runAlternativeProviderJob } = await import("../lib/providers/runner");
  const userId = crypto.randomUUID();
  sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, userId, "unused", new Date().toISOString());
  const connection = connections.upsertProviderConnection(userId, {
    providerKey: "codex", slug: "retry-fixture", label: "Retry fixture",
    authType: "api_key", secret: "unused", enabled: true,
  })!;
  const modelId = `codex:${connection.id}:fixture-model`;
  const chat = store.createChat("Retry fixture", undefined, userId, { id: modelId });
  store.appendMessage(chat.id, { id: "user-prompt", role: "user", content: "Complete this task" }, userId);
  const queued = jobs.enqueueJob({ chatId: chat.id, userId, modelId, message: "Complete this task", messageId: "user-prompt", incognito });
  const job = jobs.claimNextJob({ workerId: "retry-worker" })!;
  assert.equal(job.id, queued.id);
  if (enabled) settings.saveProviderRetryEnabled(userId, true);
  return { sqlite, jobs, store, settings, sessions, userId, connection, chat, job, codexAdapter, runAlternativeProviderJob };
}

test("real provider runner retries after cleanup, keeps the session/checkpoint and adds only collapsible events", async t => {
  const f = await fixture();
  let calls = 0;
  let previousSignal: AbortSignal | undefined;
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    if (calls === 1) {
      previousSignal = context.signal;
      f.sessions.updateProviderSessionBinding({
        chatId: f.chat.id, ownerId: f.userId, execution: "codex-sdk",
        connectionId: f.connection.id, contextOwner: "native",
        candidateCursor: "persistent-thread", promoteCursor: true,
      });
      context.onText("First step completed.");
      context.onTool({ id: "saved-tool", name: "fixture", status: "completed", result: "Saved output" });
      context.onTool({ id: "unfinished-tool", name: "fixture_pending", status: "running" });
      throw new Error("Model is under capacity");
    }
    assert.notEqual(context.signal, previousSignal);
    assert.equal(f.sqlite.getDatabase().prepare("SELECT lease_token FROM job_leases WHERE job_id = ?").get(f.job.id)?.lease_token, f.job.leaseToken);
    assert.equal(f.sessions.getProviderSessionBinding(context.chat, "codex-sdk", f.connection.id)?.lastKnownGoodCursor, "persistent-thread");
    assert.match(context.job.resumePrompt!, /same run/);
    const progress = context.chat.messages.find(message => message.content === "First step completed.")!;
    assert.equal(progress.tools?.[0]?.status, "completed");
    assert.equal(progress.tools?.[1]?.status, "error");
    assert.equal(progress.errorMessage, undefined);
    assert.equal(progress.parts?.at(-1)?.type, "provider-retry");
    context.onText("Remaining step completed.");
    return { agentId: "codex:persistent-thread" };
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(calls, 2);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed", f.jobs.getJob(f.job.id)?.error);
  assert.equal(f.jobs.getJob(f.job.id)?.providerRetryCount, 1);
  const messages = f.store.getChat(f.chat.id, f.userId)!.messages;
  assert.deepEqual(messages.filter(message => message.role === "user").map(message => message.content), ["Complete this task"]);
  const events = f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id) as Array<{ id: number; event: string; data: unknown }>;
  const retry = events.find(event => (event.data as { status?: string }).status === "retrying_provider")!;
  assert.equal((retry.data as { message: string }).message, "Error occurred, continuing… (1/3)");
  assert.match((retry.data as { detail: string }).detail, /under capacity/);
  const terminalTool = events.find(event => event.event === "tool"
    && (event.data as { callId?: string }).callId === "unfinished-tool"
    && (event.data as { status?: string }).status === "error")!;
  assert.ok(terminalTool, "the live tool must stop before the retry status");
  assert.ok(events.indexOf(terminalTool) < events.indexOf(retry));
  assert.equal(events.filter(event => event.event === "error").length, 0);
});

test("unknown Codex reconnect crashes continue from the checkpoint", async t => {
  const f = await fixture();
  let calls = 0;
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    if (calls === 1) {
      context.onText("Saved progress before disconnect.");
      throw new Error("Reconnecting 2/5: stream disconnected before completion");
    }
    assert.match(context.job.resumePrompt!, /Original task/);
    context.onText("Continued successfully.");
    return {};
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(calls, 2);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  assert.equal(f.jobs.getJob(f.job.id)?.providerRetryCount, 1);
});

for (const duringAbort of [false, true]) test(`Codex model handoff uses the new model (abort ${duringAbort})`, async t => {
  const f = await fixture();
  const nextModelId = `codex:${f.connection.id}:fixture-next`;
  let calls = 0;
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    if (calls === 1) {
      context.onText("Progress under original model.");
      f.jobs.requestJobModelSwitch(f.chat.id, f.userId, nextModelId);
      if (duringAbort) await new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("CLI aborted during handoff")), { once: true });
      });
      return {};
    }
    assert.equal(context.modelId, "fixture-next");
    assert.match(context.job.resumePrompt!, /Original task/);
    context.onText("Finished under new model.");
    return {};
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "switching");
  const parts = f.store.getChat(f.chat.id, f.userId)!.messages.flatMap(message => message.parts || []);
  const switched = parts.find(part => part.type === "model-switch");
  assert.ok(switched && switched.type === "model-switch");
  assert.equal(switched.fromModelId, f.job.modelId);
  assert.equal(switched.toModelId, nextModelId);
  assert.equal(f.jobs.getJob(f.job.id)?.providerRetryCount || 0, 0);
  f.jobs.requeueSwitchingJob(f.job.id);
  const resumed = f.jobs.claimNextJob()!;
  await f.runAlternativeProviderJob(resumed, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  assert.equal(calls, 2);
});

test("switching a model during a provider wait immediately uses the new selection", async t => {
  const f = await fixture();
  const before = process.env.AI_CHAT_PROVIDER_LIMIT_WAITER;
  process.env.AI_CHAT_PROVIDER_LIMIT_WAITER = "1";
  t.after(() => { if (before === undefined) delete process.env.AI_CHAT_PROVIDER_LIMIT_WAITER; else process.env.AI_CHAT_PROVIDER_LIMIT_WAITER = before; });
  let calls = 0;
  const deadline = new Date(Date.now() + 600_000).toISOString();
  f.jobs.updateJob(f.job.id, { agentRuntimeDeadlineAt: deadline });
  t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("Usage limit reached"), { statusCode: 429, responseHeaders: { "retry-after": "18000" } });
    assert.equal(context.modelId, "fixture-next");
    context.onText("Finished after switching.");
    return {};
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "queued");
  assert.ok(f.store.getChat(f.chat.id, f.userId)!.messages.flatMap(m => m.parts || []).some(p => p.type === "provider-wait"));
  assert.equal(f.jobs.claimNextJob(), null);
  const waitStarted = Date.parse(f.jobs.getJob(f.job.id)!.providerRateLimit!.detectedAt);
  t.mock.timers.enable({ apis: ["Date"], now: waitStarted + 3_600_000 });
  f.jobs.requestJobModelSwitch(f.chat.id, f.userId, `codex:${f.connection.id}:fixture-next`);
  assert.equal(f.jobs.getJob(f.job.id)?.agentRuntimeDeadlineAt, new Date(Date.parse(deadline) + 3_600_000).toISOString());
  assert.equal(f.jobs.getJob(f.job.id)?.providerRateLimit, undefined);
  const next = f.jobs.claimNextJob()!;
  assert.equal(next.id, f.job.id);
  await f.runAlternativeProviderJob(next, f.chat);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "completed");
  assert.equal(calls, 2);
});

test("persistent transient errors stop after the third retry and retain the final error", async t => {
  const f = await fixture();
  let calls = 0;
  t.mock.method(f.codexAdapter, "runTurn", async () => {
    calls++;
    throw new Error("Model is under capacity");
  });
  await f.runAlternativeProviderJob(f.job, f.chat);
  assert.equal(calls, 4);
  assert.equal(f.jobs.getJob(f.job.id)?.providerRetryCount, 3);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "error");
  const messages = f.store.getChat(f.chat.id, f.userId)!.messages;
  assert.equal(messages.flatMap(message => message.parts ?? []).filter(part => part.type === "provider-retry").length, 3);
  assert.match(messages.at(-1)?.errorMessage ?? "", /under capacity/);
});

for (const scenario of ["default-off", "permanent", "usage-unknown-reset", "cancelled", "disabled-after-first"] as const) {
  test(`real provider runner respects ${scenario}`, async t => {
    const f = await fixture(scenario !== "default-off");
    let calls = 0;
    t.mock.method(f.codexAdapter, "runTurn", async () => {
      calls++;
      if (scenario === "cancelled") f.jobs.cancelAgentJob(f.job.id, f.userId);
      if (scenario === "disabled-after-first" && calls === 2) f.settings.saveProviderRetryEnabled(f.userId, false);
      if (scenario === "permanent") throw Object.assign(new Error("Permission denied"), { statusCode: 403 });
      if (scenario === "usage-unknown-reset") throw Object.assign(new Error("Usage limit reached"), { statusCode: 429 });
      throw new Error("Model is under capacity");
    });
    await f.runAlternativeProviderJob(f.job, f.chat);
    assert.equal(calls, scenario === "disabled-after-first" ? 2 : scenario === "permanent" || scenario === "usage-unknown-reset" ? 4 : 1);
    assert.equal(f.jobs.getJob(f.job.id)?.status, scenario === "cancelled" ? "cancelled" : "error");
  });
}

test("stop between retry checkpoint and next attempt prevents any new provider call", async t => {
  const f = await fixture();
  const retries = await import("../lib/provider-retry-runner");
  let attempts = 0;
  await retries.runWithProviderRetries(f.job, async job => {
    attempts++;
    assert.equal(retries.requestProviderRetry(job.id, new Error("Model is under capacity"), () => {}), true);
    f.jobs.cancelAgentJob(job.id, f.userId);
  });
  assert.equal(attempts, 1);
  assert.equal(f.jobs.getJob(f.job.id)?.status, "cancelled");
});

test("stale worker cannot consume a retry or publish a checkpoint/status", async () => {
  const f = await fixture();
  const { requestProviderRetry } = await import("../lib/provider-retry-runner");
  let checkpointed = false;
  Object.assign(process.env, {
    AI_CHAT_JOB_ID: f.job.id, AI_CHAT_WORKER_ID: f.job.leaseOwner,
    AI_CHAT_JOB_LEASE_TOKEN: "stale-token",
  });
  try {
    assert.equal(requestProviderRetry(f.job.id, new Error("Model is under capacity"), () => { checkpointed = true; }), false);
  } finally {
    for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
  }
  assert.equal(checkpointed, false);
  assert.equal(f.jobs.getJob(f.job.id)?.providerRetryCount, undefined);
  assert.equal(f.jobs.listRunEvents(f.chat.id, f.userId, 0, f.job.id).length, 0);
  f.jobs.cancelAgentJob(f.job.id, f.userId);
});

for (const incognito of [false, true]) {
  test(`native provider recovery keeps a never-accepted task and supplied answer (incognito ${incognito})`, async t => {
    const f = await fixture(true, incognito);
    const { nativeRecoveryPrompt, providerTaskMessage } = await import("../lib/providers/adapters/provider-support");
    const suppliedAnswer = "The user answered: work only in directory beta.";
    const job = f.jobs.updateJob(f.job.id, { resumePrompt: suppliedAnswer })!;
    let calls = 0;
    t.mock.method(f.codexAdapter, "runTurn", async (context: ProviderContext) => {
      calls++;
      // Neither failed request establishes a native session or accepts this task.
      if (calls < 3) throw new Error("Model is under capacity");
      assert.equal(f.sessions.getProviderSessionBinding(context.chat, "codex-sdk", f.connection.id), undefined);
      for (const prompt of [nativeRecoveryPrompt(context), providerTaskMessage(context.job)]) {
        assert.ok(prompt.includes(job.message), "Codex/Claude native prompt must retain the original request");
        assert.ok(prompt.includes(suppliedAnswer), "the supplied answer must survive repeated retries");
        assert.match(prompt, /Do not repeat completed tools, side effects/);
      }
      assert.equal(context.job.resumePrompt!.split(job.message).length - 1, 1);
      assert.equal(context.job.resumePrompt!.split(suppliedAnswer).length - 1, 1);
      context.onText("Finished remaining work.");
      return {};
    });
    await f.runAlternativeProviderJob(job, f.chat);
    assert.equal(calls, 3);
    assert.equal(f.jobs.getJob(job.id)?.status, "completed", f.jobs.getJob(job.id)?.error);
    assert.deepEqual(f.store.getChat(f.chat.id, f.userId)!.messages.filter(message => message.role === "user")
      .map(message => message.content), [job.message]);
  });
}
