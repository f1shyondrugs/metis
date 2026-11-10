import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractEmbeddedToolCalls, sanitizeJsonSchema, stripRawToolMarkup } from "../lib/providers/tool-schema";
import {
  executeEmbeddedToolFallbacks,
  toEmbeddedToolResultPayloads,
} from "../lib/providers/embedded-tool-fallback";
import { CORE_MCP_TOOL_ALLOWLIST, selectBridgeTools, bridgeToolTimeoutMs } from "../lib/mcp-bridge";
import {
  antigravityCliSettings,
  antigravityMcpConfig,
  antigravitySdkMcpServers,
  parseAntigravityCliChunk,
  writeAntigravitySessionFiles,
} from "../lib/providers/official-antigravity";
import { listProviderDefinitions } from "../lib/providers/registry";
import { AGENT_RUNTIME_SCHEMA } from "../lib/agent-runtime-policy.mjs";

test("sanitizeJsonSchema forces object + additionalProperties false", () => {
  const schema = sanitizeJsonSchema({
    properties: {
      path: { type: "string" },
      extra: { type: "number" },
    },
    required: ["path", "missing"],
  });
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["path"]);
});

test("stripRawToolMarkup removes GLM XML dumps", () => {
  const text = stripRawToolMarkup("Hi\n<tool_call>read_file<arg_key>path</arg_key><arg_value>/tmp/a</arg_value></tool_call>\nDone");
  assert.match(text, /Hi/);
  assert.match(text, /Done/);
  assert.doesNotMatch(text, /tool_call/);
});

test("extractEmbeddedToolCalls parses XML and JSON fences", () => {
  const xml = extractEmbeddedToolCalls("<tool_call>read_file<arg_key>path</arg_key><arg_value>/tmp/a</arg_value></tool_call>");
  assert.equal(xml[0].name, "read_file");
  assert.equal(xml[0].args.path, "/tmp/a");
  const json = extractEmbeddedToolCalls('```json\n{"name":"execute_command","arguments":{"command":"ls"}}\n```');
  assert.equal(json[0].name, "execute_command");
  assert.equal(json[0].args.command, "ls");
});

test("extractEmbeddedToolCalls parses <|tool_call_begin|> markup", () => {
  const fromArgs = extractEmbeddedToolCalls(
    '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"path":"/tmp/a"}<|tool_call_end|>',
  );
  assert.equal(fromArgs.length, 1);
  assert.equal(fromArgs[0].name, "read_file");
  assert.equal(fromArgs[0].args.path, "/tmp/a");

  const fromSep = extractEmbeddedToolCalls(
    '<|tool_call_begin|>functions.execute_command:0<|tool_sep|>{"command":"ls"}<|tool_call_end|>',
  );
  assert.equal(fromSep[0].name, "execute_command");
  assert.equal(fromSep[0].args.command, "ls");
});

test("extractEmbeddedToolCalls dedups matching XML and JSON fences", () => {
  const mixed = [
    "<tool_call>read_file<arg_key>path</arg_key><arg_value>/tmp/a</arg_value></tool_call>",
    '```json\n{"name":"read_file","arguments":{"path":"/tmp/a"}}\n```',
    '```json\n{"name":"execute_command","arguments":{"command":"ls"}}\n```',
  ].join("\n");
  const calls = extractEmbeddedToolCalls(mixed);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "read_file");
  assert.equal(calls[0].args.path, "/tmp/a");
  assert.equal(calls[1].name, "execute_command");
  assert.equal(calls[1].args.command, "ls");
});

test("toEmbeddedToolResultPayloads maps ok results and errors", () => {
  const payloads = toEmbeddedToolResultPayloads([
    { name: "read_file", args: { path: "/tmp/a" }, ok: true, result: "ok" },
    { name: "execute_command", args: { command: "ls" }, ok: false, error: "denied" },
  ]);
  assert.deepEqual(payloads, [
    { name: "read_file", args: { path: "/tmp/a" }, result: "ok", ok: true },
    { name: "execute_command", args: { command: "ls" }, result: "denied", ok: false },
  ]);
});

