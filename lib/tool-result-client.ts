import type { ToolPart } from "@/lib/store";
import { canvasFromToolPayload, planFromToolPayload, unwrapToolRecord, workspaceIdFromLink } from "@/lib/tool-call-display";
export type FullToolPayload = Pick<ToolPart,"input"|"result"|"subagent"|"diff">;

/** Fetch only after the user opens a tool. The server enforces chat ownership. */
export async function loadToolPayload(url: string, signal?: AbortSignal): Promise<FullToolPayload> {
  if (!/^\/api\/chats\/[^/]+\/tool-result\?/.test(url)) throw new Error("Invalid tool output URL");
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load full tool details");
  const payload = await response.json() as FullToolPayload;
  if (typeof payload.result !== "string" && typeof payload.input !== "string" && !payload.subagent && !payload.diff) throw new Error("Tool details are unavailable");
  return {
    ...(typeof payload.input === "string" ? { input: payload.input } : {}),
    ...(typeof payload.result === "string" ? { result: payload.result } : {}),
    ...(payload.subagent ? { subagent: payload.subagent } : {}),
    ...(payload.diff ? { diff: payload.diff } : {}),
  };
}

/** Opening a saved artifact only needs its identity, not a second copy of its transcript. */
export async function resolveWorkspaceToolOpen<T extends Pick<ToolPart, "kind" | "input" | "result" | "status" | "inputUrl" | "resultUrl">>(
  tool: T,
  load: typeof loadToolPayload = loadToolPayload,
): Promise<{ tool: T; workspaceId?: string }> {
  if ((tool.kind === "plan" || tool.kind === "canvas") && /^(completed|success|succeeded|done)$/i.test(tool.status)) {
    const result = unwrapToolRecord(tool.result);
    if (result && !result.isError && !result.error && result.ok !== false && result.success !== false
        && !/^(error|failed|declined|canceled|cancelled)$/i.test(String(result.status || ""))
        && (!result.type || result.type === tool.kind)) {
      const preview = tool.kind === "plan"
        ? planFromToolPayload(undefined, tool.result)
        : canvasFromToolPayload(undefined, tool.result);
      const workspaceId = workspaceIdFromLink(preview?.workspaceLink, tool.kind);
      if (workspaceId) return { tool, workspaceId };
    }
  }
  const url = tool.inputUrl || tool.resultUrl;
  return { tool: url ? { ...tool, ...await load(url) } : tool };
}

export async function loadToolResult(url: string, signal?: AbortSignal): Promise<string> {
  const payload = await loadToolPayload(url, signal);
  if (typeof payload.result !== "string") throw new Error("Tool output is unavailable");
  return payload.result;
}
