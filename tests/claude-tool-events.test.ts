import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { claudeMessageContent, createClaudeToolEvents } from "../lib/providers/claude-tool-events";
import { upsertToolMessagePart } from "../lib/message-parts";
import type { ToolInputPart } from "../lib/tool-input-progress";
import type { MessagePart, ToolPart } from "../lib/store";

function fixture() {
  const events: ToolPart[] = [];
  const parts: MessagePart[] = [];
  const handle = createClaudeToolEvents(tool => {
    events.push(tool);
    upsertToolMessagePart(parts, tool);
  });
  return { handle, events, parts };
}
const use = (id: string, name = "mcp__gateway__read_file", input: unknown = { path: "/tmp/a" }) =>
  ({ type: "tool_use", id, name, input });
const message = (type: string, content: unknown[]) => ({ type, message: { content } });
const stream = (event: Record<string, unknown>, parent_tool_use_id: string | null = null) =>
  ({ type: "stream_event", event, parent_tool_use_id });

test("SDK envelopes expose nested content and legacy arrays without accepting malformed messages", () => {
  const content = [{ type: "text", text: "hello" }, use("one")];
  assert.deepEqual(claudeMessageContent(message("assistant", content)), content);
  assert.deepEqual(claudeMessageContent({ message: content }), content);
  assert.deepEqual(claudeMessageContent({ message: { content: "bad" } }), []);
  assert.deepEqual(claudeMessageContent({}), []);
});

test("all parallel assistant tool calls become visible and paired results update the same message parts", () => {
  const { handle, events, parts } = fixture();
  handle(message("assistant", [
    { type: "text", text: "Checking" }, use("one"), use("two", "mcp__gateway__execute_command", { command: "pwd" }),
  ]));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(t => [t.id, t.status, t.kind, t.source]), [
    ["one", "running", "read", "mcp"], ["two", "running", "shell", "mcp"],
  ]);
  const output = [{ type: "text", text: '{"stdout":"/tmp","exit_code":0}' }];
  handle(message("user", [
    { type: "tool_result", tool_use_id: "two", content: output },
    { type: "tool_result", tool_use_id: "one", content: "permission denied", is_error: true },
  ]));
  assert.equal(parts.length, 2);
  assert.deepEqual(events.slice(-2).map(t => [t.id, t.status]), [["two", "completed"], ["one", "error"]]);
  assert.equal(events.at(-2)?.result, JSON.stringify(output));
  assert.equal(events.at(-1)?.input, '{"path":"/tmp/a"}');
  assert.equal(events.at(-1)?.result, "permission denied");
});

test("partial tool starts appear before execution; fragmented arguments merge without a duplicate snapshot card", () => {
  const { handle, events, parts } = fixture();
  handle(stream({ type: "message_start" }));
  handle(stream({ type: "content_block_start", index: 1, content_block: use("one", "mcp__gateway__read_file", {}) }));
  assert.equal(events[0].status, "running");
  handle(stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } }));
  handle(stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"/tmp/a"}' } }));
  handle(stream({ type: "content_block_stop", index: 1 }));
  const count = events.length;
  handle(message("assistant", [use("one")]));
  assert.equal(events.length, count);
  assert.equal(events.at(-1)?.input, '{"path":"/tmp/a"}');
  assert.equal(parts.length, 1);
  handle(message("user", [{ type: "tool_result", tool_use_id: "one", content: "", is_error: false }]));
  assert.equal(events.at(-1)?.result, "");
  assert.equal(events.at(-1)?.status, "completed");
});

test("interleaved parent/subagent block indexes remain separate", () => {
  const { handle, events } = fixture();
  for (const scope of [null, "parent"]) {
    handle(stream({ type: "message_start" }, scope));
    handle(stream({ type: "content_block_start", index: 0, content_block: use(scope || "root", "mcp__gateway__read_file", {}) }, scope));
    handle(stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: scope || "root" }) } }, scope));
  }
  handle(stream({ type: "content_block_stop", index: 0 }, "parent"));
  handle(stream({ type: "content_block_stop", index: 0 }));
  assert.equal(events.findLast(t => t.id === "root")?.input, '{"path":"root"}');
  assert.equal(events.findLast(t => t.id === "parent")?.input, '{"path":"parent"}');
});

