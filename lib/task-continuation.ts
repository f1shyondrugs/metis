import { appendRunEvent, cancelAgentJob, getJob, isJobLeaseActive, parkEndedUserInputWriter, updateJob } from "@/lib/db-jobs";
import { getChat, updateChat } from "@/lib/db-store";
import { getDatabase, transaction } from "@/lib/sqlite";
import { decideGoalContinuation } from "@/lib/goal-continuation";
import { providerContinuationPrompt } from "@/lib/provider-continuation";
import type { ChatMessage } from "@/lib/store";
import { isJobWaitingForUser } from "@/lib/user-input-resume";

export const MAX_RESEARCH_REPAIRS_WITHOUT_PROGRESS = 2;
export type ResearchContinuationRequest = {
  required: boolean;
  /** An explicit denial/cancellation ends this research task even with a Goal. */
  stopped?: boolean;
  prompt?: string;
  signature?: string;
  blockedReason?: string;
};

/**
 * A provider has fully returned before this is called. "switching" is a writer
 * retirement barrier, not a claim that the model changed: worker.ts queues it
 * only after the isolated process exits. No new provider can write concurrently.
 */
export function requestTaskContinuation(input: {
  jobId: string;
  assistantMessage: Pick<ChatMessage, "id" | "role" | "content" | "tools" | "parts">;
  outcome: "success" | "error" | "cancelled";
  checkpoint: () => void;
  agentId?: string;
  research?: ResearchContinuationRequest;
}): boolean {
  return transaction(() => {
    const current = getJob(input.jobId);
    if (input.outcome !== "success") return false;
    // A stop/input/model handoff can arrive while an async completion check is
    // reading evidence. Never fall through to the normal successful finalizer.
    if (!current) return true;
    if (current.status !== "running") {
      if (isJobWaitingForUser(current.status)) parkEndedUserInputWriter(current.id);
      return true;
    }
    const workerId = process.env.AI_CHAT_WORKER_ID?.trim();
    const leaseToken = process.env.AI_CHAT_JOB_LEASE_TOKEN?.trim();
    if ((workerId || leaseToken) && (!workerId || !leaseToken || !isJobLeaseActive(current.id, workerId, leaseToken))) return true;
    const chat = getChat(current.chatId, current.userId);
    if (!chat) return true;
    const waiting = getDatabase().prepare(
      "SELECT 1 FROM pending_questions WHERE job_id = ? AND status = 'waiting_for_user' UNION ALL SELECT 1 FROM pending_approvals WHERE job_id = ? AND status = 'waiting_for_user' LIMIT 1",
    ).get(current.id, current.id);
    if (waiting) {
      input.checkpoint();
      if (!updateChat(current.chatId, { runStatus: "waiting_for_user", runUpdatedAt: new Date().toISOString() }, current.userId)
        || !updateJob(current.id, { status: "waiting_input" }, { expectedRevision: current.revision ?? 0 })) {
        throw new Error("Task completion could not preserve its pending user input.");
      }
      parkEndedUserInputWriter(current.id);
      return true;
    }
    if (chat.pendingQuestion || chat.pendingApproval) return false;
    const deadline = current.agentRuntimeDeadlineAt ? Date.parse(current.agentRuntimeDeadlineAt) : undefined;
    if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= Date.now())) {
      input.checkpoint();
      cancelAgentJob(current.id, current.userId, "Agent runtime limit reached.", "runtime_limit");
      return true;
    }

    const finishIncomplete = (error: string, kind: "goal" | "research") => {
      input.checkpoint();
      const timestamp = new Date().toISOString();
      if (!updateChat(current.chatId, { runStatus: "error", runUpdatedAt: timestamp, queueMessage: null, badge: "red" }, current.userId)) {
        throw new Error("Task continuation lost its chat writer lease.");
      }
      appendRunEvent(current.id, current.chatId, current.userId, "error", { message: error, incomplete: true, continuationKind: kind });
      if (!updateJob(current.id, { status: "error", error }, { expectedRevision: current.revision ?? 0 })) {
        throw new Error("Task continuation lost its job revision.");
      }
      return true;
    };
    if (input.research?.blockedReason?.trim()) {
      return finishIncomplete("Deep Research remains incomplete: " + input.research.blockedReason.trim(), "research");
    }
    if (input.research?.stopped) return false;

    let kind: "goal" | "research";
    let prompt: string;
    let nextCount: number;
    let exhausted = false;
    if (input.research?.required) {
      if (!input.research.prompt?.trim()) return false;
      const previous = current.researchContinuationState;
      const count = previous?.signature === input.research.signature ? previous?.count ?? 0 : 0;
      exhausted = !Number.isInteger(count) || count < 0 || count >= MAX_RESEARCH_REPAIRS_WITHOUT_PROGRESS;
      kind = "research";
      nextCount = count + 1;
      prompt = input.research.prompt;
    } else {
      const decision = decideGoalContinuation({
        goal: chat.sessionState?.goal,
        currentAssistantMessageId: input.assistantMessage.id,
        messages: [input.assistantMessage],
        jobStatus: current.status,
        outcome: input.outcome,
        continuationCount: current.taskContinuationCount,
        runtimeDeadlineAt: current.agentRuntimeDeadlineAt,
      });
      if (!decision.shouldContinue && decision.reason !== "continuation_limit") return false;
      kind = "goal";
      exhausted = !decision.shouldContinue;
      nextCount = decision.shouldContinue ? decision.nextContinuationCount : current.taskContinuationCount ?? 0;
      prompt = decision.shouldContinue ? decision.prompt : "";
    }

    if (exhausted) {
      const error = kind === "research"
        ? "Deep Research remains incomplete after two continuations without new verified progress. The partial work is saved; no completed report was claimed."
        : "The Goal still has unfinished tasks after the bounded continuation attempts. The partial work and checklist are saved; the Goal was not completed.";
      return finishIncomplete(error, kind);
    }

    // Keep the partial artifact and its checklist durable before releasing the
    // writer lease. Every projection and the status transition share this txn.
    input.checkpoint();
    const timestamp = new Date().toISOString();
    if (!updateChat(current.chatId, {
      runStatus: "running", runUpdatedAt: timestamp, queueMessage: null, badge: null,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    }, current.userId)) throw new Error("Task continuation lost its chat writer lease.");
    appendRunEvent(current.id, current.chatId, current.userId, "status", {
      status: "running",
      message: kind === "research" ? "Continuing the approved Deep Research work…" : "Continuing unfinished Goal tasks…",
      continuationKind: kind, continuationAttempt: nextCount,
    });
    const updated = updateJob(current.id, {
      status: "switching",
      error: undefined,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      resumePrompt: providerContinuationPrompt(current, prompt),
      resumeRequestedAt: timestamp,
      ...(kind === "goal" ? { taskContinuationCount: nextCount } : {
        researchContinuationState: { count: nextCount, ...(input.research?.signature ? { signature: input.research.signature } : {}) },
      }),
    }, { expectedRevision: current.revision ?? 0 });
    if (!updated) throw new Error("Task continuation lost its job revision.");
    return true;
  });
}
