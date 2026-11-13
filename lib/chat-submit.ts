import { assistantOriginId } from "@/lib/desktop-assistant";
import { materializeUploads } from "@/lib/file-upload-store";
import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import { isChatWaitingForUser } from "@/lib/user-input-resume";
import { enqueueJob, getActiveJob, getJobForMessageId } from "@/lib/db-jobs";
import {
  appendIndexedMessageInTransaction,
  getChatMetadata,
  titleFromMessage,
  updateChat,
} from "@/lib/db-store";
import { isModelAllowed } from "@/lib/model-access";
import { stripRemovedModelParams } from "@/lib/model-params";
import {
  getPinnedNotes,
  resolveReferences,
  type ContextReference,
} from "@/lib/context";
import {
  MAX_ATTACHMENTS,
  resolveUploadPath,
  saveAttachments,
  type IncomingAttachment,
  type StoredAttachment,
} from "@/lib/uploads";


type ChatBody = {
  chatId?: string;
  message?: string;
  messageId?: string;
  sendQueuedNow?: boolean;
  referenceText?: string;
  assistantDeviceId?: string;
  references?: Array<{
    kind?: unknown;
    id?: unknown;
    label?: unknown;
    detail?: unknown;
    path?: unknown;
    content?: unknown;
    source?: unknown;
  }>;
  agentId?: string;
  modelId?: string;
  modelParams?: Array<{ id: string; value: string }>;
  attachments?: IncomingAttachment[];
  storedAttachments?: StoredAttachment[];
  uploadIds?: string[];
  incognito?: boolean;
  streamDeviceId?: string;
};

