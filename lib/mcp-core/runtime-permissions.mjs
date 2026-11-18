// Shared by the gateway catalog, provider prompts and the server-owned confirmation.
export const RUNTIME_MODES = ["approval-required", "auto-accept-edits", "auto", "full-access"];
export const RUNTIME_MODE_DETAILS = {
  "approval-required": { label: "Approval required", description: "Ask before file writes and terminal commands." },
  "auto-accept-edits": { label: "Auto-accept edits", description: "Accept file writes automatically; ask before terminal commands." },
  "auto": { label: "Auto", description: "Run file writes and terminal commands automatically within the configured workspace." },
  "full-access": { label: "Full access", description: "Run file writes and commands without runtime approval prompts. Agent-mode, account, workspace and Remote Device restrictions still apply." },
};
export const RUNTIME_PERMISSION_PROMPT = [
  "Agent mode and runtime permissions are separate controls: request_mode_change({modeId, reason}) switches Agent/Plan/Ask; request_runtime_mode_change({runtimeMode, reason}) requests this chat's permission level.",
  "Runtime permission IDs: approval-required (confirm writes and commands), auto-accept-edits (accept writes; confirm commands), auto (automatic writes/commands within the workspace), full-access (no runtime approval prompts; other security boundaries still apply).",
  "When the user asks to change permissions, or a permission restriction blocks authorized work, call request_runtime_mode_change with the specific needed level and a short reason, if available. Prefer the narrowest sufficient level unless the user explicitly requests another. Do not tell the user to switch permissions or providers manually before trying the available confirmation tool.",
  "These tools open a real blocking confirmation: a request, default choice, timeout, disconnect or prose is not approval. Continue only after the tool reports switched:true; denial or cancellation means no change. Do not repeatedly ask after denial, silently escalate access, or use shell/config/database edits to bypass permission controls. Runtime changes do not grant tool categories forbidden by Agent/Plan/Ask or Remote Device policies.",
  "Unattended automation and delegated/background work must not request interactive permission changes. Report the permission limit instead.",
].join("\n");
export const RUNTIME_PERMISSION_TOOL = {
  name: "request_runtime_mode_change",
  description: "Request a confirmed change of this chat's runtime permissions, separately from Agent/Plan/Ask. Supports approval-required, auto-accept-edits, auto and full-access. Opens a blocking user confirmation showing the current and proposed level; never changes access without explicit acceptance. After switched:true, continue the original task. Does not override agent-mode, account, workspace or Remote Device policies.",
  inputSchema: {
    "x-metis-waits-for-user": true,
    type: "object",
    properties: {
      runtimeMode: { type: "string", enum: RUNTIME_MODES, description: "Exact target permission level." },
      reason: { type: "string", maxLength: 1000, description: "Why this change is needed for the user's task." },
    },
    required: ["runtimeMode"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};
