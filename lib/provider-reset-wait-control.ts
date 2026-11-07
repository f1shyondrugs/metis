import { appendRunEvent, cancelAgentJob, getActiveParentJob, getJob, updateJob } from "./db-jobs";
import { updateChat } from "./db-store";
import { providerContinuationPrompt } from "./provider-continuation";
import { providerResetWaitFromJob } from "./provider-reset-wait";
import { transaction } from "./sqlite";

/** Controls only the exact owner's waiting run and wait cycle the UI displayed. */
export function controlProviderResetWait(input: {
  chatId: string; userId: string; jobId: string; detectedAt: string; action: "wake" | "cancel";
}) {
  return transaction(() => {
    const job = getJob(input.jobId);
    if (!job || job.chatId !== input.chatId || job.userId !== input.userId ||
        job.providerRateLimit?.detectedAt !== input.detectedAt) return null;
    if (input.action === "cancel" && job.status === "cancelled") return job;
    if (!providerResetWaitFromJob(job) || getActiveParentJob(input.chatId, input.userId)?.id !== job.id) return null;
    if (input.action === "cancel") return cancelAgentJob(job.id, input.userId, "Automatic resume cancelled by user.");

    // Release the scheduled wait without claiming that the provider reset early.
    // Preserve the same remaining runtime budget, as a model switch during a wait does.
    const now = Date.now();
    const deadline = Date.parse(job.agentRuntimeDeadlineAt || "");
    const detected = Date.parse(job.providerRateLimit!.detectedAt);
    const extendedDeadline = Number.isFinite(deadline) && Number.isFinite(detected)
      ? new Date(deadline + Math.max(0, now - detected)).toISOString() : undefined;
    const updated = updateJob(job.id, {
      providerRateLimit: undefined,
      ...(extendedDeadline ? { agentRuntimeDeadlineAt: extendedDeadline } : {}),
      resumePrompt: providerContinuationPrompt(job, "The user requested a manual retry before the scheduled provider reset. Continue this same run."),
      resumeRequestedAt: new Date(now).toISOString(),
    }, { control: true, expectedRevision: job.revision || 0 });
    if (!updated) return null;
    updateChat(input.chatId, { runStatus: "running", runUpdatedAt: new Date(now).toISOString(), queueMessage: null }, input.userId);
    appendRunEvent(job.id, input.chatId, input.userId, "status", { status: "queued", message: "Manual retry requested." });
    return updated;
  });
}
