import { fileChangeDetails, rebaseFileChangeRanges, type FileChangeRange, type FileLineChange } from "@/lib/file-change-ranges";
import type { ToolPart } from "@/lib/store";
import { innerToolName, unwrapToolRecord } from "@/lib/tool-call-display";
import { parseWorkspaceFileLink, workspaceFileHref } from "@/lib/workspace-file-link";

export type EditedFile = { path: string; target: string; additions?: number; deletions?: number; ranges?: FileChangeRange[]; lineChanges?: FileLineChange[] };
export type EditedFileSummary = EditedFile & {
  partialCounts?: boolean;
  /** Historical ranges stay in the coordinates of their own snapshot. */
  versions?: Array<{ toolId: string; ranges?: FileChangeRange[] }>;
};

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Prefer exact snapshots; compact historical tools can retain explicit counters. */
function lineStats(tool: Pick<ToolPart, "diff" | "editedFile">): Pick<EditedFile, "additions" | "deletions" | "ranges" | "lineChanges"> | undefined {
  const saved = tool.editedFile;
  const savedCounts = validCount(saved?.additions) && validCount(saved?.deletions)
    ? { additions: saved.additions, deletions: saved.deletions } : undefined;
  if (savedCounts && saved?.ranges) return savedCounts;
  const diff = tool.diff;
  if (diff && "before" in diff && typeof diff.after === "string") {
    const details = fileChangeDetails(diff.before ?? "", diff.after);
    if (details) return details;
  }
  if (savedCounts) return savedCounts;
  if (validCount(diff?.additions) && validCount(diff?.deletions)) return { additions: diff.additions, deletions: diff.deletions };
  const changes = saved?.lineChanges;
  // A capped historical mapping cannot prove the complete totals.
  if (changes?.length && changes.length < 100 && changes.every(change => validCount(change.newCount) && validCount(change.oldCount))) {
    return {
      additions: changes.reduce((total, change) => total + change.newCount, 0),
      deletions: changes.reduce((total, change) => total + change.oldCount, 0),
    };
  }
}

function text(record: Record<string, unknown> | undefined, ...keys: string[]) {
  return keys.map(key => record?.[key]).find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

/** Capture before raw tool arguments/results are truncated or deferred. Null means no edit. */
export function editedFileFromTool(tool: Pick<ToolPart, "name" | "status" | "input" | "result" | "path" | "diff" | "editedFile">): EditedFile | null {
  if (!["completed", "success", "succeeded"].includes(tool.status.toLowerCase())) return null;
  if (tool.editedFile !== undefined) return tool.editedFile ? { ...tool.editedFile, ...lineStats(tool) } : null;
  const args = unwrapToolRecord(tool.input);
  const suffix = tool.name.toLowerCase().split(/__|[.:/]/).pop()?.replace(/[-_]/g, "");
  const resolvedName = ["mcp", "callmcptool"].includes(suffix || "") ? text(args, "toolName", "tool_name", "tool", "name") || tool.name : innerToolName(tool.name, tool.input, tool.result);
  const name = resolvedName.toLowerCase().split(/__|[.:/]/).pop()?.replace(/[-_]/g, "");
  if (!["editfile", "writefile", "createfile", "strreplace", "write"].includes(name || "")) return null;
  const result = unwrapToolRecord(tool.result);
  if (args?.dryRun === true || args?.dry_run === true || result?.dryRun === true || result?.dry_run === true ||
      result?.changed === false || result?.isError === true || result?.success === false || result?.error ||
      (typeof result?.exit_code === "number" && result.exit_code !== 0)) return null;
  if (typeof tool.diff?.before === "string" && tool.diff.before === tool.diff.after) return null;
  const path = text(result, "path", "filePath") || tool.path || text(args, "path", "filePath", "file_path", "filename");
  if (!path || /[\u0000-\u001f\u007f]/.test(path)) return null;
  const target = text(args, "target") || (text(args, "client_id", "clientId") ? "client:" + text(args, "client_id", "clientId") : "server");
  return { path, target: target === "local" ? "server" : target, ...lineStats(tool) };
}

/** One row per file and device, in first-edit order, scoped to this assistant message. */
export function editedFilesForMessage(message: { tools?: ToolPart[]; parts?: Array<{ type: string } & Partial<ToolPart>> }): EditedFileSummary[] {
  const files = new Map<string, EditedFileSummary>();
  // Full canonical tools take precedence over the stripped order-only parts.
  const tools = new Map<string, ToolPart>();
  for (const part of message.parts || []) if (part.type === "tool") tools.set(part.id || "", part as ToolPart);
  for (const tool of message.tools || []) tools.set(tool.id, tool);
  for (const tool of tools.values()) {
    const file = editedFileFromTool(tool);
    if (!file) continue;
    const key = file.target + "\0" + file.path;
    const previous = files.get(key);
    const version = { toolId: tool.id, ranges: file.ranges };
    if (!previous) {
      files.set(key, { ...file, versions: [version] });
      continue;
    }
    previous.versions!.push(version);
    const hasCounts = validCount(file.additions) && validCount(file.deletions);
    const hadCounts = validCount(previous.additions) && validCount(previous.deletions);
    // These ranges are only for opening the current file, not reviewing history.
    previous.ranges = file.lineChanges
      ? [...rebaseFileChangeRanges(previous.ranges || [], file.lineChanges), ...(file.ranges || [])].slice(0, 100)
      : file.ranges;
    previous.lineChanges = undefined;
    if (hasCounts || hadCounts) {
      previous.additions = (hadCounts ? previous.additions! : 0) + (hasCounts ? file.additions! : 0);
      previous.deletions = (hadCounts ? previous.deletions! : 0) + (hasCounts ? file.deletions! : 0);
      if (!hasCounts || !hadCounts) previous.partialCounts = true;
    }
  }
  return [...files.values()];
}

/** Both locations use this turn selection so completion moves the list atomically. */
export function activeEditedFilesMessageId(
  messages: ReadonlyArray<{ id: string; role: string; streaming?: boolean; errorMessage?: string; programEvent?: unknown; questionAnswer?: unknown }>,
  { running = false, loading = false }: { running?: boolean; loading?: boolean } = {},
): string | undefined {
  if (loading) return undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    // A new prompt must never inherit files from an earlier response.
    if (message.role === "user" && !message.questionAnswer) return undefined;
    if (message.role !== "assistant" || message.programEvent) continue;
    // An explicit terminal stream state wins over a delayed server running status.
    if (message.streaming === false || message.errorMessage) return undefined;
    if (message.streaming || running) return message.id;
    return undefined;
  }
  return undefined;
}

export function editedFileHref(file: EditedFile): string | undefined {
  if (file.target !== "server") return undefined;
  const first = file.ranges?.[0];
  const href = workspaceFileHref({ ...file, ...(first ? { line: first.startLine, endLine: first.endLine } : {}) });
  return parseWorkspaceFileLink(href) ? href : undefined;
}
