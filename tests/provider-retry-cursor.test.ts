import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-cursor-retry-"));
mkdirSync(path.join(dir, "agent-traces"));
Object.assign(process.env, {
  CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"),
  AI_CHAT_ROOT: dir, AGENT_CWD: dir, AI_CHAT_SECRETS_KEY: "00".repeat(32), AI_CHAT_PROVIDER_LIMIT_WAITER: "1",
});
for (const name of ["AI_CHAT_JOB_ID", "AI_CHAT_WORKER_ID", "AI_CHAT_JOB_LEASE_TOKEN"]) delete process.env[name];
after(() => rmSync(dir, { recursive: true, force: true }));

for (const incognito of [false, true]) for (const phase of ["create", "send", "send-with-tool", "result", "usage-reset", "switch-send", "switch-result"] as const) {
  test(`real Cursor runner preserves the task through ${phase} failure (incognito ${incognito})`, async t => {
    const require = createRequire(import.meta.url);
    const sdk = require("@cursor/sdk") as typeof import("@cursor/sdk");
    // Stub only transport configuration and SDK calls; keep the real runner/store.
    const mcpPath = require.resolve("../lib/mcp");
    const mcp = require(mcpPath);
    const cached = require.cache[mcpPath]!;
    const original = cached.exports;
    cached.exports = { ...mcp, getMcpServers: () => ({}) };
    t.after(() => { cached.exports = original; });
    const [store, jobs, connections, access, discovery, settings, sqlite, runner] = await Promise.all([
      import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/provider-connections"),
      import("../lib/model-access"), import("../lib/providers/discovery"),
      import("../lib/provider-retry-settings"), import("../lib/sqlite"), import("../lib/worker-runner"),
    ]);
    const userId = crypto.randomUUID();
    sqlite.getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, userId, "unused", new Date().toISOString());
    access.ensureAllModelAccess(userId);
    settings.saveProviderRetryEnabled(userId, true);
    const connection = connections.upsertProviderConnection(userId, {
      providerKey: "cursor", slug: "cursor-retry", label: "Cursor retry",
      authType: "api_key", secret: "unused", enabled: true,
    })!;
    discovery.persistDiscoveredModels(connection.id, [{ id: "fixture-model", displayName: "Fixture" }, { id: "fixture-next", displayName: "Next fixture" }]);
    const modelId = `cursor:${connection.id}:fixture-model`;
    const switching = phase === "switch-send" || phase === "switch-result";
    const chat = store.createChat("Cursor retry", undefined, userId, { id: modelId });
    const originalTask = "Read alpha.txt and report its exact SHA256 digest.";
    const suppliedAnswer = "The user answered: use the directory worktree-b.";
    const messageId = crypto.randomUUID();
    store.appendMessage(chat.id, { id: messageId, role: "user", content: originalTask }, userId);
    const queued = jobs.enqueueJob({
      chatId: chat.id, userId, modelId, message: originalTask, messageId, incognito,
      ...(phase === "create" ? { resumePrompt: suppliedAnswer } : {}),
    });
    const job = jobs.claimNextJob()!;
    assert.equal(job.id, queued.id);
    let creates = 0, sends = 0, disposals = 0, resumes = 0;
    const prompts: string[] = [];
    const makeAgent = () => ({
      agentId: "fixture-session",
      async send(prompt: string, options: { onDelta: (data: { update: { type: string; text?: string; [key: string]: unknown } }) => void }) {
        sends++;
        prompts.push(prompt);
        assert.ok(prompt.includes(originalTask), "the actual SDK prompt must retain the original task");
        if (phase === "create") assert.ok(prompt.includes(suppliedAnswer), "a supplied answer must survive the retry");
        if (sends === 1 && phase === "switch-send") {
          jobs.requestJobModelSwitch(chat.id, userId, `cursor:${connection.id}:fixture-next`);
          throw new Error("Provider stopped during model handoff");
        }
        if (sends === 1 && phase === "usage-reset") throw new Error("Usage limit reached", {
          cause: { statusCode: 429, responseHeaders: { "retry-after": "60" } },
        });
        if (sends === 1 && (phase === "send" || phase === "send-with-tool")) {
          if (phase === "send-with-tool") options.onDelta({ update: {
            type: "tool-call-started", callId: "unfinished-cursor-tool", name: "fixture_pending", status: "running",
          } });
          throw new Error("Model is under capacity");
        }
        if (phase === "create" || sends === 2) options.onDelta({ update: { type: "text-delta", text: "Finished remaining work." } });
        return {
          async *stream() {},
          async wait() {
            if (sends === 1 && phase === "switch-result") jobs.requestJobModelSwitch(chat.id, userId, `cursor:${connection.id}:fixture-next`);
            return sends === 1 && phase === "result"
              ? { status: "error", error: { message: "Model is under capacity" } }
              : { status: "completed", result: "Finished remaining work." };
          },
          async cancel() {},
        };
      },
      async [Symbol.asyncDispose]() { disposals++; },
    });
    t.mock.method(sdk.Agent, "create", async (options: Parameters<typeof sdk.Agent.create>[0]) => {
      creates++;
      if (switching && creates === 2) assert.equal(typeof options.model === "string" ? options.model : options.model?.id, "fixture-next");
      if (creates === 1 && phase === "create") throw new Error("Model is under capacity");
      return makeAgent() as unknown as Awaited<ReturnType<typeof sdk.Agent.create>>;
    });
    t.mock.method(sdk.Agent, "resume", async (agentId: string) => {
      assert.equal(agentId, "fixture-session");
      assert.equal(disposals, 1, "the failed attempt must finish disposal before retry");
      resumes++;
      return makeAgent() as unknown as Awaited<ReturnType<typeof sdk.Agent.resume>>;
    });
    await runner.runQueuedJob(job);
    if (switching) {
      assert.equal(jobs.getJob(job.id)?.status, "switching");
      const events = store.getChat(chat.id, userId)!.messages.flatMap(message => message.parts || []);
      const switched = events.find(event => event.type === "model-switch");
      assert.ok(switched && switched.type === "model-switch");
      assert.equal(switched.fromModelId, modelId);
      assert.equal(switched.toModelId, `cursor:${connection.id}:fixture-next`);
      jobs.requeueSwitchingJob(job.id);
      const next = jobs.claimNextJob()!;
      assert.equal(next.id, job.id);
      await runner.runQueuedJob(next);
    }
    if (phase === "usage-reset") {
      const waiting = jobs.getJob(job.id)!;
      assert.equal(waiting.status, "queued");
      assert.equal(jobs.claimNextJob(), null);
      t.mock.timers.enable({ apis: ["Date"], now: Date.parse(waiting.providerRateLimit!.resetAt) });
      const resumed = jobs.claimNextJob()!;
      assert.equal(resumed.id, job.id);
      await runner.runQueuedJob(resumed);
    }
    if (phase === "send-with-tool") {
      const events = jobs.listRunEvents(chat.id, userId, 0, job.id).map(row => {
        assert.ok("event" in row && typeof row.event === "string");
        const data: unknown = row.data;
        assert.ok(data && typeof data === "object");
        return {
          event: row.event,
          callId: "callId" in data ? data.callId : undefined,
          status: "status" in data ? data.status : undefined,
        };
      });
      const terminalTool = events.findIndex(event => event.event === "tool"
        && event.callId === "unfinished-cursor-tool" && event.status === "error");
      const retry = events.findIndex(event => event.status === "retrying_provider");
      assert.ok(terminalTool >= 0 && terminalTool < retry, "the live tool must stop before the retry status");
    }
    assert.equal(sends, phase === "create" ? 1 : 2);
    assert.equal(creates, phase === "create" || switching ? 2 : 1);
    assert.equal(resumes, phase === "create" || switching ? 0 : 1);
    assert.equal(disposals, phase === "create" ? 1 : 2);
    assert.match(prompts.at(-1)!, /Do not repeat completed tools/);
    assert.equal(jobs.getJob(job.id)?.status, "completed", jobs.getJob(job.id)?.error);
    assert.equal(jobs.getJob(job.id)?.providerRetryCount ?? 0, phase === "usage-reset" || switching ? 0 : 1);
    const messages = store.getChat(chat.id, userId)!.messages;
    assert.deepEqual(messages.filter(message => message.role === "user").map(message => message.content), [originalTask]);
    assert.equal(messages.flatMap(message => message.parts ?? []).filter(part => part.type === "provider-retry").length, phase === "usage-reset" || switching ? 0 : 1);
    assert.equal(messages.at(-1)?.content, "Finished remaining work.");
  });
}
