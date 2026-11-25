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
import { RUNTIME_MODES, RUNTIME_MODE_DETAILS } from "@/lib/mcp-core/runtime-permissions.mjs";
import { runtimeModeForChat, type RuntimeMode } from "@/lib/runtime-mode";
import {prepareMcpInput} from "@/lib/mcp-protected-input";
import {parseProtectedLoginReply,type ProtectedLoginReply} from "@/lib/protected-login-contract";
import {browserLoginRequest} from "@/lib/browser-login-client";
import {consoleVaultDescription,prepareProtectedConsole} from "@/lib/protected-console-login";
import { protectedLoginFailure } from "@/lib/protected-login-errors";
import { assertOrdinaryQuestionSafe, CredentialQuestionError } from "@/lib/mcp-core/credential-question-policy.mjs";

import { getHostToolPolicy } from "@/lib/host-tool-policy-store";

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
  let runtimeModeChange: { previous: RuntimeMode; target: RuntimeMode } | undefined;
  let secureBrowserInput: {requestId:string;origin:string;expiresAt:string;kind?:"console"|"mcp";envFields?:string[];sessionId?:string;fields?:Array<"password"|"username"|"email">}|undefined;
  try {
    const raw=await req.json();
    if (raw.runtimeModeChange) {
      // Generic ask_user arguments must not tunnel around a disabled control tool.
      if (req.headers.get("x-ai-chat-control-tool") !== "request_runtime_mode_change") return Response.json({ error: "Use the runtime permission control tool." }, { status: 403 });
      const job = getJob(jobId);
      if (automation || job?.automationId || job?.parentJobId || job?.projectHandoffId) return Response.json({ error: "Runtime permission changes require the interactive parent chat." }, { status: 403 });
      const change = z.object({ runtimeModeChange: z.object({ runtimeMode: z.enum(RUNTIME_MODES), reason: z.string().max(1000).optional() }).strict() }).strict().parse(raw).runtimeModeChange;
      const previous = runtimeModeForChat(chat);
      if (previous === change.runtimeMode) return Response.json({ switched: false, runtimeMode: previous, reason: "already_active" });
      runtimeModeChange = { previous, target: change.runtimeMode };
      const current = RUNTIME_MODE_DETAILS[previous];
      const target = RUNTIME_MODE_DETAILS[change.runtimeMode];
      input = normalizeAskUserInput({
        title: "Change runtime permissions",
        description: `Current: ${current.label}.\nRequested: ${target.label}. ${target.description}${change.reason ? "\nReason: " + change.reason : ""}\nThis changes this chat only, not Agent/Plan/Ask, account or Remote Device restrictions.`,
        submitLabel: "Submit decision",
        questions: [{
          key: "decision", type: "radio", question: `Switch to ${target.label}?`, required: true, icon: "shield",
          options: [{ label: `Accept ${target.label}`, value: "approve" }, { label: "Keep current permissions", value: "deny" }],
        }],
      });
    } else if(raw.mcpInput){
      if(automation)return Response.json({error:"MCP credential changes require interactive protected input."},{status:403});
      secureBrowserInput=await prepareMcpInput(userId!,chatId,jobId,raw.mcpInput);
      input=normalizeAskUserInput({title:"Configure MCP credentials securely",description:`Connection: ${secureBrowserInput.origin}`,questions:[{key:"secure_login",type:"text",question:"Protected MCP input",required:false}],responseTemplate:"MCP credentials configured securely."});
    }else if(raw.consoleLogin){
      const consoleInput=z.object({consoleLogin:z.object({action:z.enum(["connect","authenticate","request_password"]),method:z.enum(["ssh","sudo","su"]).optional(),user:z.string().regex(/^[a-z_][a-z0-9_.-]{0,63}$/).optional(),host:z.string().max(253).optional(),port:z.number().int().min(1).max(65535).optional(),replace:z.boolean().optional(),credential_id:z.string().uuid().optional()}).strict()}).strict().parse(raw).consoleLogin;
      if(consoleInput.action!=="request_password"&&(!consoleInput.method||!consoleInput.user))throw Error("Account and method required");
      const {credential_id:credentialId,...consoleArgs}=consoleInput;
      if(credentialId&&(consoleArgs.action!=="connect"||consoleArgs.replace))throw Error("Use a named entry only for protected console reuse");
      const prepared=await prepareProtectedConsole(userId!,chatId,{...consoleArgs,...(credentialId?{credentialId}:{})});
      if(prepared.status!=="input_required"||!prepared.secureInput)return Response.json(prepared);
      if(automation)return Response.json({status:"input_required",vaultStatus:prepared.vaultStatus,error:"This console requires interactive protected input."},{status:403});
      secureBrowserInput=prepared.secureInput;
      input=normalizeAskUserInput({title:"Enter console password securely",description:`${secureBrowserInput.origin}\n${consoleVaultDescription(prepared.vaultStatus)}`,questions:[{key:"secure_login",type:"text",question:"Protected login",required:false}],responseTemplate:"Password entered securely in the console."});
    }else if(raw.browserLogin) {
      const login=z.object({browserLogin:z.object({tabId:z.string().max(200).optional(),selector:z.string().max(500).optional(),usernameSelector:z.string().max(500).optional(),emailSelector:z.string().max(500).optional(),fields:z.array(z.enum(["password","username","email"])).min(1).max(3).optional(),replace:z.boolean().optional(),credentialId:z.string().uuid().optional()}).strict()}).strict().parse(raw).browserLogin;
      if(login.credentialId&&login.replace)throw Error("Use a named entry only for protected login reuse");
      let prepared: ProtectedLoginReply;
      try {
        prepared=parseProtectedLoginReply(await performSharedBrowserAction(userId!,chatId,{action:login.credentialId?"secure_input_prepare_named":"secure_input_prepare",...login,source:"agent",includeScreenshot:false}));
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
  if (runtimeModeChange) {
    const latest = getChat(chatId, userId);
    if (!latest) return Response.json({ error: "Chat not found" }, { status: 404 });
    const current = runtimeModeForChat(latest);
    // Only the exact typed answer to this server-built form can authorize the
    // captured target. Custom prose, cancellation and stale forms never elevate.
    if (resolved.cancelled || resolved.status !== "answered" || resolved.values?.decision !== "approve") {
      return Response.json({ questionId: pending.questionId, switched: false, runtimeMode: current, cancelled: Boolean(resolved.cancelled), reason: "not_approved" });
    }
    if (current !== runtimeModeChange.previous) return Response.json({ questionId: pending.questionId, switched: false, runtimeMode: current, reason: "permissions_changed_while_waiting" });
    const updated = updateChat(chatId, { runtimeMode: runtimeModeChange.target }, userId);
    if (!updated) return Response.json({ error: "Chat not found" }, { status: 404 });
    appendRunEvent(jobId, chatId, userId, "runtime_mode_changed", { runtimeMode: runtimeModeChange.target, previousRuntimeMode: current, questionId: pending.questionId });
    return Response.json({ questionId: pending.questionId, switched: true, runtimeMode: runtimeModeChange.target, previousRuntimeMode: current, currentRun: true, instruction: "Continue the original task using Metis tools. The gateway applies the confirmed permission level now; native provider sandbox settings refresh on the next run. Other security policies remain in force." });
  }
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
    const chat = getChat(chatId, userId);
    if (!chat || !internalRunContextAuthorized(req, jobId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const hostToolPolicy = getHostToolPolicy();
    const upgraded = req.headers.get("X-Metis-Tool-Policy") === "1";
    // A mixed-version gateway must not silently ignore non-default enforcement.
    if (!upgraded && Object.values(hostToolPolicy.rules).some(rule => rule !== "inherit")) {
      return Response.json({error: "This gateway does not support the configured host tool policy."}, {status: 409});
    }
    return Response.json({ waitingForUser: false, runtimeMode: runtimeModeForChat(chat),
      ...(upgraded ? {hostToolPolicy} : {}),
    }, {headers: {"Cache-Control":"private, no-store"}});
  } catch {
    return Response.json({ error: "The run is waiting for an answer or has been stopped." }, { status: req.signal.aborted ? 499 : 409 });
  }
}
