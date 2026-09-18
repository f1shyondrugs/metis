import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { opencodeMcpOnlyEnv } from "../lib/providers/adapters/acp-cli";
import { blockedCodexNativeToolType } from "../lib/providers/adapters/codex";
import { antigravityMetisAgentDefinition } from "../lib/providers/official-antigravity";

const source = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("AI SDK providers expose only Metis bridge tools", () => {
  const adapter = source("lib/providers/adapters/ai-sdk.ts");
  assert.doesNotMatch(adapter, /providerNativeSearchTools/);
  assert.match(adapter, /const tools = await agentToolsFor\(context\)/);
  assert.match(adapter, /const oauthTools = await agentToolsFor\(context\)/);
});

test("native SDK adapters disable provider subagents", () => {
  const claude = source("lib/providers/adapters/claude.ts");
  const codex = source("lib/providers/adapters/codex.ts");
  const antigravity = source("lib/providers/adapters/antigravity.ts");
  const bridge = source("scripts/antigravity_bridge.py");
  assert.match(claude, /tools: \[\] as string\[\]/);
  assert.match(claude, /nativeSubagents: false/);
  assert.match(codex, /multi_agent: false/);
  assert.match(codex, /multi_agent_v2: false/);
  assert.match(codex, /sandboxMode: "read-only"/);
  assert.match(codex, /nativeSubagents: false/);
  assert.match(antigravity, /nativeSubagents: false/);
  assert.match(bridge, /enabled_tools=\[\]/);
  assert.match(bridge, /enable_subagents=False/);
  assert.doesNotMatch(bridge, /max_subagent_depth/);
  assert.equal(blockedCodexNativeToolType({ type: "mcp_tool_call" }), null);
  assert.equal(blockedCodexNativeToolType({ type: "reasoning" }), null);
  assert.equal(blockedCodexNativeToolType({ type: "todo_list" }), null);
  assert.equal(blockedCodexNativeToolType({ type: "command_execution" }), "command_execution");
  assert.equal(blockedCodexNativeToolType({ type: "file_change" }), "file_change");
});

test("Codex keeps Metis MCP and routes file edits through it", () => {
  const codex = source("lib/providers/adapters/codex.ts");
  assert.match(codex, /mcp_servers: \{ metis_ai: codexMcp \}/);
  assert.match(codex, /enabled: true/);
  assert.match(codex, /default_tools_approval_mode: "auto"/);
  assert.match(codex, /startup_timeout_sec: 20/);
  assert.match(codex, /apply_patch_freeform: false/);
  assert.match(codex, /tool_search_always_defer_mcp_tools: false/);
  assert.match(codex, /\["mcp"\],\s*false,/);
  assert.match(codex, /approvalPolicy: "never"/);
  assert.match(codex, /networkAccessEnabled: true/);
  assert.match(codex, /sandboxMode: "read-only"/);
  assert.doesNotMatch(codex, /networkAccessEnabled: false/);
  assert.doesNotMatch(codex, /\["metis_ai"\]/);
});

test("Antigravity CLI custom agent removes defaults but keeps Metis MCP", () => {
  const definition = antigravityMetisAgentDefinition();
  assert.match(definition, /tools: \[\]/);
  assert.match(definition, /subagent: false/);
  assert.match(definition, /enable_mcp_tools: true/);
  assert.match(definition, /excludeDefaultComponents: true/);
  assert.match(source("lib/providers/official-antigravity.ts"), /"--agent"/);
});

test("ACP CLIs deny builtins while allowing the injected MCP gateway", () => {
  const adapter = source("lib/providers/adapters/acp-cli.ts");
  assert.match(adapter, /"--no-subagents"/);
  assert.match(adapter, /"--disable-web-search"/);
  assert.match(adapter, /"--tools", ""/);

  const env = opencodeMcpOnlyEnv({
    gateway: { type: "http", url: "http://127.0.0.1:8787/mcp" },
  });
  assert.equal(env.OPENCODE_PURE, "1");
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as {
    permission: Record<string, string>;
  };
  assert.equal(config.permission["*"], "deny");
  assert.equal(config.permission["gateway_*"], "allow");
  assert.equal(config.permission["mcp__gateway__*"], "allow");
  assert.equal(config.permission.task, undefined);
});