test("embedded textual tool fallbacks execute sequentially instead of being stripped only", async () => {
  const seen: string[] = [];
  const executions = await executeEmbeddedToolFallbacks(
    "<tool_call>read_file<arg_key>path</arg_key><arg_value>/tmp/a</arg_value></tool_call>",
    async (call) => {
      seen.push(`${call.name}:${String(call.args.path)}`);
      return "ok";
    },
  );
  assert.deepEqual(seen, ["read_file:/tmp/a"]);
  assert.equal(executions[0]?.ok, true);
  assert.equal(executions[0]?.result, "ok");
});

test("provider bridge exposes delegation and self-diagnostics as core tools", () => {
  const selected = selectBridgeTools([
    "delegate_subagent",
    "subagent_status",
    "list_recent_errors",
    "read_error_log_detail",
    "wait",
  ]);
  assert.deepEqual(selected, [
    "delegate_subagent",
    "subagent_status",
    "list_recent_errors",
    "read_error_log_detail",
  ]);
});

test("selectBridgeTools keeps a core Cursor-like set and drops the rest", () => {
  for (const name of [
    "search_tools", "call_mcp_tool", "write_todos", "read_file", "execute_command",
    "browser_navigate", "browser_snapshot", "browser_click", "browser_type",
    "browser_wait_for", "browser_fill_form", "browser_form_state", "browser_tabs", "credential_vault_list",
  ]) {
    assert.ok(
      CORE_MCP_TOOL_ALLOWLIST.includes(name as typeof CORE_MCP_TOOL_ALLOWLIST[number]) || name === "search_tools",
      `${name} must be on the shared core surface`,
    );
  }
  const selected = selectBridgeTools([
    "read_file",
    "execute_command",
    "docker_ps",
    "provide_file",
    "search_tools",
    "ask_user",
    "browser_form_state",
    "browser_press",
  ]);
  assert.deepEqual(
    selected.sort(),
    ["ask_user", "browser_form_state", "browser_press", "execute_command", "read_file", "search_tools"].sort(),
  );
});

test("CORE allowlist keeps search_tools/call_mcp_tool and excludes provide_file/wait", () => {
  const allow = CORE_MCP_TOOL_ALLOWLIST as readonly string[];
  assert.ok(allow.includes("search_tools"));
  assert.ok(allow.includes("call_mcp_tool"));
  assert.ok(allow.includes("update_chat_title"));
  assert.ok(allow.includes("update_chat_keywords"));
  assert.equal(allow.includes("provide_file"), false);
  assert.equal(allow.includes("wait"), false);
  assert.deepEqual(
    selectBridgeTools(["search_tools", "call_mcp_tool", "provide_file", "wait", "read_file"]).sort(),
    ["call_mcp_tool", "read_file", "search_tools"].sort(),
  );
});

test("every selectable provider advertises tool support", () => {
  for (const provider of listProviderDefinitions()) {
    assert.equal(provider.capabilities.tools, true, `${provider.key} should advertise tools`);
    assert.equal(provider.capabilities.mcp, true, `${provider.key} should advertise mcp`);
  }
});

test("antigravity MCP config maps stdio servers", () => {
  const config = antigravityMcpConfig({
    gateway: {
      type: "stdio",
      command: "/usr/bin/node",
      args: ["internal-mcp-server.mjs"],
      cwd: "/tmp",
      env: { MCP_CHAT_ID: "chat-1" },
    },
  });
  assert.equal(config.mcpServers.gateway.command, "/usr/bin/node");
  assert.equal(config.mcpServers.gateway.env.MCP_CHAT_ID, "chat-1");
  assert.deepEqual(antigravityCliSettings(), {
    enableTelemetry: false,
    toolPermission: "request-review",
    permissions: {
      allow: ["mcp(*)"],
      deny: [
        "command(*)",
        "read_file(*)",
        "write_file(*)",
        "read_url(*)",
        "execute_url(*)",
      ],
    },
  });
});

test("antigravity SDK disables native tools and subagents", async () => {
  const bridge = await readFile(new URL("../scripts/antigravity_bridge.py", import.meta.url), "utf8");
  assert.match(bridge, /enabled_tools=\[\]/);
  assert.match(bridge, /enable_subagents=False/);
  assert.doesNotMatch(bridge, /enable_subagents=True/);
});

