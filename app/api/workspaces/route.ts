import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, updateChat } from "@/lib/db-store";
import { workspaceContentError } from "@/lib/workspace-limits";
import { createChatWorkspace } from "@/lib/workspace-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId")?.trim() || "";
  const id = url.searchParams.get("id")?.trim() || "";
  const type = url.searchParams.get("type");
  if (!chatId || !id) return Response.json({ error: "chatId and id are required" }, { status: 400 });
  const chat = getChat(chatId, userId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  const workspace = chat.workspaces?.find((item) => item.id === id && (!type || item.type === type));
  if (!workspace) return Response.json({ error: "Workspace not found" }, { status: 404 });
  return Response.json({ workspace, workspaceLink: `workspace://${workspace.type}/${workspace.id}` });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  return createChatWorkspace(body, userId);
}

export async function PATCH(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!chatId || !id) return Response.json({ error: "chatId and id are required" }, { status: 400 });
  const chat = getChat(chatId, userId);
  const current = chat?.workspaces?.find((item) => item.id === id);
  if (!chat || !current) return Response.json({ error: "Workspace not found" }, { status: 404 });
  const expectedVersion = typeof body.version === "number" ? Math.floor(body.version) : undefined;
  if (expectedVersion !== undefined && expectedVersion !== (current.version || 1)) {
    return Response.json({ error: "Workspace changed by another client", workspace: current }, { status: 409 });
  }
  const contentError = typeof body.content === "string" ? workspaceContentError(current, body.content) : undefined;
  if (contentError) return Response.json({ error: contentError }, { status: 413 });
  const updated = {
    ...current,
    ...(typeof body.title === "string" ? { name: body.title.trim().slice(0, 200) || current.name } : {}),
    ...(typeof body.content === "string" ? { content: body.content } : {}),
    version: (current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  const saved = updateChat(chatId, { workspaces: chat.workspaces?.map((item) => item.id === id ? updated : item) || [] }, userId);
  if (!saved) return Response.json({ error: "Workspace could not be persisted" }, { status: 503 });
  return Response.json({ workspace: updated, workspaceLink: `workspace://${updated.type}/${updated.id}` });
}
