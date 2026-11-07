import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import {
  contextModeOf,
 CONTEXT_COMPACT_RATIO,
  effectiveContextBudget,
  estimateContextTokens,
  contextWindowForSelection,
} from "../lib/context-window";
import {
  compactChatHistoryForPrompt,
  compactProviderMessages,
  codexReasoningEffortForSelection,
  codexServiceTierForSelection,
} from "../lib/providers/runner";
import { nativeRecoveryPrompt, providerConversationPrompt, type ProviderContext } from "../lib/providers/adapters/provider-support";
import { providerSessionNeedsCompaction } from "../lib/providers/session-bindings";
import { readFileSync } from "node:fs";
import type { Chat } from "../lib/store";

const toolHistory: ModelMessage[] = [
  { role: "user", content: "Keep the current task and file state." },
  {
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "read-1",
      toolName: "read_file",
      input: { path: "/workspace/src/important.ts", offset: 1, limit: 200 },
    }],
  },
  {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "read-1",
      toolName: "read_file",
      output: {
        type: "text",
        value: `${"large file content ".repeat(4_000)}\nERROR: preserve this failure\nTODO: keep this todo`,
      },
    }],
  },
  { role: "assistant", content: "The file needs a focused fix." },
  { role: "user", content: "Continue without repeating completed work." },
  { role: "assistant", content: "Latest tail must remain available." },
];

test("compaction counts large tool payloads and stays within the effective budget", () => {
  const budget = effectiveContextBudget(4_000);
  const compacted = compactProviderMessages(toolHistory, 4_000);
  const estimated = compacted.reduce((sum, message) => sum + estimateContextTokens(message), 0);

  assert.ok(estimated <= budget, `estimated ${estimated} exceeds budget ${budget}`);
  assert.ok(JSON.stringify(compacted).includes("[metis-context-recap:v1]"));
  assert.ok(JSON.stringify(compacted).includes("Latest tail must remain available."));
});

test("compaction is deterministic and idempotent", () => {
  const once = compactProviderMessages(toolHistory, 4_000);
  const twice = compactProviderMessages(once, 4_000);
  assert.deepEqual(twice, once);
});

test("limited mode reduces the effective budget explicitly", () => {
  assert.equal(contextModeOf([{ id: "contextMode", value: "limited" }]), "limited");
  assert.ok(effectiveContextBudget(200_000, "limited") < effectiveContextBudget(200_000, "normal"));
});

test("native provider sessions rotate into managed compaction at the shared threshold", () => {
  assert.equal(providerSessionNeedsCompaction({ lastContextTokens: 7_999 }, 10_000), false);
  assert.equal(providerSessionNeedsCompaction({ lastContextTokens: 8_000 }, 10_000), true);
  assert.equal(providerSessionNeedsCompaction({ lastContextTokens: 80_000 }, undefined), false);
});

test("compaction triggers at exactly 80% of the actual context window", () => {
  const contextWindow = 10_000;
  const threshold = Math.floor(contextWindow * CONTEXT_COMPACT_RATIO);
  const tokensOf = (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    messages.reduce((sum, message) => sum + estimateContextTokens(message), 0);
  const make = (chars: number) => [
    { role: "user" as const, content: "x".repeat(Math.max(1, chars)) },
    { role: "assistant" as const, content: "tail" },
  ];
  let chars = threshold * 4;
  while (chars > 4 && tokensOf(make(chars)) >= threshold) chars -= 32;
  const below = make(chars);
  let atChars = chars + 32;
  while (tokensOf(make(atChars)) < threshold) atChars += 32;
  const at = make(atChars);
  const belowEvents: Array<Record<string, unknown>> = [];
  const atEvents: Array<Record<string, unknown>> = [];
  compactProviderMessages(below, contextWindow, "normal", (event) => belowEvents.push(event));
  compactProviderMessages(at, contextWindow, "normal", (event) => atEvents.push(event));
  assert.equal(threshold, 8_000);
  assert.ok(tokensOf(below) < threshold);
  assert.ok(tokensOf(at) >= threshold);
  assert.equal(belowEvents.length, 0);
  assert.equal(atEvents[0]?.status, "started");
  assert.equal(atEvents[0]?.systemTriggered, true);
  assert.equal(atEvents[0]?.kind, "compaction");
  assert.equal(atEvents[0]?.id, atEvents.at(-1)?.id);
});

test("measured provider usage forces compaction below the transcript estimate", () => {
  const events: Array<Record<string, unknown>> = [];
  compactProviderMessages(
    [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
    10_000,
    "normal",
    (event) => events.push(event),
    8_000,
  );
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
});

test("measured compaction reports provider usage and removes locally scaled history", () => {
  const messages: ModelMessage[] = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `${index}: ${"context ".repeat(2_500)}`,
  }));
  const estimated = messages.reduce((sum, message) => sum + estimateContextTokens(message), 0);
  const measured = 1_040_000;
  const events: Array<Record<string, unknown>> = [];

  compactProviderMessages(messages, 1_050_000, "normal", (event) => events.push(event), measured);

  assert.equal(events[0]?.beforeTokens, measured);
  assert.equal(events.at(-1)?.beforeTokens, measured);
  assert.ok(Number(events.at(-1)?.removedMessages) >= 2);
  assert.ok(Number(events.at(-1)?.afterTokens) < estimated);
});