test("malformed partial JSON waits for the full authoritative tool arguments", () => {
  const { handle, events } = fixture();
  handle(stream({ type: "content_block_start", index: 0, content_block: use("one", undefined, {}) }));
  handle(stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } }));
  assert.doesNotThrow(() => handle(stream({ type: "content_block_stop", index: 0 })));
  handle(message("assistant", [use("one")]));
  assert.equal(events.at(-1)?.input, '{"path":"/tmp/a"}');
});

test("replayed starts and progress never erase completed results or add ghost tools", () => {
  const { handle, events, parts } = fixture();
  handle(message("assistant", [use("one")]));
  handle(message("user", [{ type: "tool_result", tool_use_id: "one", content: "ok" }]));
  const count = events.length;
  handle(message("assistant", [use("one")]));
  handle({ type: "tool_progress", tool_use_id: "one", tool_name: "mcp__gateway__read_file" });
  handle(message("user", [{ type: "tool_result", tool_use_id: "past-run", content: "old result" }]));
  assert.equal(events.length, count);
  assert.equal(parts.length, 1);
  assert.equal(events.at(-1)?.status, "completed");
});

test("write_todos arguments populate the existing Tasks surface", () => {
  const { handle, events } = fixture();
  handle(message("assistant", [use("todo", "mcp__gateway__write_todos", { todos: [
    { id: "inspect", content: "Inspect", status: "in_progress" },
  ] })]));
  assert.equal(events[0].kind, "todo");
  assert.deepEqual(events[0].todos, [{ id: "inspect", content: "Inspect", status: "in_progress" }]);
});

test("terminal turn outcomes close only outstanding calls without fabricating output", () => {
  for (const is_error of [false, true]) {
    const { handle, events } = fixture();
    handle(message("assistant", [use("one"), use("two")]));
    handle(message("user", [{ type: "tool_result", tool_use_id: "one", content: "ok" }]));
    handle({ type: "result", is_error });
    assert.equal(events.findLast(t => t.id === "one")?.status, "completed");
    assert.equal(events.findLast(t => t.id === "two")?.status, is_error ? "error" : "completed");
    assert.equal(events.findLast(t => t.id === "two")?.result, undefined);
  }
});

test("text, thinking and tools without stable SDK identities do not generate tool cards", () => {
  const { handle, events } = fixture();
  handle(message("assistant", [{ type: "text", text: "hello" }, { type: "thinking", thinking: "..." }, { type: "tool_use", name: "invalid" }]));
  handle(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }));
  handle({ type: "system", subtype: "init" });
  assert.equal(events.length, 0);
});


