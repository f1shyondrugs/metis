export const RUNTIME_MODES: readonly ["approval-required", "auto-accept-edits", "auto", "full-access"];
export const RUNTIME_MODE_DETAILS: Record<(typeof RUNTIME_MODES)[number], { label: string; description: string }>;
export const RUNTIME_PERMISSION_PROMPT: string;
export const RUNTIME_PERMISSION_TOOL: {
  name: "request_runtime_mode_change";
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: false; destructiveHint: false };
};
