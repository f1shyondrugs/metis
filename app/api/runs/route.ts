import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import {
  enqueueJob,
  getActiveJob,
  getJob,
  listJobs,
  listRunEvents,
} from "@/lib/db-jobs";
import { appendMessageInTransaction, getChat } from "@/lib/db-store";
import { SSE_HEADERS } from "@/lib/sse";
import { canAccessChat } from "@/lib/project-access";
import { createRunEventStream } from "@/lib/run-event-stream";
import { saveAttachments, type IncomingAttachment } from "@/lib/uploads";
import { isModelAllowed } from "@/lib/model-access";
import { stripRemovedModelParams } from "@/lib/model-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function GET(req: Request) {
  if (!(await isAuthenticated(req)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const search = new URL(req.url).searchParams;
  const chatId = search.get("chatId") || undefined;
  const jobId = search.get("jobId") || undefined;
  try {
    const userId = (await getAuthenticatedUserId(req)) ?? undefined;
    const after = Number(search.get("after") || "0");
    if (search.get("status") === "1") {
      const job = jobId ? getJob(jobId) : null;
      if (!chatId || !job || job.chatId !== chatId || job.userId !== userId || !canAccessChat(chatId, userId)) return Response.json({ error: "Run not found." }, { status: 404 });
      return Response.json({ job: { id: job.id, status: job.status, error: job.error, queueMessage: job.queueMessage } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (chatId && search.get("events") === "1") {
      if (search.get("stream") === "1") {
        const stream = createRunEventStream({
          after: Number.isFinite(after) ? after : 0,
          signal: req.signal,
          // Full deltas are the default; snapshot-only remains opt-in.
          snapshotOnly: search.get("mode") === "snapshot",
          read: (cursor, limit) => listRunEvents(chatId, userId, cursor, jobId, limit) as Array<{ id: number; event: string; data: unknown }>,
          terminal: () => {
            if (!jobId) return null;
            const currentJob = getJob(jobId);
            // The fallback must obey the same chat/user boundary as replay.
            if (!currentJob || currentJob.chatId !== chatId || currentJob.userId !== userId) return null;
            if (currentJob.status === "completed" || currentJob.status === "cancelled") {
              return { event: "done", data: { status: currentJob.status } };
            }
            if (currentJob.status === "error" || currentJob.status === "interrupted") {
              return { event: "error", data: {
                message: currentJob.error || (currentJob.status === "interrupted"
                  ? "Agent run interrupted." : "Agent run failed."),
              } };
            }
            return null;
          },
        });
        return new Response(stream, { headers: SSE_HEADERS });
      }
      return Response.json({
        events: listRunEvents(
          chatId,
          userId,
          Number.isFinite(after) ? after : 0,
          jobId,
        ),
      });
    }
    return Response.json({ jobs: listJobs(chatId, userId) });
  } catch (error) {
    captureApiError("/api/runs GET", error, req, { chatId: chatId?.valueOf(), jobId: jobId?.valueOf() });
    return Response.json(
      { error: "Could not read run stream" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: {
    chatId?: string;
    message?: string;
    messageId?: string;
    referenceText?: string;
    agentId?: string;
    modelId?: string;
    modelParams?: Array<{ id: string; value: string }>;
    attachments?: IncomingAttachment[];
  } = {};
  try {
    const userId = (await getAuthenticatedUserId(req)) ?? undefined;
    body = (await req.json().catch(() => ({}))) as {
      chatId?: string;
      message?: string;
      messageId?: string;
      referenceText?: string;
      agentId?: string;
      modelId?: string;
      modelParams?: Array<{ id: string; value: string }>;
      attachments?: IncomingAttachment[];
    };
    const chatId = body.chatId?.trim();
    const message = body.message?.trim() || "";
    const chat = chatId ? getChat(chatId, userId) : null;
    if (!chat || (!message && !body.attachments?.length)) {
      return Response.json(
        { error: "chatId and message or attachments are required" },
        { status: 400 },
      );
    }
    const requestedModelId = body.modelId?.trim();
    if (requestedModelId && !isModelAllowed(userId, requestedModelId)) {
      return Response.json(
        { error: "This model is not available for your account" },
        { status: 403 },
      );
    }
    if (getActiveJob(chat.id, userId)) {
      return Response.json(
        {
          error:
            "This chat already has an active run. Wait for it to finish or cancel it first.",
        },
        { status: 409 },
      );
    }
    if (
      chat.pendingQuestion ||
      chat.pendingApproval ||
      chat.runStatus === "waiting_input" ||
      chat.runStatus === "waiting_for_user"
    ) {
      return Response.json(
        {
          error:
            "Please answer the agent's question before starting another run.",
        },
        { status: 409 },
      );
    }
    const stored: Awaited<ReturnType<typeof saveAttachments>>["stored"] = [];
    const messageId = body.messageId?.trim();
    let job;
    try {
      job = enqueueJob({
        chatId: chat.id,
        userId,
        message,
        ...(messageId ? { messageId } : {}),
        ...(body.referenceText
          ? { referenceText: body.referenceText.slice(0, 100_000) }
          : {}),
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(requestedModelId ? { modelId: requestedModelId } : {}),
        ...(body.modelParams ? { modelParams: stripRemovedModelParams(body.modelParams) ?? [] } : {}),
        attachments: stored,
      }, {
        beforeInsert: () => {
          if (body.attachments?.length) {
            stored.push(...saveAttachments(chat.id, body.attachments, userId).stored);
          }
          const userMessage = {
            id: messageId,
            role: "user" as const,
            content: message || "Attached files",
            ...(stored.length ? { attachments: stored } : {}),
          };
          const appended = appendMessageInTransaction(chat.id, userMessage, userId);
          if (!appended) throw new Error("Chat disappeared while enqueueing message.");
        },
      });
    } catch (error) {
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
    return Response.json(
      {
        job,
        queueMessage: job.queueMessage,
      },
      { status: 202 },
    );
  } catch (error) {
    captureApiError("/api/runs POST", error, req, { chatId: body.chatId });
    return Response.json({ error: "Could not queue run" }, { status: 500 });
  }
}
