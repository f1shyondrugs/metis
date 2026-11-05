import { isResearchReportCanvas, RESEARCH_REPORT_MAX_BYTES } from "./workspace-limits";

export type MarkdownAttachmentTarget =
  | { kind: "note"; id: string }
  | { kind: "workspace"; id: string; chatId: string; contentLimit?: number };

export function markdownAttachmentTarget(noteId?: string, workspace?: { id: string; chatId: string; type?: string; idempotencyKey?: string }): MarkdownAttachmentTarget | null {
  if (workspace) return { kind: "workspace", id: workspace.id, chatId: workspace.chatId, ...(isResearchReportCanvas(workspace) ? { contentLimit: RESEARCH_REPORT_MAX_BYTES } : {}) };
  return noteId ? { kind: "note", id: noteId } : null;
}

export function markdownAttachmentLimit(target: MarkdownAttachmentTarget | null, maxLength?: number) {
  const domainLimit = target?.kind === "note" ? 50_000 : target?.kind === "workspace" ? Math.min(RESEARCH_REPORT_MAX_BYTES, target.contentLimit ?? 100_000) : Number.POSITIVE_INFINITY;
  return maxLength === undefined ? (Number.isFinite(domainLimit) ? domainLimit : 100_000) : Math.min(domainLimit, Math.max(0, maxLength));
}

export function appendMarkdownAttachment(value: string, source: string, maxLength: number) {
  if (value.includes(source)) return value;
  const content = value + (value ? "\n\n" : "") + source;
  if (content.length > maxLength) throw new Error("Document is full. Remove some content before retrying the attachment.");
  return content;
}

/** Append against the latest remote version. A retry must never overwrite a concurrent edit. */
export async function persistMarkdownAttachment(
  target: MarkdownAttachmentTarget,
  source: string,
  maxLength: number,
  request: typeof fetch = fetch,
): Promise<Record<string, unknown> & { content: string; version: number }> {
  const getUrl = target.kind === "workspace"
    ? "/api/workspaces?chatId=" + encodeURIComponent(target.chatId) + "&id=" + encodeURIComponent(target.id)
    : "/api/notes/" + encodeURIComponent(target.id);
  const patchUrl = target.kind === "workspace" ? "/api/workspaces" : getUrl;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request(getUrl, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load the document for attachment.");
    const record = target.kind === "workspace" ? body.workspace : body.note;
    if (!record || typeof record.content !== "string" || typeof record.version !== "number") throw new Error("Invalid document response.");
    const content = appendMarkdownAttachment(record.content, source, maxLength);
    if (content === record.content) return record;
    const saved = await request(patchUrl, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, version: record.version, ...(target.kind === "workspace" ? { chatId: target.chatId, id: target.id } : {}) }),
    });
    if (saved.status === 409) continue;
    const result = await saved.json();
    if (!saved.ok) throw new Error(result.error || "Could not save the attachment.");
    return target.kind === "workspace" ? result.workspace : result.note;
  }
  throw new Error("Document changed during attachment. Retry the upload to attach the file.");
}
