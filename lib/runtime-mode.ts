import { RUNTIME_MODES } from "./mcp-core/runtime-permissions.mjs";
export { RUNTIME_MODES } from "./mcp-core/runtime-permissions.mjs";
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return typeof value === "string" && (RUNTIME_MODES as readonly string[]).includes(value)
    ? (value as RuntimeMode)
    : DEFAULT_RUNTIME_MODE;
}

export function runtimeModeForChat(chat: { runtimeMode?: unknown }): RuntimeMode {
  return normalizeRuntimeMode(chat.runtimeMode);
}

/** Codex SDK ThreadOptions mapping. */
export const RUNTIME_MODE_TO_CODEX: Record<RuntimeMode, {
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted";
}> = {
  // Metis MCP is the sole tool surface. The gateway owns interactive approvals;
  // native Codex prompts would otherwise block or duplicate the Metis panel.
  "approval-required": { sandboxMode: "workspace-write", approvalPolicy: "never" },
  "auto-accept-edits": { sandboxMode: "workspace-write", approvalPolicy: "never" },
  "auto": { sandboxMode: "workspace-write", approvalPolicy: "never" },
  "full-access": { sandboxMode: "danger-full-access", approvalPolicy: "never" },
};

/** Claude Agent SDK permission mapping. */
export const RUNTIME_MODE_TO_CLAUDE_PERMISSION: Record<RuntimeMode, {
  permissionMode: "default" | "acceptEdits" | "auto" | "bypassPermissions";
  canUseToolRequired: boolean;
}> = {
  "approval-required": { permissionMode: "default", canUseToolRequired: true },
  "auto-accept-edits": { permissionMode: "acceptEdits", canUseToolRequired: true },
  "auto": { permissionMode: "auto", canUseToolRequired: true },
  "full-access": { permissionMode: "bypassPermissions", canUseToolRequired: false },
};

/** Resolve against the provider process UID, independently of the Metis account role. */
export function claudePermissionPolicy(runtimeMode: RuntimeMode, executionUid: number | undefined) {
  // Claude Code rejects bypassPermissions under root. Native tools stay disabled;
  // the SDK callback permits Metis MCP calls, whose permissions the gateway owns.
  if (runtimeMode === "full-access" && executionUid === 0) {
    return RUNTIME_MODE_TO_CLAUDE_PERMISSION["approval-required"];
  }
  return RUNTIME_MODE_TO_CLAUDE_PERMISSION[runtimeMode];
}

export type ApprovalDecision = "allow" | "allow-session" | "deny";

/** Canonical prefix key shared by Claude approvals and MCP gateway approvals. */
export function approvalPatternFor(toolName: string, input: unknown): string {
  const name = String(toolName || "").trim();
  const rawInput = String(
    typeof input === "string"
      ? input
      : JSON.stringify(input ?? {}),
  ).trim();
  return `${name}:${rawInput}`.slice(0, 2_000);
}

export function shouldAutoApprove(patterns: readonly string[] | undefined, toolName: string, input: unknown): boolean {
  if (!patterns?.length) return false;
  const target = approvalPatternFor(toolName, input);
  return patterns.some((pattern) => target.startsWith(String(pattern || "").trim().slice(0, 2_000)));
}

/** Pure gate shared by gateway execution and focused tests. */
export function runtimeModeRequiresApproval(
  runtimeMode: unknown,
  toolCategory: "read" | "write" | "terminal" | "browser" | "memory" | "remote" | "plan" | "subagent" | "unknown",
): boolean {
  const mode = normalizeRuntimeMode(runtimeMode);
  return mode === "approval-required"
    ? toolCategory === "terminal" || toolCategory === "write"
    : mode === "auto-accept-edits" && toolCategory === "terminal";
}
