import { setTimeout as delay } from "node:timers/promises";
import { appendRunEvent, getJob, touchJob, updateJob } from "@/lib/db-jobs";
import type { AgentJob } from "@/lib/jobs";
import { getProviderRetryEnabled } from "@/lib/provider-retry-settings";
import { MAX_PROVIDER_RETRIES, providerRetryDetail, type ProviderRetryPart } from "@/lib/provider-retry";
import { transaction } from "@/lib/sqlite";
import { appendMessage } from "@/lib/db-store";
import { commitPendingModelSwitch } from "@/lib/model-switch";
import type { ModelSwitchPart } from "@/lib/run-control-event";
import { modelChainFailure } from "@/lib/model-chain-failure";
import { requestModelChainFallback } from "@/lib/model-chain-runtime";
import { providerContinuationPrompt } from "@/lib/provider-continuation";

/** Publish/checkpoint the retry while retaining the same worker lease and runtime budget. */
export function requestProviderRetry(
  jobId: string,
  error: unknown,
  checkpoint: (event: ProviderRetryPart) => void,
): boolean {
  return transaction(() => {
    const current = getJob(jobId);
    if (!current || current.status !== "running" || current.cancellationCause) return false;
    if (current.agentRuntimeDeadlineAt && Date.parse(current.agentRuntimeDeadlineAt) <= Date.now()) return false;
    const chainUnavailable = Boolean(current.modelChain && modelChainFailure(error) === "unavailable");
    if (!chainUnavailable && !getProviderRetryEnabled(current.userId)) return false;
    const count = chainUnavailable ? current.modelChain!.unavailableRetries : current.providerRetryCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count >= MAX_PROVIDER_RETRIES) return false;
    const attempt = count + 1;
    const event: ProviderRetryPart = {
      type: "provider-retry", id: `provider-retry:${current.id}:${attempt}`,
      attempt, maxRetries: MAX_PROVIDER_RETRIES,
      message: `Error occurred, continuing… (${attempt}/${MAX_PROVIDER_RETRIES})`,
      detail: providerRetryDetail(error),
    };
    const updated = updateJob(jobId, {
      providerRetryCount: (current.providerRetryCount ?? 0) + 1,
      ...(chainUnavailable ? { modelChain: { ...current.modelChain!, unavailableRetries: attempt } } : {}),
      resumePrompt: providerContinuationPrompt(current, "An error interrupted this same run."),
      resumeRequestedAt: new Date().toISOString(),
    }, { expectedRevision: current.revision ?? 0 });
    if (!updated) return false;
    checkpoint(event);
    appendRunEvent(current.id, current.chatId, current.userId, "status", {
      ...event, status: "retrying_provider",
    });
    return true;
  });
}

async function waitForProviderRetry(job: AgentJob): Promise<AgentJob | null> {
  // This is Metis recovery backoff, never an assumed provider usage/reset window.
  const delayMs = 1000 * 2 ** ((job.providerRetryCount ?? 1) - 1);
  for (let remaining = delayMs; remaining > 0; remaining -= 250) {
    const current = touchJob(job.id);
    if (!current || current.status !== "running") return null;
    await delay(Math.min(250, remaining));
  }
  const current = touchJob(job.id);
  return current?.status === "running" ? current : null;
}

function checkpointRecoveryEvent(job: AgentJob, event: ProviderRetryPart | ModelSwitchPart) {
  const id = crypto.randomUUID();
  appendMessage(job.chatId, { id, role: "assistant", content: "", parts: [event] }, job.userId);
  appendRunEvent(job.id, job.chatId, job.userId, "assistantId", { messageId: id });
}

/** Start another attempt only after cleanup and a bounded, cancellable backoff. */
export async function runWithProviderRetries<T>(
  initialJob: AgentJob,
  runAttempt: (job: AgentJob) => Promise<T>,
): Promise<T> {
  let job = initialJob;
  for (;;) {
    let result!: T;
    try {
      result = await runAttempt(job);
    } catch (error) {
      if (commitPendingModelSwitch(job.id, job.modelId || "", event => checkpointRecoveryEvent(job, event))) return result;
      if (requestModelChainFallback(job.id, error, event => checkpointRecoveryEvent(job, event))) return result;
      if (!requestProviderRetry(job.id, error, event => checkpointRecoveryEvent(job, event))) throw error;
    }
    const current = getJob(job.id);
    if (!current || current.status !== "running"
      || (current.providerRetryCount ?? 0) <= (job.providerRetryCount ?? 0)) return result;
    const ready = await waitForProviderRetry(current);
    if (!ready) return result;
    job = ready;
  }
}
