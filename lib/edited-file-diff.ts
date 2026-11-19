import { structuredPatch } from "diff";
import { editedFileFromTool, type EditedFile } from "@/lib/edited-files";
import type { ToolPart } from "@/lib/store";
import type { FileChangeRange } from "@/lib/file-change-ranges";

export type EditSnapshot = { before: string; after: string };
export type EditDiffFocus = { toolId: string; range: FileChangeRange };
export type EditedFileDiffRequest = { file: EditedFile; chatId?: string; messageId?: string; tools?: ToolPart[]; focus?: EditDiffFocus };

export function snapshotFromDiff(value: unknown, savedSnapshot = false): EditSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const diff = value as Record<string, unknown>;
  // Explicit null represents a file that did not exist. Missing is unknown.
  if (!(typeof diff.before === "string" || diff.before === null || savedSnapshot && diff.before === undefined) || typeof diff.after !== "string") return undefined;
  return { before: typeof diff.before === "string" ? diff.before : "", after: diff.after };
}

export function toolsForEditedFile(file: EditedFile, tools: ToolPart[] = []) {
  return [...new Map(tools.map(tool => [tool.id, tool])).values()].filter(tool => {
    const edited = editedFileFromTool(tool);
    return edited?.path === file.path && edited.target === file.target;
  });
}

/** Open the requested historical edit; a plain file click prefers a recorded change. */
export function initialEditTool(edits: ToolPart[], focus?: EditDiffFocus) {
  return edits.find(edit => edit.id === focus?.toolId)
    ?? edits.find(edit => editedFileFromTool(edit)?.ranges?.length)
    ?? edits[0];
}

export async function loadEditSnapshot(
  tool: ToolPart, context: { chatId?: string; messageId?: string }, signal: AbortSignal,
): Promise<EditSnapshot | undefined> {
  const memory = snapshotFromDiff(tool.diff, true);
  if (memory) return memory;
  if (!context.chatId || !context.messageId || !tool.id) return undefined;
  const query = new URLSearchParams({ messageId: context.messageId, toolId: tool.id });
  const response = await fetch(`/api/chats/${encodeURIComponent(context.chatId)}/tool-diff?${query}`, { signal, cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Could not load saved diff (HTTP ${response.status}).`);
  const payload = await response.json();
  return snapshotFromDiff(payload?.diff, true);
}

export function snapshotHunks(snapshot: EditSnapshot) {
  if (snapshot.before.length + snapshot.after.length > 2_000_000) throw new Error("This diff exceeds the 2 MB preview limit.");
  const patch = structuredPatch("", "", snapshot.before, snapshot.after, "", "", { context: 3, timeout: 200 });
  if (!patch) throw new Error("This diff is too complex to preview.");
  return patch.hunks;
}
