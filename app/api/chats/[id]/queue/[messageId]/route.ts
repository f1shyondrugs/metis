import { getAuthenticatedUser } from "@/lib/auth";
import { removeQueuedMessage } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

export async function DELETE(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, messageId } = await params;
  if (!messageId || messageId.length > 200) {
    return Response.json({ error: "Invalid queued message ID" }, { status: 400 });
  }
  const retainDraftPreviews = new URL(req.url).searchParams.get("edit") === "1";
  if (!removeQueuedMessage(id, messageId, user.id, { retainDraftPreviews })) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
