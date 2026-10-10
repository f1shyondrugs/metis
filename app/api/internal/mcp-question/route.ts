import { waitForJobUserInput } from "@/lib/user-question-wait";
import { appendRunEvent, getJob, updateJob } from "@/lib/db-jobs";
import { internalRunLeaseAuthorized } from "@/lib/internal-run-lease";
import {
  createPendingQuestion,
  getPendingQuestion,
} from "@/lib/db-questions";
import { canTransitionRunStatus, getChat, updateChat } from "@/lib/db-store";
import { normalizeAskUserInput, QuestionValidationError, type AskUserInput } from "@/lib/question-contract";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (req.headers.get("x-ai-chat-automation") === "1") {
    return Response.json({ error: "User questions are unavailable during automation runs." }, { status: 403 });
  }
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });
  if (!internalRunLeaseAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let input: AskUserInput;
  try { input = normalizeAskUserInput(await req.json()); }
  catch (error) {
    return Response.json({ error: error instanceof QuestionValidationError ? error.message : "Invalid form" }, { status: 400 });
  }
  const pending = createPendingQuestion(input, chatId, userId, { jobId, runId: jobId });
  const { questions: _questions, ...form } = input;
  void _questions;
  updateJob(jobId, { status: "waiting_input", runId: jobId });
  updateChat(chatId, {
    runStatus: "waiting_for_user",
    pendingQuestion: {
      ...form,
      questionId: pending.questionId,
      jobId,
      runId: jobId,
      version: pending.version,
      status: "waiting_for_user",
      questions: pending.questions,
    },
  }, userId);
  appendRunEvent(jobId, chatId, userId, "question", {
    ...form,
    questionId: pending.questionId,
    jobId,
    runId: jobId,
    version: pending.version,
    questions: pending.questions,
  });

  let removeAbortListener = () => {};
  const aborted = new Promise<{ type: "aborted" }>((resolve) => {
    const onAbort = () => resolve({ type: "aborted" });
    if (req.signal.aborted) {
      onAbort();
      return;
    }
    req.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => req.signal.removeEventListener("abort", onAbort);
  });
  const outcome = await Promise.race([
    pending.promise.then((answers) => ({ type: "answered" as const, answers })),
    aborted,
  ]);
  removeAbortListener();
  if (outcome.type === "aborted") {
    pending.stop();
    return new Response(null, { status: 499 });
  }
  const answers = outcome.answers;
  const resolved = getPendingQuestion(pending.questionId, userId);
  if (!resolved || resolved.status !== "answered") {
    const nextJobStatus = resolved?.status === "cancelled" ? "cancelled" : "interrupted";
    const currentJob = getJob(jobId);
    if (currentJob && ["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(currentJob.status)) {
      updateJob(jobId, {
        status: nextJobStatus,
        error: resolved?.status === "expired" ? "The question expired before it was answered." : "The question was cancelled.",
      });
    }
    const currentChat = getChat(chatId, userId);
    if (
      currentChat?.pendingQuestion?.questionId === pending.questionId &&
      canTransitionRunStatus(currentChat.runStatus || "idle", nextJobStatus)
    ) {
      updateChat(chatId, { runStatus: nextJobStatus, pendingQuestion: null }, userId);
    }
    appendRunEvent(jobId, chatId, userId, "status", { status: resolved?.status || "interrupted", questionId: pending.questionId });
    throw new Error(resolved?.status === "expired" ? "The user question expired." : "The user question was cancelled.");
  }
  updateJob(jobId, { status: "running" });
  updateChat(chatId, { runStatus: "running", pendingQuestion: null }, userId);
  return Response.json({ questionId: pending.questionId, answers, values: resolved.values, summary: resolved.summary });
}

// Other MCP calls use this gate before executing, including after a disconnect.
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const job = getJob(jobId);
  if (!job || job.userId !== userId || job.chatId !== chatId || !internalRunLeaseAuthorized(req, jobId)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await waitForJobUserInput(jobId, userId, req.signal);
    return Response.json({ waitingForUser: false });
  } catch {
    return Response.json({ error: "The run is waiting for an answer or has been stopped." }, { status: req.signal.aborted ? 499 : 409 });
  }
}
