import { appendRunEvent, getJob, touchJob, updateJob } from "@/lib/db-jobs";
import { appendMessage, updateChat } from "@/lib/db-store";
import type { AgentJob } from "@/lib/jobs";
import { transaction } from "@/lib/sqlite";

/** Publish the visible failure before the terminal job write releases its lease. */
export function markWorkerJobError(job: AgentJob, message: string) {
  return transaction(() => {
    const current = getJob(job.id);
    if (!current || current.status !== "running" || current.chatId !== job.chatId || current.userId !== job.userId || !touchJob(job.id)) return null;
    const chat = updateChat(job.chatId, {
      runStatus: "error",
      runUpdatedAt: new Date().toISOString(),
      queueMessage: null,
      badge: "red",
    }, job.userId, { metadataProjection: true });
    if (chat) appendMessage(job.chatId, {
      id: `worker-error:${job.id}:${current.attempts}`,
      role: "assistant", content: "", errorMessage: message,
    }, job.userId);
    appendRunEvent(job.id, job.chatId, job.userId, "error", { message });
    const failed = updateJob(job.id, { status: "error", error: message });
    if (!failed) throw new Error("Could not commit the worker failure.");
    return failed;
  });
}

/**
 * Called by the supervising worker after it has committed the failed job.
 * The child may no longer hold a writer lease. Never deduplicate against
 * unrelated messages: the same failure can recur in a later run.
 */
export function persistWorkerFailureMessage(jobId: string, message: string) {
  return transaction(() => {
    const job = getJob(jobId);
    if (!job || job.status !== "error") return null;
    return appendMessage(job.chatId, {
      id: `worker-error:${job.id}:${job.attempts}`,
      role: "assistant",
      content: "",
      errorMessage: message,
    }, job.userId);
  });
}
