import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { resolveActionApproval } from "@/lib/remote-approval-flow";
import { getPendingApprovalForChat } from "@/lib/db-approvals";
import { queueUserInputResume, releaseUserInputWait } from "@/lib/db-jobs";
import { getChat, updateChat } from "@/lib/db-store";
import { isHostApprovalScope } from "@/lib/mcp-core/host-tool-approval.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS = new Set(["allow", "allow-session", "deny"]);

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    approvalId?: unknown;
    decision?: unknown;
    version?: unknown;
  };
  const approvalId =
    typeof body.approvalId === "string" ? body.approvalId.trim() : "";
  const decision =
    typeof body.decision === "string" && DECISIONS.has(body.decision)
      ? (body.decision as "allow" | "allow-session" | "deny")
      : "";
  const version =
    typeof body.version === "number" && Number.isFinite(body.version)
      ? Math.floor(body.version)
      : undefined;
  if (!approvalId || !decision) {
    return Response.json(
      { error: "Invalid approval decision" },
      { status: 400 },
    );
  }
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const resolved = resolveActionApproval(approvalId, decision, userId, version);
  if (!resolved) {
    return Response.json(
      { error: "Approval not found or already resolved" },
      { status: 404 },
    );
  }
  if (resolved.jobId) {
    queueUserInputResume({
      jobId: resolved.jobId,
      heartbeatAt: resolved.heartbeatAt,
      resumePrompt:
        resolved.decision === "deny"
          ? "The user denied the pending action. Continue without executing it."
          : `The user approved the pending action (${resolved.sessionScope || approvalId}). Retry that exact tool call now; its durable one-time approval is ready to be consumed.`,
    });
    releaseUserInputWait(resolved.jobId);
  }
  const currentChat = getChat(resolved.chatId, userId);
  if (currentChat?.pendingApproval?.id === approvalId) {
    const next = getPendingApprovalForChat(resolved.chatId, userId);
    updateChat(
      resolved.chatId,
      {
        runStatus: next ? "waiting_for_user" : "running",
        badge: next ? "red" : null,
        pendingApproval: next ? {
          id: next.approvalId, title: next.title, command: next.command,
          files: next.files, createdAt: next.createdAt,
          ...(isHostApprovalScope(next.sessionScope) ? {onceOnly: true} : {}),
        } : null,
        ...(resolved.decision === "allow-session" && resolved.sessionScope
          ? {
              approvedPatterns: [
                ...(currentChat.approvedPatterns || []),
                resolved.sessionScope,
              ].slice(-100),
            }
          : {}),
      },
      userId,
    );
  }
  return Response.json({
    ok: true,
    approvalId,
    jobId: resolved.jobId || undefined,
    chatId: resolved.chatId,
    decision: resolved.decision,
  });
}
