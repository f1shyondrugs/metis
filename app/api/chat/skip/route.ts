import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { appendRunEvent, requestJobCancel, updateJob } from "@/lib/db-jobs";
import { resolveApproval } from "@/lib/db-approvals";
import { POST as respondToQuestion } from "@/app/api/chat/answer/route";
import { getChat, updateChat } from "@/lib/db-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { chatId?: string };
  const chatId = body.chatId?.trim();
  if (!chatId) return Response.json({ error: "chatId is required" }, { status: 400 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const chat = getChat(chatId, userId);
  if (chat?.pendingApproval?.id) {
    const denied = resolveApproval(chat.pendingApproval.id, "deny", userId);
    if (denied) {
      updateChat(chatId, { runStatus: "cancelled", pendingApproval: null, badge: null }, userId);
      if (denied.jobId) {
        updateJob(denied.jobId, { status: "cancelled", error: "Approval denied by user." });
        appendRunEvent(denied.jobId, chatId, userId, "status", { status: "cancelled", approvalId: chat.pendingApproval.id });
      }
      return Response.json({ ok: true, status: "cancelled" });
    }
  }
  if (chat?.pendingQuestion?.questionId) {
    return respondToQuestion(new Request(req.url, { method: "POST", headers: req.headers,
      body: JSON.stringify({ questionId: chat.pendingQuestion.questionId, version: chat.pendingQuestion.version, cancelled: true }),
    }));
  }
  const active = requestJobCancel(chatId, userId);
  if (!active) return Response.json({ error: "No active run" }, { status: 404 });
  return Response.json({ ok: true, status: "cancel-requested" });
}
