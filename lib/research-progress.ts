import { innerToolName, unwrapToolRecord } from "@/lib/tool-call-display";
import { internalLinkNavigation, parseInternalLink } from "@/lib/internal-link";

export type ResearchProgress = {
  kind: "research-progress"; runId: string; questionId?: string; title: string; language: string;
  status: string; plan: string[];
  steps: Array<{ id: number; content: string; status: string }>;
  sourceTarget: number; minimumWords: number; discoveredCount: number; openedCount: number;
  readCount: number; blockedCount: number; failedCount: number; note?: string; downloadUrl?: string;
  canvasId?: string; workspaceLink?: string;
};

/** Reports open through the same authenticated Canvas navigation as other workspace links. */
export function researchReportNavigation(progress: Pick<ResearchProgress, "workspaceLink" | "canvasId">) {
  if (typeof progress.workspaceLink !== "string" || !/^workspace:\/\/canvas\/[^/?#\s]+$/.test(progress.workspaceLink)) return;
  const target = parseInternalLink(progress.workspaceLink);
  if (target?.kind !== "canvas" || (progress.canvasId !== undefined && progress.canvasId !== target.id)) return;
  return internalLinkNavigation(target);
}

function safeReportProgress(progress: ResearchProgress): ResearchProgress {
  let safe = progress;
  if (!researchReportNavigation(safe) && (safe.workspaceLink !== undefined || safe.canvasId !== undefined)) {
    const { workspaceLink: _workspaceLink, canvasId: _canvasId, ...rest } = safe;
    safe = rest;
  }
  // Older workflows carry the confirmed destination in downloadUrl. Their
  // persisted tracker remains usable even if the raw tool result was truncated.
  if (safe.status === "report_attached" && !researchReportNavigation(safe) && typeof safe.downloadUrl === "string") {
    const target = parseInternalLink(safe.downloadUrl);
    const canvas = target?.kind === "canvas" ? { canvasId: target.id, workspaceLink: safe.downloadUrl } : undefined;
    if (canvas && researchReportNavigation(canvas)) safe = { ...safe, ...canvas };
  }
  if (safe.downloadUrl !== undefined && (typeof safe.downloadUrl !== "string" || !safe.downloadUrl.startsWith("/api/uploads/"))) {
    const { downloadUrl: _downloadUrl, ...rest } = safe;
    safe = rest;
  }
  return safe;
}
type ResearchTool = { id: string; name: string; status?: string; result?: string; research?: ResearchProgress; researchToolName?: string };
const cache = new WeakMap<ResearchTool, { result?: string; value?: ResearchProgress }>();

/** Derive provenance from a canonical name or routing input, never result content. */
export function researchToolNameFromTool(tool: ResearchTool): string | undefined {
  const name = innerToolName(tool.name, undefined, undefined);
  const normalizedName = (value: unknown) => typeof value === "string"
    ? /^(?:mcp__metis_ai__|metis_ai[./])?(research_(?:plan|progress|search|open|find|sources|report))$/.exec(value)?.[1]
    : undefined;
  const direct = normalizedName(name);
  if (direct) return direct;
  if (!/^(?:(?:mcp__metis_ai__|metis_ai[./])?(?:mcp|call_mcp_tool|CallMcpTool))$/.test(name)) return;
  // Only server compaction writes this top-level field after validating the
  // original route. Parts omit input; large persisted inputs can be truncated.
  const persistedName = () => tool.researchToolName === normalizedName(tool.researchToolName)
    ? tool.researchToolName : undefined;
  let value: unknown = "input" in tool ? tool.input : undefined;
  if (value === undefined) return persistedName();
  // A wrapper result cannot establish its own provenance. Inspect only the
  // routing envelope, before tool arguments that may contain unrelated names.
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value === "string") {
      // Report content can be 500k bytes before JSON escaping.
      if (value.length > 4_000_000) return;
      try { value = JSON.parse(value); }
      catch { return /…\[truncated \d+ chars\]…/.test(value as string) ? persistedName() : undefined; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const envelope = value as Record<string, unknown>;
    if ("server" in envelope) {
      return envelope.server === "metis_ai"
        ? normalizedName(envelope.toolName ?? envelope.tool_name ?? envelope.tool ?? envelope.name) : undefined;
    }
    const nestedKey = ["CallMcpTool", "call_mcp_tool", "mcpToolCall", "toolCall", "input"]
      .find(key => envelope[key] !== undefined);
    if (!nestedKey) return;
    value = envelope[nestedKey];
  }
}
function validProgress(value: unknown): value is ResearchProgress {
  if (!value || typeof value !== "object") return false;
  const state = value as ResearchProgress;
  const count = (n: unknown) => Number.isInteger(n) && Number(n) >= 0;
  return state.kind === "research-progress" && typeof state.runId === "string" && !!state.runId &&
    typeof state.title === "string" && typeof state.language === "string" &&
    ["approved","researching","report_attached","denied","cancelled","awaiting_approval","revision_requested"].includes(state.status) &&
    Array.isArray(state.steps) && state.steps.length <= 20 &&
    state.steps.every(step => step && Number.isInteger(step.id) && typeof step.content === "string" &&
      ["pending","in_progress","completed"].includes(step.status)) &&
    state.steps.filter(step => step.status === "in_progress").length <= 1 &&
    [state.sourceTarget,state.minimumWords,state.discoveredCount,state.openedCount,state.readCount,state.blockedCount,state.failedCount].every(count) &&
    state.sourceTarget >= 1 && state.sourceTarget <= 1000 && state.minimumWords >= 500 &&
    state.readCount <= state.openedCount && state.openedCount <= state.discoveredCount;
}
export function researchProgressFromTool(tool: ResearchTool): ResearchProgress | undefined {
  const toolName = researchToolNameFromTool(tool);
  if (!toolName) return undefined;
  const withReportCanvas = (progress: ResearchProgress, record?: Record<string, unknown>) => {
    const safe = safeReportProgress(progress);
    // An older running workflow/worker can retain its completed snapshot while
    // the authenticated report endpoint now returns a saved Canvas artifact.
    // Only the report operation may bridge that artifact into its own tracker.
    if (toolName !== "research_report" || safe.status !== "report_attached" || researchReportNavigation(safe)) return safe;
    const artifact = record ?? (tool.result?.includes("canvasId") && tool.result.includes("workspaceLink") ? unwrapToolRecord(tool.result) : undefined);
    if (tool.status === "error" || artifact?.isError === true || artifact?.error || artifact?.ok === false || artifact?.success === false ||
        typeof artifact?.canvasId !== "string" || typeof artifact.workspaceLink !== "string" ||
        !researchReportNavigation({ canvasId: artifact.canvasId, workspaceLink: artifact.workspaceLink })) return safe;
    return { ...safe, canvasId: artifact.canvasId, workspaceLink: artifact.workspaceLink };
  };
  if (validProgress(tool.research)) return withReportCanvas(tool.research);
  const previous = cache.get(tool);
  if (previous && previous.result === tool.result) return previous.value;
  const raw = tool.result;
  let value: ResearchProgress | undefined;
  if (raw?.includes("research-progress")) {
    const record = unwrapToolRecord(raw);
    const candidate = record?.research;
    if (validProgress(candidate)) value = withReportCanvas(candidate, record);
  }
  cache.set(tool, { result: raw, value });
  return value;
}

/** The first approved embed stays the anchor; later tool results update its state in place. */
export const researchTrackKey = (messageId: string, toolId: string) => JSON.stringify([messageId, toolId]);
export function researchTracks(messages: readonly { id: string; tools?: readonly ResearchTool[]; parts?: readonly ({ type: string } & Partial<ResearchTool>)[] }[]) {
  const runs = new Map<string, { messageId: string; toolId: string; progress: ResearchProgress }>();
  for (const message of messages) {
    const tools = new Map((message.tools || []).map(tool => [tool.id, tool]));
    for (const part of message.parts || []) {
      if (part.type === "tool" && part.id && part.name) tools.set(part.id, { ...tools.get(part.id), ...part } as ResearchTool);
    }
    for (const tool of tools.values()) {
      if (tool.status === "error") continue;
      const progress = researchProgressFromTool(tool);
      if (!progress || !["approved", "researching", "report_attached"].includes(progress.status)) continue;
      const previous = runs.get(progress.runId);
      runs.set(progress.runId, { messageId: previous?.messageId || message.id, toolId: previous?.toolId || tool.id, progress });
    }
  }
  return new Map([...runs.values()].map(run => [researchTrackKey(run.messageId, run.toolId), run.progress]));
}
