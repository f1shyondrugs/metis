import { getAuthenticatedUserId } from "@/lib/auth";
import { deleteChatShare, getChatMetadata, updateChatShare } from "@/lib/db-store";
import { projectRole } from "@/lib/project-access";
import type { ChatShare } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store, max-age=0" };

function publicShare(share: ChatShare) {
  return {
    id: share.id,
    active: share.active,
    passwordProtected: Boolean(share.passwordHash),
    content: share.content,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

/** Opening sharing settings must not create or reactivate a public link. */
export async function GET(req: Request, { params }: Params) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const chat = getChatMetadata(id, userId);
  if (!chat || (chat.projectId && projectRole(chat.projectId, userId) !== "owner")) {
    return Response.json({ error: "Not found" }, { status: 404, headers });
  }
  return Response.json({ share: chat.share ? publicShare(chat.share) : null }, { headers });
}

export async function PATCH(req: Request, { params }: Params) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  let body: { active?: boolean; password?: string | null; content?: ChatShare["content"] };
  try {
    body = (await req.json()) as { active?: boolean; password?: string | null; content?: ChatShare["content"] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid sharing settings" }, { status: 400, headers });
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return Response.json({ error: "active must be a boolean" }, { status: 400, headers });
  }
  if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
    return Response.json({ error: "password must be a string or null" }, { status: 400, headers });
  }

  const { id } = await params;
  const chat = updateChatShare(id, body, userId);
  if (!chat?.share) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json({ share: publicShare(chat.share) }, { headers });
}

export async function DELETE(req: Request, { params }: Params) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const chat = deleteChatShare(id, userId);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json({ ok: true }, { headers });
}