test("the actual Claude run loop forwards SDK tool lifecycle into UI parts without live credentials", async () => {
  const file = ts.createSourceFile("claude.ts", readFileSync(new URL("../lib/providers/adapters/claude.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const functions = file.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(file)).join("\n");
  const js = ts.transpileModule(functions.replace('await import("@anthropic-ai/claude-agent-sdk")', "__sdk") + "\nrunClaude(context);", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const f = fixture();
  const text: string[] = [];
  let closed = false;
  const conversation = {
    async *[Symbol.asyncIterator]() {
      yield stream({ type: "content_block_start", index: 0, content_block: use("sdk-call", "mcp__gateway__read_file", {}) });
      yield message("assistant", [{ type: "text", text: "Checking. " }, use("sdk-call")]);
      yield message("user", [{ type: "tool_result", tool_use_id: "sdk-call", content: "Read successfully" }]);
      yield stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Finished." } });
      yield message("assistant", [{ type: "text", text: "Finished." }]);
      yield { type: "result", is_error: false, result: "Finished.", usage: {} };
    },
    getContextUsage: async () => ({ totalTokens: 123, maxTokens: 1000, isAutoCompactEnabled: true }),
    close: () => { closed = true; },
  };
  const context = {
    chat: { id: "isolated-chat", approvedPatterns: [] }, job: { id: "isolated-job", userId: "isolated-owner" },
    connection: { id: "isolated-connection", secret: "" }, modelId: "fixture-model",
    signal: new AbortController().signal, onTool: (_tool: ToolPart) => {}, onText: (t: string) => text.push(t),
  };
  const tools: ToolPart[] = [];
  context.onTool = tool => { tools.push(tool); upsertToolMessagePart(f.parts, tool); };
  const result = await vm.runInNewContext(js, {
    __sdk: { query: () => conversation }, context, AbortController, setInterval, clearInterval,
    process: { geteuid: () => 1 },
    asRecord: (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v : {},
    asString: (v: unknown) => typeof v === "string" ? v : "",
    claudeMessageContent, createClaudeToolEvents,
    getProviderSessionBinding: () => undefined, updateProviderSessionBinding: () => {},
    getUserAgentCwd: () => "/isolated", runtimeModeForChat: () => "full-access",
    claudePermissionPolicy: () => ({ permissionMode: "bypassPermissions", canUseToolRequired: false }),
    effectiveModelParams: () => [], getMcpServers: () => ({}), providerMcpContext: () => ({}),
    assertNativeMcpServers: () => {},
    resolveClaudeAgentModelId: () => "fixture-model", inheritedEnv: () => ({}), providerPrompt: () => "fixture",
    nativeRecoveryPrompt: () => "fixture", USER_INPUT_TRANSPORT_TIMEOUT_MS: 1000,
  });
  assert.equal(closed, true);
  assert.equal(tools[0].status, "running");
  assert.equal(tools.at(-1)?.status, "completed");
  assert.equal(tools.at(-1)?.result, "Read successfully");
  assert.equal(f.parts.length, 1);
  assert.equal(text.join(""), "Checking. Finished.");
  assert.equal(result.usage.usedTokens, 123);
});


test("Claude genuine deltas publish throttled preparing counts and immediately transition with full input", () => {
  let time = 0;
  const events: ToolInputPart[] = [];
  const handle = createClaudeToolEvents(t => events.push(t), () => time);
  handle(stream({ type: "content_block_start", index: 0, content_block: use("one", undefined, {}) }));
  assert.equal(events[0].phase, "preparing");
  assert.equal(events[0].inputChars, 0);
  assert.equal(events[0].input, undefined);
  const delta = (fragment: string) => handle(stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: fragment } }));
  delta('{"path":');
  assert.equal(events.length, 1);
  time = 100;
  delta('"/tmp/a"');
  assert.equal(events.at(-1)?.inputChars, 16);
  assert.equal(events.at(-1)?.input, undefined);
  delta('}');
  handle(stream({ type: "content_block_stop", index: 0 }));
  assert.equal(events.at(-1)?.inputChars, 17);
  assert.equal(events.at(-1)?.phase, "executing");
  assert.equal(events.at(-1)?.status, "running");
  assert.equal(events.at(-1)?.input, '{"path":"/tmp/a"}');
  assert.deepEqual([...new Set(events.map(t => t.id))], ["one"]);
  handle(message("user", [{ type: "tool_result", tool_use_id: "one", content: "ok" }]));
  const count = events.length;
  handle(stream({ type: "content_block_start", index: 0, content_block: use("one", undefined, {}) }));
  time = 200;
  delta('{"wrong":true}');
  handle(stream({ type: "content_block_stop", index: 0 }));
  assert.equal(events.length, count);
  assert.equal(events.at(-1)?.result, "ok");
});

test("incomplete Claude input flushes its count without exposing input or executing; snapshot is authoritative", () => {
  const events: ToolInputPart[] = [];
  const handle = createClaudeToolEvents(t => events.push(t), () => 0);
  handle(stream({ type: "content_block_start", index: 0, content_block: use("todo", "mcp__gateway__write_todos", {}) }));
  handle(stream({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"todos":' } }));
  handle(stream({ type: "content_block_stop", index: 0 }));
  assert.equal(events.at(-1)?.inputChars, 9);
  assert.equal(events.at(-1)?.phase, "preparing");
  assert.ok(events.every(t => t.input === undefined && t.todos === undefined));
  handle(message("assistant", [use("todo", "mcp__gateway__write_todos", { todos: [{ id: "one", content: "Inspect", status: "pending" }] })]));
  assert.equal(events.at(-1)?.phase, "executing");
  assert.equal(events.at(-1)?.todos?.[0].content, "Inspect");
});
