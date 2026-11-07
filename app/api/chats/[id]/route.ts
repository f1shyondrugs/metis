import { setChatModelChain } from "@/lib/model-chains";
import { getChatMetadata } from "@/lib/db-store";
import { ensureChatPage, updateChatOffThread } from "@/lib/chat-page-loader";
import { getDatabase } from "@/lib/sqlite";
import { randomUUID, createHash } from "node:crypto";
const pageBootId=randomUUID();
import { canAccessChat } from "@/lib/project-access";
import { withChatProgramEvents } from "@/lib/chat-program-events-server";
import { archiveProjectAgent, getProjectAgentForChat } from "@/lib/project-team";
import { materializeQueuedUploads, type QueuedUploadMessage } from "@/lib/queued-uploads";
import { ChatProjectError, validateChatProjectMove } from "@/lib/chat-projects";
import { projectModelOverride } from "@/lib/project-model-server";
import { getAuthenticatedUser } from "@/lib/auth";
import { browserLoginRequest } from "@/lib/browser-login-client";
import {
  deleteChat,
  getChatPage,
  type BrowserContext,
  type PendingChatQuestion,
  type WorkspaceItem,
} from "@/lib/db-store";
import type { ChatSessionState } from "@/lib/store";
import type { ChatBadge } from "@/lib/store";
import { requestJobModelSwitch } from "@/lib/db-jobs";
import { isModelAllowed } from "@/lib/model-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = user.id;
  const searchParams = new URL(req.url).searchParams;
  const requestedLimit = Number(searchParams.get("messageLimit") || "10");
  const requestedOffset = Number(searchParams.get("messageOffset") || "0");
  const messageLimit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 10;
  const messageOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0;
  if (!canAccessChat(id,ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  try { await ensureChatPage(id); } catch { return Response.json({ error: "History is being prepared. Please retry." }, { status: 503, headers: { "Retry-After": "1" } }); }
  // Both local writes and commits from other connections invalidate this token,
  // including job/handoff status changes that do not alter chat.updatedAt.
  const db=getDatabase();
  const version=JSON.stringify([db.prepare("PRAGMA data_version").get(),db.prepare("SELECT total_changes() AS changes").get()]);
  const etag=JSON.stringify(createHash("sha256").update(pageBootId+":"+id+":"+searchParams.toString()+":"+version).digest("base64url"));
  if(req.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:{ETag:etag,"Cache-Control":"private, no-store"}});
  const beforeValue=searchParams.get("messageBefore");
  const before=beforeValue!==null && Number.isSafeInteger(Number(beforeValue)) && Number(beforeValue)>=0 ? Number(beforeValue) : undefined;
  const page = getChatPage(id, ownerId, messageLimit, messageOffset,before);
  if (!page) {
    const state=getDatabase().prepare("SELECT revision,ready_revision FROM chat_page_state WHERE chat_id=?").get(id) as {revision:number;ready_revision:number}|undefined;
    if(state && state.revision!==state.ready_revision)return Response.json({error:"Chat changed while loading. Retry shortly."},{status:503,headers:{"Retry-After":"1"}});
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ...page, chat: { ...page.chat, messages: withChatProgramEvents(page.chat.messages, id, ownerId) } }, { headers: { "Cache-Control": "private, no-store", ETag: etag } });
}

