import { isHostApprovalScope } from "@/lib/mcp-core/host-tool-approval.mjs";
import { createApproval, expireApproval, getApproval, getPendingApprovalForChat, heartbeatApproval, resolveApproval } from "@/lib/db-approvals";
import { getJob, updateJob } from "@/lib/db-jobs";
import { transaction } from "@/lib/sqlite";
import type { ApprovalDecision } from "@/lib/runtime-mode";
import { getChat, updateChat } from "@/lib/db-store";
import {
  approveRemoteApproval, createRemoteApproval, denyRemoteApproval, findApprovedRemoteApproval,
  getRemoteApproval, getRemoteClient, remoteApprovalScope, type RemoteAction,
} from "@/lib/remote-clients";

type RemoteApprovalInput = {
  ownerId: string; clientId: string; action: RemoteAction;
  params?: Record<string, unknown>; runId?: string;
};

function runContext(input: RemoteApprovalInput) {
  const job = input.runId ? getJob(input.runId) : null;
  if (!job || job.userId !== input.ownerId) return null;
  const chat = getChat(job.chatId, input.ownerId);
  return chat ? { job, chat } : null;
}

/** Resolve both representations atomically; the card and the remote retry share one ID. */
export function resolveActionApproval(id: string, decision: ApprovalDecision, ownerId?: string, version?: number) {
  return transaction(() => {
    const remote = ownerId ? getRemoteApproval(id, ownerId) : null;
    if (remote && (remote.consumedAt || (remote.approvedAt && Date.parse(remote.expiresAt) <= Date.now()))) return null;
    const resolved = resolveApproval(id, decision, ownerId, version);
    if (!resolved) return null;
    if (remote) {
      if (decision === "deny") denyRemoteApproval(id, ownerId!);
      else if (!remote.approvedAt && !approveRemoteApproval(id, ownerId!)) {
        throw new Error("The remote approval could not be resolved.");
      }
    }
    return resolved;
  });
}

/** Recover an exact, durable grant when a paused tool is retried by its owning run. */
export function approvedRemoteActionId(input: RemoteApprovalInput): string | undefined {
  const context = runContext(input);
  if (!context) return undefined;
  const approved = findApprovedRemoteApproval({ ...input, runId: context.job.id });
  if (approved) return approved;
  const scope = remoteApprovalScope(input.clientId, input.action, input.params);
  if (!context.chat.approvedPatterns?.includes(scope)) return undefined;
  const grant = createRemoteApproval(input);
  if (!approveRemoteApproval(grant.id, input.ownerId)) return undefined;
  return grant.id;
}

/** Publish remote and chat approvals under the same server-generated ID. */
export function publishRemoteApproval(input: RemoteApprovalInput, approvalId: string) {
  const context = runContext(input);
  if (!context) return false;
  if (context.job.automationId || context.chat.automationId) {
    denyRemoteApproval(approvalId, input.ownerId);
    throw new Error("This device requires interactive approval and is unavailable during an automation run.");
  }
  if (!["running", "waiting_input", "waiting_for_user"].includes(context.job.status)) {
    throw new Error("The run is no longer active.");
  }
  const remote = getRemoteApproval(approvalId, input.ownerId);
  if (!remote || remote.runId !== context.job.id) throw new Error("Remote approval does not belong to this run.");
  const client = getRemoteClient(input.clientId, input.ownerId);
  const title = `${client?.name || "Remote device"} · ${input.action} approval required`;
  const command = typeof input.params?.command === "string"
    ? input.params.command : JSON.stringify(input.params || {});
  const files = typeof input.params?.path === "string"
    ? [{ path: input.params.path, status: "pending" }] : undefined;
  createApproval({
    approvalId, jobId: context.job.id, chatId: context.chat.id, ownerId: input.ownerId,
    title, command, files,
    sessionScope: remoteApprovalScope(input.clientId, input.action, input.params),
  });
  updateJob(context.job.id, { status: "waiting_input" });
  updateChat(context.chat.id, {
    runStatus: "waiting_for_user", badge: "red",
    pendingApproval: { id: approvalId, title, command, files, createdAt: remote.createdAt },
  }, input.ownerId);
  return true;
}

/** Keep the original internal tool call alive while the visible card awaits a decision. */
export async function waitForRemoteApproval(
  input: RemoteApprovalInput, approvalId: string, signal?: AbortSignal,
) {
  const context = runContext(input);
  const initial = getApproval(approvalId, input.ownerId);
  if (!context || initial?.jobId !== context.job.id) return false;
  for (;;) {
    // A disconnected waiter leaves the durable card available for a later resume.
    signal?.throwIfAborted();
    const job = getJob(context.job.id);
    if (!job || !["running", "waiting_input", "waiting_for_user"].includes(job.status)) {
      throw new Error("The run was cancelled or is no longer active.");
    }
    const approval = getApproval(approvalId, input.ownerId);
    const remote = getRemoteApproval(approvalId, input.ownerId);
    if (!approval || !remote) throw new Error("Approval request no longer exists.");
    if (approval.status === "resolved") {
      if (approval.decision === "deny") {
        denyRemoteApproval(approvalId, input.ownerId);
        releaseRemoteApproval(input, approvalId);
        throw new Error("User denied this remote action.");
      }
      if (!remote.approvedAt && !approveRemoteApproval(approvalId, input.ownerId)) {
        throw new Error("The remote approval expired.");
      }
      releaseRemoteApproval(input, approvalId);
      return true;
    }
    if (remote.consumedAt) {
      expireApproval(approvalId, input.ownerId, "The remote approval was denied.");
      releaseRemoteApproval(input, approvalId);
      throw new Error("The remote approval was denied.");
    }
    heartbeatApproval(approvalId);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason || new Error("Request aborted.")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 250);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

function releaseRemoteApproval(input: RemoteApprovalInput, approvalId: string) {
  const context = runContext(input);
  if (!context) return;
  const next = getPendingApprovalForChat(context.chat.id, input.ownerId);
  if (!next && context.job.status === "waiting_input") updateJob(context.job.id, { status: "running" });
  if (context.chat.pendingApproval?.id === approvalId || !context.chat.pendingApproval) {
    updateChat(context.chat.id, {
      pendingApproval: next ? {
        id: next.approvalId, title: next.title, command: next.command,
        files: next.files, createdAt: next.createdAt,
        ...(isHostApprovalScope(next.sessionScope) ? {onceOnly: true} : {}),
      } : null,
      runStatus: next ? "waiting_for_user" : "running",
      badge: next ? "red" : null,
    }, input.ownerId);
  }
}
