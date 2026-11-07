import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { getChat, updateChat } from "@/lib/db-store";
import { isTextAttachment } from "@/lib/file-types";
import { resolveUploadPath } from "@/lib/uploads";
import { workspaceContentError, WORKSPACE_MAX_CHARACTERS } from "@/lib/workspace-limits";
import type { WorkspaceItem } from "@/lib/store";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const result = (workspace: WorkspaceItem) => json({ workspace, workspaceLink: `workspace://${workspace.type}/${workspace.id}` });

export async function createChatWorkspace(input: unknown, userId?: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Invalid request" }, 400);
  const body = input as Record<string, unknown>;
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const type = body.type === "canvas" || body.type === "plan" ? body.type : null;
  if (!chatId || !type) return json({ error: "chatId and type (canvas or plan) are required" }, 400);
  let chat = getChat(chatId, userId);
  if (!chat) return json({ error: "Chat not found" }, 404);
  if (chat.incognito) return json({ error: "Workspaces are unavailable in Incognito." }, 403);
  const importing = body.sourceUrl !== undefined;
  if (importing && typeof body.sourceUrl !== "string") return json({ error: "Invalid file URL" }, 400);
  if (!importing && (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId))) return json({ error: "requestId is required" }, 400);
  let content = "", requestedName = type === "plan" ? "Plan" : "Canvas";
  const key = importing
    ? "file-import:" + type + ":" + createHash("sha256").update(String(body.sourceUrl)).digest("hex")
    : "manual:" + type + ":" + body.requestId;
  let storedName = "";
  if (importing) {
    const prefix = "/api/uploads/" + chatId + "/";
    const source = body.sourceUrl as string;
    if (!source.startsWith(prefix) || source.length > 2000 || /[?#]/.test(source)) return json({ error: "File not found" }, 404);
    try { storedName = decodeURIComponent(source.slice(prefix.length)); } catch { return json({ error: "Invalid file URL" }, 400); }
    const meta = chat.messages.flatMap(message => message.attachments || []).find(file => file.storedName === storedName);
    if (!meta) return json({ error: "File not found" }, 404);
    if (!isTextAttachment(meta.mimeType, meta.name)) return json({ error: "Only text files can be opened in a workspace." }, 415);
    const existing = chat.workspaces?.find(item => item.idempotencyKey === key);
    if (existing) return result(existing);
    const filePath = resolveUploadPath(chatId, storedName, userId);
    if (!filePath) return json({ error: "File not found" }, 404);
    // Bound memory independently of upload limits; never import a truncated preview.
    const maxBytes = WORKSPACE_MAX_CHARACTERS * 4 + 3;
    try {
      const handle = await open(filePath, "r");
      try {
        if (!(await handle.stat()).isFile()) return json({ error: "File not found" }, 404);
        const buffer = Buffer.alloc(maxBytes + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
          if (!bytesRead) break;
          total += bytesRead;
        }
        if (total > maxBytes) return json({ error: "File exceeds the workspace limit of 100,000 characters." }, 413);
        const bytes = buffer.subarray(0, total);
        const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
        try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
        catch { return json({ error: "This file is not valid UTF-8 or UTF-16 text." }, 415); }
        if (content.includes("\u0000")) return json({ error: "Binary files cannot be opened in a workspace." }, 415);
      } finally { await handle.close(); }
    } catch { return json({ error: "File could not be read" }, 404); }
    requestedName = meta.name.replace(/\.[^.]+$/, "") || meta.name;
  }
  const error = workspaceContentError({ type }, content);
  if (error) return json({ error }, 413);
  // Recheck permissions and merge with current workspaces after asynchronous I/O.
  chat = getChat(chatId, userId);
  if (!chat) return json({ error: "Chat not found" }, 404);
  if (chat.incognito) return json({ error: "Workspaces are unavailable in Incognito." }, 403);
  if (importing && !chat.messages.some(message => message.attachments?.some(file => file.storedName === storedName))) return json({ error: "File not found" }, 404);
  const existing = chat.workspaces?.find(item => item.idempotencyKey === key);
  if (existing) return result(existing);
  if ((chat.workspaces?.length || 0) >= 20) return json({ error: "This chat already has 20 workspaces. Delete one before creating another." }, 409);
  const names = new Set((chat.workspaces || []).map(item => item.name.trim().toLowerCase()));
  const base = requestedName.slice(0, 190);
  let name = base, suffix = 2;
  while (names.has(name.toLowerCase())) name = base + " (" + suffix++ + ")";
  const now = new Date().toISOString();
  const workspace: WorkspaceItem = { id: randomUUID(), type, name, content, version: 1, scope: "chat", createdAt: now, updatedAt: now, idempotencyKey: key };
  const saved = updateChat(chatId, { workspaces: [...(chat.workspaces || []), workspace] }, userId);
  if (!saved?.workspaces?.some(item => item.id === workspace.id)) return json({ error: "Workspace could not be persisted" }, 503);
  return result(workspace);
}