test("compaction emits a structured start and completion event", () => {
  const events: Array<Record<string, unknown>> = [];
  compactProviderMessages(toolHistory, 4_000, "normal", (event) => events.push(event));
  assert.equal(events[0]?.type, "compaction");
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(typeof events.at(-1)?.afterTokens, "number");
});

function managedProviderContext(events: Array<Record<string, unknown>>): ProviderContext {
  return {
    chat: {
      id: "provider-compaction-chat",
      modelParams: [{ id: "context", value: "4k" }],
      messages: [
        { id: "u1", role: "user", content: "x".repeat(20_000), createdAt: "t" },
        { id: "a1", role: "assistant", content: "Keep the latest state.", createdAt: "t" },
        { id: "live", role: "user", content: "Continue.", createdAt: "t" },
      ],
    },
    job: {
      id: "provider-compaction-job",
      chatId: "provider-compaction-chat",
      messageId: "live",
      message: "Continue.",
      modelId: "openai:test:gpt-5",
      modelParams: [{ id: "context", value: "4k" }],
    },
    connection: {
      id: "test",
      providerKey: "openai",
      label: "Test",
      enabled: true,
      authType: "api_key",
      secret: "test",
      config: {},
    },
    modelId: "gpt-5",
    signal: new AbortController().signal,
    onText: () => undefined,
    onTool: () => undefined,
    onThinking: () => undefined,
    onStream: () => undefined,
    onCompaction: (event: Parameters<ProviderContext["onCompaction"]>[0]) => {
      events.push(event);
    },
  } as unknown as ProviderContext;
}

test("native provider recovery surfaces managed compaction events", () => {
  const events: Array<Record<string, unknown>> = [];
  nativeRecoveryPrompt(managedProviderContext(events));
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
});

test("stateless provider prompts surface managed compaction events", () => {
  const events: Array<Record<string, unknown>> = [];
  providerConversationPrompt(managedProviderContext(events));
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
});

test("Codex reasoning effort accepts only supported values", () => {
  assert.equal(
    codexReasoningEffortForSelection("gpt-5.6", [{ id: "effort", value: "xhigh" }]),
    "xhigh",
  );
  assert.equal(
    codexReasoningEffortForSelection("gpt-6-astra", [{ id: "effort", value: "ultra" }]),
    "ultra",
  );
  assert.equal(
    codexReasoningEffortForSelection("claude-opus-4-6", [{ id: "effort", value: "high" }]),
    undefined,
  );
  assert.equal(
    codexReasoningEffortForSelection("gpt-5.6", [{ id: "effort", value: "unsupported" }]),
    undefined,
  );
});

test("Codex speed selection maps provider tiers and legacy fast toggles", () => {
  assert.equal(codexServiceTierForSelection([{ id: "speed", value: "ultrafast" }]), "ultrafast");
  assert.equal(codexServiceTierForSelection([{ id: "fast", value: "true" }]), "fast");
  assert.equal(codexServiceTierForSelection([{ id: "fast", value: "false" }]), "default");
  assert.equal(codexServiceTierForSelection([{ id: "speed", value: "not valid" }]), undefined);
});

test("272K is selected only by an explicit matching context selection", () => {
  const model = { id: "gpt-5.6-sol", providerId: "cursor" };
  assert.notEqual(contextWindowForSelection(model), 272_000);
  assert.equal(
    contextWindowForSelection(model, [{ id: "context", value: "272k" }]),
    272_000,
  );
});

const workerSource = readFileSync(new URL("../lib/worker-runner.ts", import.meta.url), "utf8");