export async function PATCH(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = user.id;
  let body: {
    title?: string;
    titleSource?: "default" | "user" | "agent";
    agentTitleLocked?: boolean;
    keywords?: string[] | null;
    agentId?: string | null;
    modelId?: string | null;
    modelParams?: Array<{ id: string; value: string }> | null;
    queuedMessages?: QueuedUploadMessage[] | null;
    pinned?: boolean;
    archived?: boolean;
    canvas?: string | null;
    workspaces?: WorkspaceItem[] | null;
    browserContext?: BrowserContext | null;
    sessionState?: ChatSessionState | null;
    pendingQuestion?: PendingChatQuestion | null;
    runtimeMode?: string | null;
    badge?: ChatBadge | null;
    readRevision?: number;
    touchUpdatedAt?: boolean;
    projectId?: string | null;
  };
  try {
    body = (await req.json()) as {
      title?: string;
      titleSource?: "default" | "user" | "agent";
      agentTitleLocked?: boolean;
      keywords?: string[] | null;
      agentId?: string | null;
      modelId?: string | null;
      modelParams?: Array<{ id: string; value: string }> | null;
      queuedMessages?: QueuedUploadMessage[] | null;
      pinned?: boolean;
      archived?: boolean;
      canvas?: string | null;
      workspaces?: WorkspaceItem[] | null;
      browserContext?: BrowserContext | null;
      sessionState?: ChatSessionState | null;
      pendingQuestion?: PendingChatQuestion | null;
      runtimeMode?: string | null;
      badge?: ChatBadge | null;
    readRevision?: number;
      touchUpdatedAt?: boolean;
      projectId?: string | null;
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!canAccessChat(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    body.queuedMessages = materializeQueuedUploads(id, body.queuedMessages, ownerId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save queued attachments" }, { status: 400 });
  }

  const teamAgent = getProjectAgentForChat(id, ownerId);
  if (body.projectId !== undefined) {
    if (body.projectId !== null && (typeof body.projectId !== "string" || !body.projectId.trim())) {
      return Response.json({ error: "Invalid project ID" }, { status: 400 });
    }
    try { validateChatProjectMove(id, body.projectId, ownerId); }
    catch (error) {
      if (error instanceof ChatProjectError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  if (body.readRevision !== undefined && (!Number.isSafeInteger(body.readRevision) || body.readRevision < 0)) return Response.json({ error: "Invalid read revision" }, { status: 400 });
  const requestedModelId =
    typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (requestedModelId && !isModelAllowed(ownerId, requestedModelId)) {
    return Response.json(
      { error: "This model is not available for your account" },
      { status: 403 },
    );
  }

  const projectModel = projectModelOverride(teamAgent?.projectId, ownerId);
  if (projectModel) { body.modelId = projectModel.modelId; body.modelParams = projectModel.modelParams; }
  if (requestedModelId && getChatMetadata(id, ownerId)?.modelId !== requestedModelId) setChatModelChain(ownerId, id, null);
  const sessionState = body.sessionState ? { ...body.sessionState } : body.sessionState;
  // Only the internal subagent route may widen a child's goal reference scope.
  if (sessionState) delete sessionState.goalOriginChatId;
  let chat;
  try {
    chat = await updateChatOffThread(
      id,
      ownerId,
      {
        ...body,
        sessionState,
        pendingApproval: undefined,
        approvedPatterns: undefined,
        // PATCH is used for UI/session metadata. Only message writes should
        // move a chat in the activity-sorted sidebar.
        touchUpdatedAt: body.touchUpdatedAt === true,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceNameConflict") {
      return Response.json(
        { error: "A plan with this name already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
  if (!chat) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const modelSwitch = requestedModelId
    ? requestJobModelSwitch(
        id,
        ownerId,
        projectModel?.modelId || requestedModelId,
        body.modelParams || undefined,
      )
    : null;
  // Metadata/session PATCHes do not need to send the complete transcript back
  // to the browser. Large chats can contain several megabytes of messages,
  // and returning them here multiplies the cost of otherwise tiny autosaves.
  return Response.json({
    chat: {
      ...chat,
      messages: [],
    },
    ...(modelSwitch?.pendingModelId
      ? {
          modelSwitch: {
            requested: true,
            jobId: modelSwitch.id,
            modelId: modelSwitch.pendingModelId,
          },
        }
      : {}),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = user.id;
  const teamAgent = getProjectAgentForChat(id, ownerId);
  if (teamAgent) { archiveProjectAgent(teamAgent.projectId, teamAgent.id, ownerId); return Response.json({ ok: true, archived: true }); }
  if (!deleteChat(id, ownerId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await browserLoginRequest(ownerId,id,"forget_chat",{},true).catch(()=>{});
  return Response.json({ ok: true });
}
