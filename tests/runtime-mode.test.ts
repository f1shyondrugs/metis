import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import vm from "node:vm";
import ts from "typescript";

import type { ToolPermissionCategory } from "@/lib/store";

import {
  approvalPatternFor,
  claudePermissionPolicy,
  DEFAULT_RUNTIME_MODE,
  normalizeRuntimeMode,
  RUNTIME_MODES,
  RUNTIME_MODE_TO_CLAUDE_PERMISSION,
  RUNTIME_MODE_TO_CODEX,
  runtimeModeForChat,
  runtimeModeRequiresApproval,
  shouldAutoApprove,
} from "../lib/runtime-mode";

const dataDir = path.join(os.tmpdir(), `metis-runtime-mode-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.AI_CHAT_INTERNAL_ORIGIN ||= "http://127.0.0.1:1";

const modulesPromise = Promise.all([
  import("../lib/db-approvals"),
  import("../lib/db-store"),
]);

let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("normalizeRuntimeMode accepts only the complete runtime mode set", () => {
  for (const mode of RUNTIME_MODES)
    assert.equal(normalizeRuntimeMode(mode), mode);
  assert.equal(normalizeRuntimeMode("unknown"), DEFAULT_RUNTIME_MODE);
  assert.equal(normalizeRuntimeMode(undefined), DEFAULT_RUNTIME_MODE);
  assert.equal(normalizeRuntimeMode(42), DEFAULT_RUNTIME_MODE);
  assert.equal(runtimeModeForChat({ runtimeMode: "auto" }), "auto");
  assert.equal(runtimeModeForChat({ runtimeMode: null }), DEFAULT_RUNTIME_MODE);
});

test("every runtime mode has complete provider mappings", () => {
  assert.deepEqual(
    RUNTIME_MODES.map((mode) => RUNTIME_MODE_TO_CODEX[mode]?.sandboxMode),
    ["workspace-write", "workspace-write", "workspace-write", "danger-full-access"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map((mode) => RUNTIME_MODE_TO_CODEX[mode]?.approvalPolicy),
    ["never", "never", "never", "never"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map(
      (mode) => RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]?.permissionMode,
    ),
    ["default", "acceptEdits", "auto", "bypassPermissions"],
  );
  assert.deepEqual(
    RUNTIME_MODES.map(
      (mode) => RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]?.canUseToolRequired,
    ),
    [true, true, true, false],
  );
  for (const mode of RUNTIME_MODES) {
    assert.ok(RUNTIME_MODE_TO_CODEX[mode]);
    assert.ok(RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]);
  }
});

test("approvals round-trip and cannot be resolved twice", async () => {
  const {
    consumeApprovalGrant,
    createApproval,
    expireApproval,
    getApproval,
    heartbeatApproval,
    resolveApproval,
  } = modules[0];
  const { createChat } = modules[1];
  const chat = createChat("Runtime approval");
  const scope = approvalPatternFor("execute_command", { command: "pnpm test" });
  const { approvalId } = createApproval({
    jobId: "job-1",
    chatId: chat.id,
    title: "Command approval required",
    command: "pnpm test",
    sessionScope: scope,
  });
  assert.ok(heartbeatApproval(approvalId));
  const pending = getApproval(approvalId);
  assert.equal(pending?.status, "waiting_for_user");
  const resolved = resolveApproval(approvalId, "allow");
  assert.equal(resolved?.chatId, chat.id);
  assert.equal(getApproval(approvalId)?.status, "resolved");
  assert.equal(getApproval(approvalId)?.decision, "allow");
  assert.equal(resolved?.sessionScope, scope);
  assert.equal(consumeApprovalGrant({
    jobId: "job-1",
    chatId: chat.id,
    sessionScope: scope,
  }), true);
  assert.equal(consumeApprovalGrant({
    jobId: "job-1",
    chatId: chat.id,
    sessionScope: scope,
  }), false);
  assert.equal(resolveApproval(approvalId, "deny"), null);
  const expired = createApproval({
    jobId: "job-2",
    chatId: chat.id,
    title: "Expiring approval",
  });
  assert.equal(expireApproval(expired.approvalId)?.decision, "deny");
  assert.equal(getApproval(expired.approvalId)?.decision, "deny");
  assert.equal(resolveApproval(expired.approvalId, "allow"), null);
});

test("chat persistence normalizes runtime mode and session approvals keep their canonical scope", async () => {
  const { createApproval, getApproval, resolveApproval } = modules[0];
  const { createChat, getChat, updateChat } = modules[1];
  const chat = createChat("Runtime persistence");
  updateChat(chat.id, { runtimeMode: "not-a-mode" });
  assert.equal(getChat(chat.id)?.runtimeMode, undefined);
  updateChat(chat.id, { runtimeMode: "approval-required" });
  assert.equal(getChat(chat.id)?.runtimeMode, "approval-required");
  updateChat(chat.id, { sessionState: { goal: "  Ship the feature  " } });
  assert.equal(getChat(chat.id)?.sessionState?.goal, "Ship the feature");
  updateChat(chat.id, { sessionState: { goal: null } });
  assert.equal(getChat(chat.id)?.sessionState?.goal, undefined);

  const scope = approvalPatternFor("write_file", { path: "/tmp/a/b" });
  const { approvalId } = createApproval({
    chatId: chat.id,
    title: "Write approval",
    sessionScope: scope,
  });
  const resolved = resolveApproval(approvalId, "allow-session");
  assert.equal(resolved?.sessionScope, scope);
  assert.equal(getApproval(approvalId)?.sessionScope, scope);
});

test("session prefix decisions auto-approve only matching tool input prefixes", () => {
  const pattern = approvalPatternFor("execute_command", {
    command: "pnpm test",
  });
  assert.equal(
    shouldAutoApprove([pattern], "execute_command", { command: "pnpm test" }),
    true,
  );
  assert.equal(
    shouldAutoApprove([pattern.slice(0, -1)], "execute_command", {
      command: "pnpm test",
    }),
    true,
  );
  assert.equal(
    shouldAutoApprove([pattern], "execute_command", { command: "npm test" }),
    false,
  );
  assert.equal(
    shouldAutoApprove([pattern], "write_file", { command: "pnpm test" }),
    false,
  );
  assert.equal(
    shouldAutoApprove([], "execute_command", { command: "pnpm test" }),
    false,
  );
});

test("runtime approval gate covers terminal and write tools only in approval mode", async () => {
  assert.equal(
    runtimeModeRequiresApproval("approval-required", "terminal"),
    true,
  );
  assert.equal(runtimeModeRequiresApproval("approval-required", "write"), true);
  assert.equal(runtimeModeRequiresApproval("approval-required", "read"), false);
  assert.equal(runtimeModeRequiresApproval("auto-accept-edits", "terminal"), true);
  assert.equal(runtimeModeRequiresApproval("auto-accept-edits", "write"), false);
  assert.equal(runtimeModeRequiresApproval("auto", "terminal"), false);
  assert.equal(runtimeModeRequiresApproval("full-access", "terminal"), false);
  // The package re-exports the same pure gate used by gateway dispatch.
  // @ts-expect-error — untyped .mjs re-export; shapes verified by assertions below.
  const gateway = (await import("../packages/mcp-gateway/index.mjs")) as {
    modeToolCategory: (name: string) => string;
    runtimeModeRequiresApproval: typeof runtimeModeRequiresApproval;
    shouldAutoApprove: typeof shouldAutoApprove;
  };
  assert.equal(gateway.modeToolCategory("execute_command"), "terminal");
  assert.equal(gateway.modeToolCategory("write_file"), "write");
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "approval-required",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    true,
  );
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "auto-accept-edits",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    true,
  );
  assert.equal(gateway.runtimeModeRequiresApproval("auto-accept-edits", "write"), false);
  assert.equal(gateway.runtimeModeRequiresApproval("auto", "terminal"), false);
  assert.equal(
    gateway.runtimeModeRequiresApproval(
      "full-access",
      gateway.modeToolCategory("execute_command") as ToolPermissionCategory,
    ),
    false,
  );
  assert.equal(
    gateway.shouldAutoApprove(
      [approvalPatternFor("write_file", { path: "/tmp/a/b" })],
      "execute_command",
      { command: "pnpm test" },
    ),
    false,
  );
  // The gateway's local prefix format is identical to lib/runtime-mode.ts.
  assert.equal(
    gateway.shouldAutoApprove(
      ['write_file:{"path":"/tmp/a/b"}'],
      "write_file",
      { path: "/tmp/a/b" },
    ),
    true,
  );
});

test("gateway deny prevents a file edit before execution", async () => {
  // @ts-expect-error — the gateway's JavaScript module has no declaration file.
  const gateway = (await import("../packages/mcp-gateway/index.mjs")) as {
    dispatchGatewayTool: (name: string, args: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
  };
  const target = path.join(dataDir, "denied-edit.txt");
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests += 1;
    const url = String(input);
    const body = init?.method === "POST"
      ? { approvalId: "test-approval" }
      : url.includes("?id=")
        ? { status: "resolved", decision: "deny" }
        : { approvedPatterns: [], approvedOnce: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await gateway.dispatchGatewayTool("write_file", { path: target, content: "must not be written" }, {
      auditCall: false,
      context: { runtimeMode: "approval-required", chatId: "chat-test", jobId: "job-test" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text || "", /denied/i);
    assert.equal(existsSync(target), false);
    assert.equal(requests, 3);
    const terminalTarget = path.join(dataDir, "denied-command.txt");
    const terminal = await gateway.dispatchGatewayTool("execute_command", {
      command: `printf denied > ${terminalTarget}`,
      cwd: dataDir,
    }, {
      auditCall: false,
      context: { runtimeMode: "auto-accept-edits", chatId: "chat-test", jobId: "job-test" },
    });
    assert.equal(terminal.isError, true);
    assert.equal(existsSync(terminalTarget), false);
    assert.equal(requests, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Claude root compatibility changes only Full access, without changing the chat gateway policy", () => {
  for (const mode of RUNTIME_MODES) {
    for (const uid of [1000, 501, undefined]) {
      assert.deepEqual(claudePermissionPolicy(mode, uid), RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]);
    }
    if (mode !== "full-access") {
      assert.deepEqual(claudePermissionPolicy(mode, 0), RUNTIME_MODE_TO_CLAUDE_PERMISSION[mode]);
    }
  }
  assert.deepEqual(claudePermissionPolicy("full-access", 0), {
    permissionMode: "default", canUseToolRequired: true,
  });
  assert.equal(runtimeModeForChat({ runtimeMode: "full-access" }), "full-access");
  assert.equal(runtimeModeRequiresApproval("full-access", "terminal"), false);
  assert.equal(runtimeModeRequiresApproval("approval-required", "terminal"), true);
});

// Execute the adapter's actual options expression so this checks the SDK boundary,
// including flag omission and callback behavior, without launching a paid model turn.
function claudeAdapterOptions(mode: (typeof RUNTIME_MODES)[number], uid: number | undefined, gatewayName = "gateway") {
  const file = ts.createSourceFile("claude.ts", readFileSync(new URL("../lib/providers/adapters/claude.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  let policy: ts.VariableDeclaration | undefined;
  let servers: ts.VariableDeclaration | undefined;
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node)) {
      if (node.name.getText(file) === "options") expression = node.initializer;
      if (node.name.getText(file) === "claudePermissions") policy = node;
      if (node.name.getText(file) === "mcpServers") servers = node;
    }
    ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(expression);
  assert.ok(policy);
  assert.ok(servers);
  const js = ts.transpileModule(`const ${policy.getText(file)}; const ${servers.getText(file)}; const options = ${expression.getText(file)}; options;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let approvals = 0;
  const options = vm.runInNewContext(js, {
    agentCwd: "/isolated-workspace", modelParams: [], previousId: undefined,
    nativeMcp:{[gatewayName]:{}},nativeEnv:{},
    claudePermissionPolicy, runtimeMode: mode, process: { geteuid: () => uid, getuid: () => uid }, abortController: new AbortController(),
    context: { modelId: "test-model", job: { userId: "test-owner" }, chat: { approvedPatterns: [] }, connection: { secret: "" } },
    resolveClaudeAgentModelId: () => "test-model", inheritedEnv: () => ({}), claudeOAuthEnv: () => ({}),
    claudeMcpServers: (servers: unknown) => servers, getMcpServers: () => ({ [gatewayName]: {} }),
    providerMcpContext: () => ({}), providerPrompt: () => "test-system-prompt",
    shouldAutoApprove, claudePermissionResult: (behavior: string) => ({ behavior }),
    waitForClaudeApproval: async () => { approvals++; return "deny"; },
  }) as {
    permissionMode: string; allowDangerouslySkipPermissions?: boolean; tools: string[]; strictMcpConfig: boolean;
    canUseTool?: (name: string, input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<{ behavior: string }>;
  };
  return { options, approvals: () => approvals };
}

test("the root Claude adapter omits bypass flags and preserves Full access without SDK approvals", async () => {
  const f = claudeAdapterOptions("full-access", 0);
  assert.equal(f.options.permissionMode, "default");
  assert.equal(Object.hasOwn(f.options, "allowDangerouslySkipPermissions"), false);
  assert.equal(f.options.tools.length, 0, "Native Claude tools remain disabled");
  assert.equal(f.options.strictMcpConfig, true);
  assert.ok(f.options.canUseTool);
  const permissionOptions = { signal: new AbortController().signal };
  assert.equal((await f.options.canUseTool("mcp__gateway__list_mcp_servers", { include_disabled: true }, permissionOptions)).behavior, "allow");
  assert.equal((await f.options.canUseTool("mcp__gateway__execute_command", {}, permissionOptions)).behavior, "allow");
  assert.equal(f.approvals(), 0, "The Metis gateway owns its own tool approvals");
  assert.equal((await f.options.canUseTool("mcp__third_party__execute_command", {}, permissionOptions)).behavior, "allow");
  assert.equal(f.approvals(), 0, "Full access matches the existing SDK bypass behavior");
});

test("non-root and Windows Claude Full access keep the existing SDK bypass behavior", () => {
  for (const uid of [1000, undefined]) {
    const { options } = claudeAdapterOptions("full-access", uid);
    assert.equal(options.permissionMode, "bypassPermissions");
    assert.equal(options.allowDangerouslySkipPermissions, true);
    assert.equal(options.canUseTool, undefined);
    assert.equal(options.tools.length, 0);
  }
});


test("restricted Claude modes delegate configured Metis gateway names without approving unrelated MCPs", async () => {
  for (const mode of ["approval-required", "auto-accept-edits", "auto"] as const) {
    for (const uid of [0, 1000]) {
      for (const gatewayName of ["gateway", "renamed_gateway"]) {
        const f = claudeAdapterOptions(mode, uid, gatewayName);
        assert.ok(f.options.canUseTool);
        const permissionOptions = { signal: new AbortController().signal };
        for (const tool of ["list_mcp_servers", "execute_command"]) {
          assert.equal((await f.options.canUseTool(`mcp__${gatewayName}__${tool}`, {}, permissionOptions)).behavior, "allow");
        }
        assert.equal(f.approvals(), 0, "SDK approval must not duplicate the Metis gateway gate");
        for (const name of ["mcp__third_party__execute_command", `mcp__${gatewayName}_spoof__execute_command`]) {
          assert.equal((await f.options.canUseTool(name, {}, permissionOptions)).behavior, "deny");
        }
        assert.equal(f.approvals(), 2);
      }
    }
  }
});