test("antigravity SDK MCP mapping keeps stdio and HTTP servers", () => {
  const servers = antigravitySdkMcpServers({
    gateway: {
      type: "stdio",
      command: "/usr/bin/node",
      args: ["internal-mcp-server.mjs"],
      cwd: "/tmp",
      env: { MCP_CHAT_ID: "chat-1" },
    },
    remote: {
      type: "http",
      url: "http://127.0.0.1:8787/mcp",
      headers: { Authorization: "Bearer test" },
    },
  });
  assert.deepEqual(servers, [
    {
      name: "gateway",
      type: "stdio",
      command: "/usr/bin/node",
      args: ["internal-mcp-server.mjs"],
      env: { MCP_CHAT_ID: "chat-1" },
    },
    {
      name: "remote",
      type: "http",
      url: "http://127.0.0.1:8787/mcp",
      headers: { Authorization: "Bearer test" },
    },
  ]);
});

test("writeAntigravitySessionFiles writes mcp_config.json under temp HOME", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "agy-session-"));
  try {
    await writeAntigravitySessionFiles(tempHome, {
      gateway: {
        type: "stdio",
        command: "node",
        args: ["server.mjs"],
        cwd: "/tmp",
        env: { MCP_JOB_ID: "job-1" },
      },
    });
    const raw = await readFile(path.join(tempHome, ".gemini", "config", "mcp_config.json"), "utf8");
    const parsed = JSON.parse(raw) as { mcpServers: { gateway: { env: { MCP_JOB_ID: string } } } };
    assert.equal(parsed.mcpServers.gateway.env.MCP_JOB_ID, "job-1");
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("parseAntigravityCliChunk extracts tool lines and JSON events", () => {
  const parsed = parseAntigravityCliChunk([
    "Calling tool read_file",
    '{"type":"tool","name":"execute_command","id":"t1"}',
    '{"type":"tool","name":"write_todos","input":{"todos":[{"content":"Fix tools","status":"in_progress"}]}}',
    "Hello user",
    "ERROR: logging before google.Init: noise",
  ].join("\n"));
  assert.equal(parsed.tools.length, 3);
  assert.equal(parsed.tools[0].name, "read_file");
  assert.equal(parsed.tools[0].kind, "read");
  assert.equal(parsed.tools[1].name, "execute_command");
  assert.equal(parsed.tools[2].kind, "todo");
  assert.equal(parsed.tools[2].todos?.[0]?.content, "Fix tools");
  assert.match(parsed.text, /Hello user/);
  assert.doesNotMatch(parsed.text, /google\.Init/);
});


test("tool transports wait through the advertised delegation deadline with a response margin", () => {
 const schema = { properties: { timeoutMs: AGENT_RUNTIME_SCHEMA } };
 assert.equal(bridgeToolTimeoutMs({ timeoutMs: 21_600_000 }, schema), 21_660_000);
 assert.equal(bridgeToolTimeoutMs({ timeoutMs: 43_200_000 }, schema), 43_260_000);
 assert.equal(bridgeToolTimeoutMs({}, schema), 300_000);
 assert.equal(bridgeToolTimeoutMs({}, {properties:{timeoutMs:{default:1_800_000,maximum:21_600_000}}}),1_860_000);
 assert.equal(bridgeToolTimeoutMs({timeoutMs:43_200_000},{properties:{timeoutMs:{maximum:21_600_000}}}),21_660_000);
 assert.deepEqual(selectBridgeTools(["notify", "customnotify"]),["notify"]);
 assert.equal(bridgeToolTimeoutMs({ timeoutMs: 3_600_000, wait: false }, schema), 300_000);
 assert.equal(bridgeToolTimeoutMs({}, {}), 300_000);
 assert.equal(bridgeToolTimeoutMs({ timeoutMs: NaN }, schema), 300_000);
 // The timeout follows discovery metadata rather than a provider-specific guess.
 assert.equal(bridgeToolTimeoutMs({ timeoutMs: 90_000 }, { properties: { timeoutMs: { maximum: 90_000 } } }), 300_000);
});
