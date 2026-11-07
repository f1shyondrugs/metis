import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getPendingQuestion, resolveQuestion, cancelQuestionAsResponse } from "@/lib/db-questions";
import { queueUserInputResume, releaseUserInputWait } from "@/lib/db-jobs";
import { appendMessage, getChat, updateChat } from "@/lib/db-store";

import { normalizeQuestionAnswers, questionAnswerDisplay, QuestionValidationError } from "@/lib/question-contract";
import { questionAnswerAnchor } from "@/lib/question-transcript";
import { userInputProgress } from "@/lib/user-input-progress";
import { transaction } from "@/lib/sqlite";
import { browserLoginRequest, browserLoginSameOrigin } from "@/lib/browser-login-client";
import { requiresProtectedCredentials } from "@/lib/mcp-core/credential-question-policy.mjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { questionId?: unknown; answers?: unknown; values?: unknown; version?: unknown; cancelled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const version = typeof body.version === "number" && Number.isInteger(body.version) ? body.version : undefined;
  if (!questionId) return Response.json({ error: "Invalid question ID" }, { status: 400 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const pending = getPendingQuestion(questionId, userId);
  if (!pending) return Response.json({ error: "Question not found" }, { status: 404 });
  if (body.cancelled !== undefined && typeof body.cancelled !== "boolean") return Response.json({ error: "Invalid cancellation" }, { status: 400 });
  const cancelled = body.cancelled === true;
  if (pending.status !== "waiting_for_user" && !(cancelled ? pending.cancelled : pending.status === "answered")) {
    return Response.json({ error: "This form is no longer available. Refresh the chat." }, { status: 409 });
  }
  if (!cancelled && !pending.secureBrowserInput && requiresProtectedCredentials(pending)) {
    return Response.json({error:"Enter credentials only in the protected login form. Start the login again.",code:"secure_credentials_required"},{status:409});
  }
  let input = body.values ?? body.answers;
  const secure=pending.secureBrowserInput;
  if(!cancelled && secure && pending.status!=="answered") {
    if(!req.headers.get("cookie") || !browserLoginSameOrigin(req))return Response.json({error:"Forbidden"},{status:403});
    try {
      const status=await browserLoginRequest(userId!,pending.chatId,secure.kind==="console"?"console_status":"status",{requestId:secure.requestId},true);
      if(!status.filled)throw Error();
      const label=secure.kind==="console"?"Password":"Credentials";
      input={secure_login:status.scope==="permanent"?`${label} entered securely and saved permanently.`:`${label} entered securely and saved for this chat only.`};
    }catch{return Response.json({error:"Enter credentials in the protected form first."},{status:409});}
    // Never persist client-supplied values for secure input, even if a client
    // accidentally posts a password to this ordinary transcript endpoint.
  }
  if (!cancelled && pending.status !== "answered") {
    try { input = normalizeQuestionAnswers(pending.questions, input).values; }
    catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid answers", fieldErrors: error instanceof QuestionValidationError ? error.fieldErrors : {} }, { status: 400 });
    }
  }
  return transaction(() => {
    const firstAnswer = getPendingQuestion(questionId, userId)?.status === "waiting_for_user";
    const beforeChat = getChat(pending.chatId, userId);
    const progress = userInputProgress(beforeChat?.messages ?? []);
    const resolved = cancelled ? cancelQuestionAsResponse(questionId, userId, version) : resolveQuestion(questionId, input, userId, version);
    if (!resolved) return Response.json({ error: "This form is no longer available. Refresh the chat." }, { status: 409 });
    const answerId = `question-answer-${questionId}`;
    const chat = getChat(resolved.chatId, userId);
    if (resolved.summary && !chat?.messages.some(message => message.id === answerId)) {
      appendMessage(resolved.chatId, {
        id: answerId, role: "user", content: resolved.summary,
        questionAnswer: {
          questionId,
          ...questionAnswerAnchor(chat?.messages ?? [], questionId, { cursorFallback: true }),
          ...(!resolved.cancelled && resolved.values ? { display: questionAnswerDisplay(pending.questions, resolved.values, resolved.summary) } : {}),
        },
      }, userId);
    }
    const answerMessage = getChat(resolved.chatId, userId)?.messages.find(message => message.id === answerId);
    if (resolved.jobId && firstAnswer) {
      queueUserInputResume({
        jobId: resolved.jobId,
        heartbeatAt: resolved.heartbeatAt,
        questionId,
        progress,
        resumePrompt: resolved.cancelled ? "The user cancelled the pending question (User cancelled). Acknowledge the cancellation. Do not infer answers, approval, or permission; stop work that depends on the cancelled input." : `The user answered the pending question with: ${JSON.stringify({ values: resolved.values, answers: resolved.answers, summary: resolved.summary })}`,
      });
      releaseUserInputWait(resolved.jobId);
    }
    // Release the durable UI state immediately. The MCP request will observe
    // the answer independently and continue the agent run.
    const currentChat = getChat(resolved.chatId, userId);
    if (currentChat?.pendingQuestion?.questionId === questionId) {
      updateChat(
        resolved.chatId,
        { runStatus: "running", pendingQuestion: null, badge: null },
        userId,
      );
    }
    return Response.json({
      ok: true,
      questionId,
      jobId: resolved.jobId,
      runId: resolved.runId,
      version: resolved.version,
      status: resolved.status,
      cancelled: resolved.cancelled,
      values: resolved.values,
      summary: resolved.summary,
      message: answerMessage,
    });
  });
}