export async function submitChat(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: ChatBody = {};
  try {
    const actor = await getAuthenticatedUser(req);
    const ownerId = actor?.id;
    body = (await req.json().catch(() => ({}))) as ChatBody;
    const chatId = body.chatId?.trim();
    const message = body.message?.trim() || "";
    const requestedModelId = body.modelId?.trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    let references = (
      Array.isArray(body.references)
        ? body.references
            .filter(
              (reference) =>
                reference &&
                typeof reference.kind === "string" &&
                typeof reference.id === "string" &&
                typeof reference.label === "string",
            )
            .slice(0, 20)
            .map((reference) => ({
              kind: String(reference.kind).slice(0, 40),
              id: String(reference.id).slice(0, 300),
              label: String(reference.label).slice(0, 300),
              ...(reference.source === "pinned"
                ? { source: "pinned" as const }
                : {}),
              ...(typeof reference.detail === "string"
                ? { detail: reference.detail.slice(0, 500) }
                : {}),
              ...(typeof reference.path === "string"
                ? { path: reference.path.slice(0, 4_000) }
                : {}),
              ...(typeof reference.content === "string"
                ? { content: reference.content.slice(0, 8_000) }
                : {}),
            }))
        : []
    ) as ContextReference[];
    const referenceText =
      typeof body.referenceText === "string"
        ? body.referenceText.trim().slice(0, 100_000)
        : "";
    if (!chatId || (!message && !attachments.length && !body.storedAttachments?.length && !body.uploadIds?.length)) {
      return Response.json(
        { error: "chatId and message or attachments are required" },
        { status: 400 },
      );
    }
    if (requestedModelId && !isModelAllowed(ownerId, requestedModelId)) {
      return Response.json(
        { error: "This model is not available for your account" },
        { status: 403 },
      );
    }
    const chat = getChatMetadata(chatId, ownerId);
    if (!chat)
      return Response.json({ error: "Chat not found" }, { status: 404 });
    // The persisted chat is the source of truth. The client flag can be stale
    // after switching tabs or restoring an in-memory snapshot.
    if (chat.incognito) {
      references = [];
    }
    const requestedMessageId = body.messageId?.trim() || undefined;
    const sendQueuedNow = body.sendQueuedNow === true;
    if (sendQueuedNow && !requestedMessageId) {
      return Response.json({ error: "Queued message ID is required" }, { status: 400 });
    }
    if (sendQueuedNow && requestedMessageId) {
      const accepted = getJobForMessageId(chatId, requestedMessageId);
      if (accepted) return Response.json({
        jobId: accepted.id, runId: accepted.runId || accepted.id,
        status: accepted.status, queueMessage: accepted.queueMessage,
      }, { status: 202 });
      if (chat.removedQueuedMessageIds?.includes(requestedMessageId)) {
        return Response.json({ error: "This queued message was removed" }, { status: 409 });
      }
    }
    const assistantDeviceId = assistantOriginId(sendQueuedNow
      ? chat.queuedMessages?.find(item => item.id === requestedMessageId)?.assistantDeviceId ?? body.assistantDeviceId
      : body.assistantDeviceId);
    const resolvedExplicit = resolveReferences(ownerId, chatId, references);
    const pinnedReferences = chat.incognito
      ? []
      : getPinnedNotes(ownerId, chatId);
    const seenReferences = new Set<string>();
    references = [...pinnedReferences, ...resolvedExplicit].filter(
      (reference) => {
        const key = `${reference.kind}:${reference.id}`;
        if (seenReferences.has(key)) return false;
        seenReferences.add(key);
        return true;
      },
    );
    const occupied = getActiveJob(chatId);
    if(occupied && occupied.userId!==ownerId) return Response.json({error:"Another project member is using this chat. Wait for their run to finish."},{status:409});
    const activeJob = getActiveJob(chatId, ownerId);
    if (activeJob) {
      // Network retries reuse messageId. Returning the already accepted job is
      // idempotent; treating the retry as a second run produces random-looking
      // 409/queue behavior even though the first POST succeeded.
      if (requestedMessageId && activeJob.messageId === requestedMessageId) {
        return Response.json(
          {
            jobId: activeJob.id,
            runId: activeJob.runId || activeJob.id,
            status: activeJob.status,
            queueMessage: activeJob.queueMessage,
          },
          { status: 202 },
        );
      }
      if (!sendQueuedNow) {
        return Response.json(
          { error: "This chat already has an active run. Wait for it to finish or cancel it first." },
          { status: 409 },
        );
      }
    }
    if (isChatWaitingForUser(chat)) {
      return Response.json(
        {
          error:
            "Please answer the agent's question before starting another run.",
        },
        { status: 409 },
      );
    }

    const storedAttachments = Array.isArray(body.storedAttachments)
      ? body.storedAttachments
          .filter(
            (attachment): attachment is StoredAttachment =>
              Boolean(attachment) &&
              typeof attachment.id === "string" &&
              typeof attachment.name === "string" &&
              typeof attachment.mimeType === "string" &&
              (attachment.kind === "image" || attachment.kind === "file") &&
              typeof attachment.storedName === "string" &&
              typeof attachment.size === "number" &&
              Boolean(
                resolveUploadPath(chatId, attachment.storedName, ownerId),
              ),
          )
          .slice(0, MAX_ATTACHMENTS)
      : [];
    if (body.uploadIds?.length) {
      if (!ownerId || !Array.isArray(body.uploadIds) || !body.uploadIds.every((id) => typeof id === "string")) {
        return Response.json({ error: "Invalid upload ids" }, { status: 400 });
      }
      try { storedAttachments.push(...materializeUploads(chatId, body.uploadIds, ownerId)); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid uploads" }, { status: 400 }); }
    }
    if (storedAttachments.length + attachments.length > MAX_ATTACHMENTS) return Response.json({ error: "Too many attachments" }, { status: 400 });
    if (!message && !attachments.length && !storedAttachments.length) {
      return Response.json({ error: "Message or valid attachments are required" }, { status: 400 });
    }
    const stored: Awaited<ReturnType<typeof saveAttachments>>["stored"] = [];
    const messageId = requestedMessageId || crypto.randomUUID();
    const streamDeviceId = body.streamDeviceId?.trim().slice(0, 120)
      || req.headers.get("x-metis-device-id")?.trim().slice(0, 120)
      || undefined;
    let job;
    try {
      job = enqueueJob({
        chatId,
        userId: ownerId,
        message,
        messageId,
        ...(assistantDeviceId ? { assistantDeviceId } : {}),
        ...(chat.incognito
          ? {}
          : body.referenceText
            ? { referenceText: body.referenceText.slice(0, 100_000) }
            : {}),
        ...(references.length ? { references } : {}),
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(requestedModelId ? { modelId: requestedModelId } : {}),
        ...(body.modelParams ? { modelParams: stripRemovedModelParams(body.modelParams) ?? [] } : {}),
        attachments: stored,
        ...(chat.incognito ? { incognito: true } : {}),
        ...(streamDeviceId ? { streamDeviceId } : {}),
      }, {
        interruptActiveRun: sendQueuedNow,
        beforeInsert: () => {
          if (storedAttachments.length) stored.push(...storedAttachments);
          if (attachments.length) {
            stored.push(...saveAttachments(chatId, attachments, ownerId).stored);
          }
          const resolvedAttachments = stored.length ? stored : storedAttachments;
          const userMessage = {
            id: messageId,
            role: "user" as const,
            ...(ownerId && chat.projectId ? { authorId: ownerId, authorName: actor?.username || "Project member" } : {}),
            content:
              message ||
              `Attached ${resolvedAttachments.length} file${resolvedAttachments.length === 1 ? "" : "s"}`,
            ...(referenceText ? { referenceText } : {}),
            ...(assistantDeviceId ? { assistantDeviceId } : {}),
            ...(references.length ? { references } : {}),
            ...(resolvedAttachments.length ? { attachments: resolvedAttachments } : {}),
          };
          if (sendQueuedNow) {
            const current = getChatMetadata(chatId, ownerId);
            updateChat(chatId, {
              queuedMessages: (current?.queuedMessages ?? []).filter((item) => item.id !== messageId),
            }, ownerId, {metadataProjection:true});
          }
          const appended = appendIndexedMessageInTransaction(chatId, userMessage, ownerId);
          if (!appended) throw new Error("Chat not found while enqueueing message");
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "WaitingForUser") {
        return Response.json({ error: error.message }, { status: 409 });
      }
      if (error instanceof Error && error.name === "ActiveChatRun") {
        return Response.json(
          {
            error:
              "This chat already has an active run. Wait for it to finish or cancel it first.",
          },
          { status: 409 },
        );
      }
      if (error instanceof Error) {
        return Response.json({ error: String(error) }, { status: 400 });
      }
      throw error;
    }
    updateChat(
      chatId,
      {
        ...((chat.title === "New chat" || !chat.title.trim()) ? {
          title:titleFromMessage(message || `Attached ${stored.length} files`),
          titleSource:"default" as const,
        } : {}),
        runStatus: "running",
        runUpdatedAt: new Date().toISOString(),
        badge: null,
        ...(job.queueMessage
          ? { queueMessage: job.queueMessage }
          : { queueMessage: null }),
      },
      ownerId,
      {metadataProjection:true},
    );
    return Response.json(
      {
        jobId: job.id,
        runId: job.id,
        status: job.status,
        queueMessage: job.queueMessage,
      },
      { status: 202 },
    );
  } catch (error) {
    // Submission input, cookies and errors derived from payloads must not enter logs.
    captureApiError("/api/chat", new Error("Could not send message"));
    return Response.json({ error: "Could not send message" }, { status: 500 });
  }
}

/** Only plain structured-clone data crosses the worker boundary. Never log it. */
export type ChatSubmitRequest = { url: string; headers: [string, string][]; body: string };
export type ChatSubmitResponse = { status: number; statusText: string; headers: [string, string][]; body: string };
export async function submitSerializedChat(input: ChatSubmitRequest): Promise<ChatSubmitResponse> {
  const response = await submitChat(new Request(input.url, { method: "POST", headers: input.headers, body: input.body }));
  return { status: response.status, statusText: response.statusText, headers: Array.from(response.headers.entries()), body: await response.text() };
}
