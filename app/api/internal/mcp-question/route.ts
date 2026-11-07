import { waitForJobUserInput } from "@/lib/user-question-wait";
import { appendRunEvent, getJob, updateJob } from "@/lib/db-jobs";
import { internalRunContextAuthorized } from "@/lib/internal-run-lease";
import {
  createPendingQuestion,
  getPendingQuestion,
} from "@/lib/db-questions";
import { canTransitionRunStatus, getChat, updateChat } from "@/lib/db-store";
import { normalizeAskUserInput, QuestionValidationError, type AskUserInput } from "@/lib/question-contract";
import { bearerTokenMatches } from "@/lib/security";
import { performSharedBrowserAction } from "@/lib/shared-browser-client";
import { z } from "zod";
import {parseProtectedLoginReply,type ProtectedLoginReply} from "@/lib/protected-login-contract";
import {browserLoginRequest} from "@/lib/browser-login-client";
import { protectedLoginFailure } from "@/lib/protected-login-errors";
import { assertOrdinaryQuestionSafe, CredentialQuestionError } from "@/lib/mcp-core/credential-question-policy.mjs";

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
  if (!jobId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!internalRunContextAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const automation=req.headers.get("x-ai-chat-automation") === "1";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });

  let input: AskUserInput;
  let secureBrowserInput: {requestId:string;origin:string;expiresAt:string;kind?:"console";sessionId?:string;fields?:Array<"password"|"username"|"email">}|undefined;
  try {
    const raw=await req.json();
    if(raw.consoleLogin){
      const consoleInput=z.object({consoleLogin:z.object({action:z.enum(["connect","authenticate","request_password"]),method:z.enum(["ssh","sudo","su"]).optional(),user:z.string().regex(/^[a-z_][a-z0-9_.-]{0,63}$/).optional(),host:z.string().max(253).optional(),port:z.number().int().min(1).max(65535).optional(),replace:z.boolean().optional()}).strict()}).strict().parse(raw).consoleLogin;
      if(consoleInput.action!=="request_password"&&(!consoleInput.method||!consoleInput.user))throw Error("Account and method required");
      const prepared=await browserLoginRequest(userId!,chatId,consoleInput.action==="authenticate"?"console_elevate":"console_prepare",{...consoleInput,replaceSession:consoleInput.action==="connect"});
      if(prepared.status!=="input_required")return Response.json(prepared);
      if(automation)return Response.json({error:"This console requires an interactive password confirmation."},{status:403});
      secureBrowserInput=prepared.secureInput;
      input=normalizeAskUserInput({title:"Enter console password securely",description:secureBrowserInput?.origin,questions:[{key:"secure_login",type:"text",question:"Protected login",required:false}],responseTemplate:"Password entered securely in the console."});
    }else if(raw.browserLogin) {
      const login=z.object({browserLogin:z.object({tabId:z.string().max(200).optional(),selector:z.string().max(500).optional(),usernameSelector:z.string().max(500).optional(),emailSelector:z.string().max(500).optional(),fields:z.array(z.enum(["password","username","email"])).min(1).max(3).optional(),replace:z.boolean().optional()}).strict()}).strict().parse(raw).browserLogin;
      let prepared: ProtectedLoginReply;
      try {
        prepared=parseProtectedLoginReply(await performSharedBrowserAction(userId!,chatId,{action:"secure_input_prepare",...login,source:"agent",includeScreenshot:false}));
      } catch (error) {
        return Response.json(protectedLoginFailure(error), { status: 502 });
      }
      if(prepared.status==="filled_saved")return Response.json({status:"password_filled_from_saved_login",origin:prepared.origin});
      if(prepared.status==="protected_browser_ready")return Response.json(prepared);
      if(automation)return Response.json({error:"A saved website login is required. Request its secure password dialog in an interactive chat first."},{status:403});
      secureBrowserInput=prepared.secureInput;
      if(!secureBrowserInput)return Response.json(protectedLoginFailure(undefined), { status: 502 });
      input=normalizeAskUserInput({title:secureBrowserInput.fields&&!secureBrowserInput.fields.includes("password")?"Enter credentials securely":"Enter password securely",description:`Website: ${secureBrowserInput.origin}`,questions:[{key:"secure_login",type:"text",question:"Protected login",required:false}],responseTemplate:"Credentials entered securely."});
    }else {
      if(automation)return Response.json({error:"User questions are unavailable during automation runs."},{status:403});
      assertOrdinaryQuestionSafe(raw);
      input=normalizeAskUserInput(raw);
    }
  }
  catch (error) {
    if (error instanceof CredentialQuestionError) return Response.json({ error: error.message, code: error.code }, { status: 400 });
    return Response.json({ error: error instanceof QuestionValidationError ? error.message : "Invalid form" }, { status: 400 });
  }
  const pending = createPendingQuestion(input, chatId, userId, { jobId, runId: jobId, secureBrowserInput });
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
      ...(secureBrowserInput?{secureBrowserInput}:{}),
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
    ...(secureBrowserInput?{secureBrowserInput}:{}),
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
  if (!resolved || resolved.status !== "answered" && !resolved.cancelled) {
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
  // A concurrent Stop or expired lease always wins over a late form response.
  if (!internalRunContextAuthorized(req, jobId)) return new Response(null, { status: 499 });
  updateJob(jobId, { status: "running" });
  updateChat(chatId, { runStatus: "running", pendingQuestion: null }, userId);
  return Response.json({ questionId: pending.questionId, answers, values: resolved.values, summary: resolved.summary, ...(resolved.cancelled ? { status: "cancelled", cancelled: true } : {}) });
}

// Other MCP calls use this gate before executing, including after a disconnect.
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const job = getJob(jobId);
  if (!job || job.userId !== userId || job.chatId !== chatId || !internalRunContextAuthorized(req, jobId)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await waitForJobUserInput(jobId, userId, req.signal);
    return Response.json({ waitingForUser: false });
  } catch {
    return Response.json({ error: "The run is waiting for an answer or has been stopped." }, { status: req.signal.aborted ? 499 : 409 });
  }
}
