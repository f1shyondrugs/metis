import { parseInternalLink } from "@/lib/internal-link";
import { canvasFromToolPayload, planFromToolPayload } from "@/lib/tool-call-display";

export type SharedWorkspace = { id: string; type: "canvas" | "plan"; name: string; content: string };

export function sharedChatWorkspaces(chat: { workspaces?: SharedWorkspace[]; canvas?: string } | null): SharedWorkspace[] {
  return chat?.workspaces?.length ? chat.workspaces : chat?.canvas
    ? [{ id: "canvas-default", type: "canvas", name: "Canvas", content: chat.canvas }] : [];
}

/** Resolve identity from the same parsed payload as the card, then enforce the share allowlist. */
export function sharedWorkspaceFromTool(tool: { kind?: string; path?: string; input?: string; result?: string; detail?: string }, workspaces: SharedWorkspace[]) {
  const kinds = tool.kind === "canvas" || tool.kind === "plan" ? [tool.kind] as const : ["canvas", "plan"] as const;
  for (const kind of kinds) {
    const preview = kind === "canvas" ? canvasFromToolPayload(tool.input, tool.result, tool.detail)
      : planFromToolPayload(tool.input, tool.result, tool.detail);
    for (const link of [preview?.workspaceLink, tool.path]) {
      const target = parseInternalLink(link);
      if (target?.kind !== kind) continue;
      const workspace = workspaces.find(item => item.id === target.id && item.type === kind);
      if (workspace) return workspace;
    }
  }
  return null;
}
