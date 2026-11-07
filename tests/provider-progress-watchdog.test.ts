import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";
import type { ProviderResult } from "../lib/providers/adapters/contract";

// Exercise the real runner and persistence in an isolated database, with no
// network/provider calls, production leases, or OS-account provisioning.
const testRoot = mkdtempSync(path.join(os.tmpdir(), "metis-progress-watchdog-"));
process.env.CHAT_DATA_DIR = testRoot;
process.env.CHAT_DB_PATH = path.join(testRoot, "chat.sqlite");
process.env.AI_CHAT_ROOT = testRoot;
process.env.AGENT_CWD = testRoot;
process.env.AI_CHAT_SECRETS_KEY = "00".repeat(32);
process.env.CHAT_PASSWORD = "";
for (const name of [
  "AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN",
  "AI_CHAT_PROVIDER_IDLE_MS", "AI_CHAT_PROVIDER_BUFFERED_IDLE_MS",
  "AI_CHAT_PROVIDER_TOOL_IDLE_MS",
]) delete process.env[name];

async function fixture(t: import("node:test").TestContext) {
  const { getDatabase } = await import("../lib/sqlite");
  const { upsertProviderConnection } = await import("../lib/provider-connections");
  const { createChat, getChat } = await import("../lib/db-store");
  const { enqueueJob, getJob, updateJob } = await import("../lib/db-jobs");
  const { codexAdapter } = await import("../lib/providers/adapters/codex");
  const { runAlternativeProviderJob } = await import("../lib/providers/runner");
  const userId = crypto.randomUUID();
  getDatabase().prepare(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run(userId, userId, "unused-test-hash", new Date().toISOString());
  const connection = upsertProviderConnection(userId, {
    providerKey: "codex", slug: "watchdog", label: "Watchdog test",
    authType: "api_key", secret: "unused-test-key", enabled: true,
  });
  assert.ok(connection, "the test connection was created");
  const modelId = `codex:${connection.id}:watchdog-fixture`;
  const chat = createChat("Watchdog test", undefined, userId, { id: modelId });
  const queued = enqueueJob({ chatId: chat.id, userId, modelId, message: "Test" });
  const job = updateJob(queued.id, { status: "running" })!;
  let context!: ProviderContext;
  let finish!: () => void;
  t.mock.method(codexAdapter, "runTurn", (current: ProviderContext) => {
    context = current;
    return new Promise<ProviderResult>((resolve, reject) => {
      current.signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      finish = () => {
        current.onText("Generation completed.");
        resolve({});
      };
    });
  });
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: Date.now() });
  const run = runAlternativeProviderJob(job, chat);
  assert.ok(context, "the real runner reached the stubbed provider");
  return { run, context, finish, job, chat, getJob, getChat, updateJob };
}

test("real runner completes a buffered generation after four silent minutes", async (t) => {
  const f = await fixture(t);
  t.mock.timers.tick(4 * 60_000);
  assert.equal(f.context.signal!.aborted, false);
  assert.equal(f.getJob(f.job.id)?.status, "running");
  f.finish();
  await f.run;
  assert.equal(f.getJob(f.job.id)?.status, "completed");
  assert.equal(f.getChat(f.chat.id)?.messages.at(-1)?.content, "Generation completed.");
});

test("real runner still terminates a buffered stream at the fifteen-minute limit", async (t) => {
  const f = await fixture(t);
  t.mock.timers.tick(15 * 60_000 - 5_000);
  assert.equal(f.context.signal!.aborted, false);
  t.mock.timers.tick(5_000);
  await f.run;
  assert.equal(f.context.signal!.aborted, true);
  assert.equal(f.getJob(f.job.id)?.status, "error");
  assert.match(f.getJob(f.job.id)?.error || "", /no progress for 900 seconds/);
});

test("real runner retains the thirty-minute active-tool limit", async (t) => {
  const f = await fixture(t);
  f.context.onTool({ id: "slow-tool", name: "execute_command", kind: "shell", status: "running" });
  t.mock.timers.tick(20 * 60_000);
  assert.equal(f.context.signal!.aborted, false);
  t.mock.timers.tick(10 * 60_000);
  await f.run;
  assert.equal(f.getJob(f.job.id)?.status, "error");
  assert.match(f.getJob(f.job.id)?.error || "", /Agent tool execute_command.*1800 seconds/);
});

test("model switching hands off buffered generation within the existing poll interval", async (t) => {
  const f = await fixture(t);
  const nextModelId = f.job.modelId + "-next";
  f.updateJob(f.job.id, { pendingModelId: nextModelId });
  t.mock.timers.tick(250);
  await f.run;
  assert.equal(f.context.signal!.aborted, true);
  assert.equal(f.getJob(f.job.id)?.status, "switching");
  assert.equal(f.getJob(f.job.id)?.modelId, nextModelId);
  const continuation = f.getJob(f.job.id)?.resumePrompt || "";
  assert.match(continuation, /Continue only unfinished work/);
  assert.match(continuation, /Do not repeat completed (?:work|tools)/);
});

test("user cancellation interrupts buffered generation within the existing poll interval", async (t) => {
  const f = await fixture(t);
  f.updateJob(f.job.id, { status: "cancelled" });
  t.mock.timers.tick(250);
  await f.run;
  assert.equal(f.context.signal!.aborted, true);
  assert.equal(f.getJob(f.job.id)?.status, "cancelled");
});


test("real runner records expired-lease diagnostics and the supervisor publishes the failure", async (t) => {
  const f = await fixture(t);
  const { getDatabase } = await import("../lib/sqlite");
  const { queryErrorLogs } = await import("../lib/error-logs");
  const { persistWorkerFailureMessage } = await import("../lib/worker-failure");
  const token = crypto.randomUUID();
  getDatabase().prepare(
    "INSERT INTO job_leases (job_id, worker_id, lease_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(f.job.id, "expired-worker", token, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 121000).toISOString());
  process.env.AI_CHAT_JOB_ID = f.job.id;
  process.env.AI_CHAT_WORKER_ID = "expired-worker";
  process.env.AI_CHAT_JOB_LEASE_TOKEN = token;
  try {
    t.mock.timers.tick(30_000);
    await f.run;
    assert.equal(f.context.signal!.aborted, true);
    const log = queryErrorLogs({ chatId: f.chat.id }).find(entry => entry.message.includes("lost its worker lease"));
    assert.ok(log);
    assert.equal((log.context?.lease as { leaseState: string }).leaseState, "expired");
    assert.ok(!JSON.stringify(log.context).includes(token));
    assert.equal(f.getJob(f.job.id)?.status, "running", "the stale child cannot commit a terminal state");
  } finally {
    delete process.env.AI_CHAT_JOB_ID;
    delete process.env.AI_CHAT_WORKER_ID;
    delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
  }
  f.updateJob(f.job.id, { status: "error", error: "Worker lease lost" });
  persistWorkerFailureMessage(f.job.id, "Worker lease lost");
  assert.equal(f.getChat(f.chat.id)?.messages.at(-1)?.errorMessage, "Worker lease lost");
});
