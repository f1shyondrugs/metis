import { getAuthenticatedUserId } from "@/lib/auth";
import { getInternalLinkPreview } from "@/lib/internal-link-preview.server";
import { getNote } from "@/lib/shared-context";
import type { InternalLinkKind } from "@/lib/internal-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const id = params.get("id")?.trim() || "";
  const chatId = params.get("chatId")?.trim();
  if (!kind || !["plan", "canvas", "note", "automation", "issue"].includes(kind) ||
      !id || id.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(id) ||
      (chatId !== undefined && (!chatId || chatId.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(chatId)))) {
    return Response.json({ error: "A valid kind and id are required" }, { status: 400, headers });
  }
  if (params.get("view") === "icon" && kind === "note") {
    const note = getNote(id, ownerId);
    return note ? Response.json({ icon: note.icon || null }, { headers })
      : Response.json({ error: "Preview not found" }, { status: 404, headers });
  }
  const result = getInternalLinkPreview({ kind: kind as InternalLinkKind, id }, ownerId, chatId);
  return result
    ? Response.json(result, { headers })
    : Response.json({ error: "Preview not found" }, { status: 404, headers });
}
