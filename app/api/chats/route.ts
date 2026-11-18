import { CHAT_LIST_PAGE_SIZE, CHAT_LIST_MAX_PAGE_SIZE, decodeChatListCursor, encodeChatListCursor } from "@/lib/chat-list-pagination";
import { getProject } from "@/lib/projects";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import {
  createChat,
  listChatsForUser,
  updateChat,
  type BrowserContext,
} from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const params = new URL(req.url).searchParams;
    const limitValue = params.get("limit");
    const limit = limitValue === null ? CHAT_LIST_PAGE_SIZE : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > CHAT_LIST_MAX_PAGE_SIZE) {
      return Response.json({ error: "Invalid chat list limit" }, { status: 400 });
    }
    let after;
    try {
      if (params.has("cursor")) after = decodeChatListCursor(params.get("cursor")!);
    } catch {
      return Response.json({ error: "Invalid chat list cursor" }, { status: 400 });
    }
    const rows = listChatsForUser((await getAuthenticatedUserId(req)) ?? undefined, {
      includeArchived: params.get("includeArchived") === "true",
      limit: limit + 1,
      after,
      projectId: params.get("projectId") || undefined,
      sidebar: params.get("sidebar") === "true",
    });
    const chats = rows.slice(0, limit);
    return Response.json({
      chats,
      nextCursor: rows.length > limit ? encodeChatListCursor(chats[chats.length - 1]) : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    captureApiError("/api/chats GET", error, req);
    return Response.json({ error: "Could not list chats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: {
      title?: string;
      browserContext?: BrowserContext;
      modelId?: string;
      modelParams?: Array<{ id: string; value: string }>;
      incognito?: boolean;
      modeId?: string;
      runtimeMode?: string;
      projectId?: string;
    } = {};
    try {
      body = (await req.json()) as {
        title?: string;
        browserContext?: BrowserContext;
        modelId?: string;
        modelParams?: Array<{ id: string; value: string }>;
        incognito?: boolean;
        modeId?: string;
        runtimeMode?: string;
        projectId?: string;
      };
    } catch {
      body = {};
    }

    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    if (body.projectId && getProject(body.projectId, ownerId)?.mode === "agents") return Response.json({ error: "Create an agent in this project." }, { status: 400 });
    let chat = createChat(
      body.title,
      body.browserContext,
      ownerId,
      {
        id: body.modelId?.trim(),
        params: Array.isArray(body.modelParams) ? body.modelParams : undefined,
      },
      { incognito: body.incognito === true, projectId: body.projectId?.trim() || undefined },
    );
    if (body.modeId?.trim() || body.runtimeMode?.trim()) {
      chat = updateChat(chat.id, {
        ...(body.modeId?.trim() ? { sessionState: { modeId: body.modeId.trim().slice(0, 80) } } : {}),
        ...(body.runtimeMode?.trim() ? { runtimeMode: body.runtimeMode.trim() } : {}),
      }, ownerId) || chat;
    }
    return Response.json({ chat }, { status: 201 });
  } catch (error) {
    captureApiError("/api/chats POST", error, req);
    return Response.json({ error: "Could not create chat" }, { status: 500 });
  }
}
