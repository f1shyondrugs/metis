import type { MemoryScope } from "@/lib/memory-scopes.mjs";
import { addLearnedFact } from "@/lib/context-scope";
import { deleteNote, getNote, listNotes, updateNote } from "@/lib/shared-context";

/** Memory operations for one owned chat; facts never enter the global store. */
export function chatMemoryAction(ownerId: string | undefined, chatId: string, action: string, body: Record<string, unknown>, availableScopes: readonly MemoryScope[] = ["chat"]) {
  const scopes = { scope: "chat", availableScopes };
  if (action === "access") return Response.json(scopes);
  if (action === "list") return Response.json({ ...scopes, memories: listNotes({ ownerId, chatId, scope: "chat" }).filter(note => note.kind === "learned_fact" && note.chatId === chatId) });
  if (action === "add") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return Response.json({ error: "content is required" }, { status: 400 });
    const memory = addLearnedFact(ownerId, chatId, { content });
    return memory ? Response.json({ ...scopes, memory }) : Response.json({ error: "Chat memory unavailable" }, { status: 403 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const note = id ? getNote(id, ownerId) : null;
  if (!note || note.kind !== "learned_fact" || note.scope !== "chat" || note.chatId !== chatId) return Response.json({ error: "Memory not found" }, { status: 404 });
  if (action === "delete") return Response.json({ ...scopes, ok: deleteNote(id, ownerId), id });
  if (action === "edit") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return Response.json({ error: "content is required" }, { status: 400 });
    return Response.json({ ...scopes, memory: updateNote(id, { ownerId, content, author: "agent" }) });
  }
  return Response.json({ error: "Unknown memory action" }, { status: 400 });
}
