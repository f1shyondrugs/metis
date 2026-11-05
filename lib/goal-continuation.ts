import { currentChatTodos, type ChatTodo } from "@/lib/chat-todos";
import type { JobStatus } from "@/lib/jobs";
import { isJobWaitingForUser } from "@/lib/user-input-resume";

/** A logical run may repair a premature successful exit, never retry indefinitely. */
export const MAX_GOAL_CONTINUATIONS = 2;

export type GoalContinuationInput = {
  goal?: string | null;
  currentAssistantMessageId: string;
  messages: Parameters<typeof currentChatTodos>[0];
  jobStatus: JobStatus | undefined;
  outcome: "success" | "error" | "cancelled";
  continuationCount?: number;
  pendingQuestion?: unknown;
  pendingApproval?: unknown;
  /** An explicit, durable blocker supplied by the caller, never inferred from answer wording. */
  blockedReason?: string;
  /** Preserve the original run's deadline when requeuing. Omit only for unlimited/unmanaged runs. */
  runtimeDeadlineAt?: string;
  now?: number;
};

export type GoalContinuationReason =
  | "no_goal" | "not_running" | "waiting_for_user" | "blocked"
  | "error" | "runtime_limit" | "continuation_limit"
  | "no_current_tasks" | "complete" | "unfinished_tasks";

export type GoalContinuationDecision =
  | { shouldContinue: false; reason: Exclude<GoalContinuationReason, "unfinished_tasks"> }
  | { shouldContinue: true; reason: "unfinished_tasks"; nextContinuationCount: number; remaining: ChatTodo[]; prompt: string };

/**
 * Only a successful exit with confirmed unfinished work from THIS attempt is
 * eligible. Historic task lists and natural-language guesses are not evidence
 * that a newly requested task should be resumed.
 */
export function decideGoalContinuation(input: GoalContinuationInput): GoalContinuationDecision {
  if (!input.goal?.trim()) return { shouldContinue: false, reason: "no_goal" };
  if (input.outcome === "error") return { shouldContinue: false, reason: "error" };
  if (input.outcome === "cancelled" || input.jobStatus !== "running") {
    return { shouldContinue: false, reason: isJobWaitingForUser(input.jobStatus) ? "waiting_for_user" : "not_running" };
  }
  if (input.pendingQuestion || input.pendingApproval) return { shouldContinue: false, reason: "waiting_for_user" };
  if (input.blockedReason?.trim()) return { shouldContinue: false, reason: "blocked" };
  if (input.runtimeDeadlineAt) {
    const deadline = Date.parse(input.runtimeDeadlineAt);
    if (!Number.isFinite(deadline) || deadline <= (input.now ?? Date.now())) {
      return { shouldContinue: false, reason: "runtime_limit" };
    }
  }
  const tasks = currentChatTodos(input.messages);
  if (!tasks || tasks.messageId !== input.currentAssistantMessageId) {
    return { shouldContinue: false, reason: "no_current_tasks" };
  }
  const remaining = tasks.items.filter(todo =>
    !/^(?:completed|complete|success|succeeded|done|cancelled|canceled|skipped|blocked)$/i.test(todo.status?.trim() || "")
  );
  if (!remaining.length) return {
    shouldContinue: false,
    reason: tasks.items.some(todo => todo.status?.trim().toLowerCase() === "blocked") ? "blocked" : "complete",
  };
  const count = input.continuationCount ?? 0;
  if (!Number.isInteger(count) || count < 0 || count >= MAX_GOAL_CONTINUATIONS) {
    return { shouldContinue: false, reason: "continuation_limit" };
  }
  const list = remaining.slice(0, 20).map((todo, index) => `${index + 1}. ${todo.content.slice(0, 500)}`).join("\n");
  return {
    shouldContinue: true,
    reason: "unfinished_tasks",
    nextContinuationCount: count + 1,
    remaining,
    prompt: [
      "Continue the same authorized Goal task from the saved state. The provider ended while the current confirmed checklist still contains unfinished work.",
      `Current goal: ${input.goal.trim().slice(0, 4000)}`,
      `Unfinished tasks:\n${list}`,
      remaining.length > 20 ? `There are ${remaining.length - 20} further unfinished items in the existing checklist; retain that checklist.` : "",
      "Complete and verify the remaining actionable work. Reuse existing artifacts and the current checklist; do not repeat completed side effects. Respect the latest user scope, current mode, pending approvals, stop requests and original runtime deadline. If a real blocker prevents progress, preserve it and report the blocker instead of claiming success.",
    ].filter(Boolean).join("\n\n"),
  };
}