test("Cursor SDK prompt compaction uses the same 80% recap and skips the live turn", () => {
  const chat = {
    messages: [
      { id: "u1", role: "user", content: "Keep the current task and file state.", createdAt: "t" },
      {
        id: "a1",
        role: "assistant",
        content: "The file needs a focused fix.",
        createdAt: "t",
        tools: [{
          id: "read-1",
          name: "read_file",
          status: "completed",
          input: JSON.stringify({ path: "/workspace/src/important.ts" }),
          result: `${"large file content ".repeat(4_000)}\nERROR: preserve this failure\nTODO: keep this todo`,
        }],
      },
      { id: "u2", role: "user", content: "Continue without repeating completed work.", createdAt: "t" },
      { id: "live", role: "user", content: "LIVE_TURN_MUST_NOT_APPEAR", createdAt: "t" },
    ],
  } as Chat;
  const events: Array<Record<string, unknown>> = [];
  const result = compactChatHistoryForPrompt(chat, {
    excludeMessageId: "live",
    contextWindow: 4_000,
    onCompaction: (event) => events.push(event),
  });
  assert.equal(result.compacted, true);
  assert.match(result.text, /\[metis-context-recap:v1\]/);
  assert.doesNotMatch(result.text, /LIVE_TURN_MUST_NOT_APPEAR/);
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
});

test("Cursor SDK prompt compaction is a no-op below 80% of the window", () => {
  const chat = {
    messages: [
      { id: "u1", role: "user", content: "Short question.", createdAt: "t" },
      { id: "a1", role: "assistant", content: "Short answer.", createdAt: "t" },
    ],
  } as Chat;
  const events: Array<Record<string, unknown>> = [];
  const result = compactChatHistoryForPrompt(chat, {
    contextWindow: 200_000,
    onCompaction: (event) => events.push(event),
  });
  assert.equal(result.compacted, false);
  assert.equal(events.length, 0);
  assert.match(result.text, /Short question/);
});

test("Cursor native session owns context instead of replaying Metis-compacted history", () => {
  assert.match(workerSource, /getProviderSessionBinding/);
  assert.match(workerSource, /contextOwner:\s*\"native\"/);
  assert.doesNotMatch(workerSource, /agent = \(job\.agentId \|\| chat\.agentId\) && !historyCompacted/);
});

test("Cursor send includes native vision images and persists queued follow-ups server-side", () => {
  const uploads = readFileSync(new URL("../lib/uploads.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(uploads, /export function visionImagesForAttachments/);
  assert.match(worker, /drainNextQueuedMessage\(chatId, userId\)/);
  assert.match(worker, /getActiveParentJob\(chatId\)/);
  assert.match(worker, /drainPersistedChatQueues\(\);/);
  assert.match(shell, /function persistQueuedFollowUps/);
  assert.match(shell, /persistQueuedFollowUps\(current\.chatId, current\.queuedMessages, true\)/);
  assert.match(shell, /pagehide/);
  assert.doesNotMatch(shell, /shouldAutoDrainQueue\(\{/);
});


test("system messages remain byte-for-byte intact and outside the compaction recap", () => {
  const system: ModelMessage = { role: "system", content: "SYSTEM_RULE_STAYS_FOREVER " + "policy ".repeat(700) };
  const history: ModelMessage[] = [
    system,
    { role: "user", content: "Original request " + "context ".repeat(2_000) },
    { role: "assistant", content: "Older work " + "result ".repeat(2_000) },
    { role: "user", content: "Continue with the current task." },
  ];
  const compacted = compactProviderMessages(history, 4_000);
  assert.deepEqual(compacted[0], system);
  assert.match(JSON.stringify(compacted.slice(1)), /\[metis-context-recap:v1\]/);
  assert.doesNotMatch(JSON.stringify(compacted.slice(1)), /SYSTEM_RULE_STAYS_FOREVER/);
});

test("external system instructions reserve context without entering the recap", () => {
  const history: ModelMessage[] = [
    { role: "user", content: "Old task " + "context ".repeat(1_700) },
    { role: "assistant", content: "Earlier result " + "result ".repeat(1_700) },
    { role: "user", content: "Continue." },
  ];
  const estimated = history.reduce((sum, message) => sum + estimateContextTokens(message), 0);
  const window = Math.ceil(estimated / CONTEXT_COMPACT_RATIO) + 100;
  const noReserve = compactProviderMessages(history, window);
  const withReserve = compactProviderMessages(history, window, "normal", undefined, undefined, 1_000);
  assert.deepEqual(noReserve, history);
  assert.match(JSON.stringify(withReserve), /\[metis-context-recap:v1\]/);
  const afterWithSystem = withReserve.reduce((sum, message) => sum + estimateContextTokens(message), 1_000);
  assert.ok(afterWithSystem <= effectiveContextBudget(window), `system and history use ${afterWithSystem} tokens`);
});
