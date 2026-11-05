import { appendRunEvent, getJob, updateJob } from "@/lib/db-jobs";
import { updateChat } from "@/lib/db-store";
import { transaction } from "@/lib/sqlite";
import { parseModelKey } from "@/lib/providers/types";
import { providerContinuationPrompt } from "@/lib/provider-continuation";
import type { ModelSwitchPart } from "@/lib/run-control-event";

/** The last accepted selection wins, including requests arriving as the stream closes. */
export function commitPendingModelSwitch(
  jobId: string,
  fromModelId: string,
  checkpoint: (event: ModelSwitchPart) => void,
  activeAgentId?: string,
): boolean {
  return transaction(() => {
    const current = getJob(jobId);
    const toModelId = current?.pendingModelId?.trim();
    if (!current || current.status !== "running" || !toModelId || toModelId === fromModelId) return false;
    const timestamp = new Date().toISOString();
    const source = parseModelKey(fromModelId), target = parseModelKey(toModelId);
    const nextAgentId = source.providerKey === "cursor" && target.providerKey === "cursor"
      && source.connectionId === target.connectionId ? activeAgentId || current.agentId : undefined;
    const event: ModelSwitchPart = {
      type: "model-switch", id: `model-switch:${current.id}:${current.modelSwitchRequestedAt || timestamp}`,
      fromModelId, toModelId, timestamp,
    };
    // Checkpoints/events are written under the old writer lease, before releasing it.
    checkpoint(event);
    const projected = updateChat(current.chatId, {
      modelId: toModelId, modelParams: current.pendingModelParams || [],
      agentId: nextAgentId || null, runStatus: "running", runUpdatedAt: timestamp,
      queueMessage: null, badge: null,
    }, current.userId);
    if (!projected) throw new Error("Model switch lost its active writer.");
    appendRunEvent(current.id, current.chatId, current.userId, "run-event", event);
    appendRunEvent(current.id, current.chatId, current.userId, "status", { status: "switching_model", modelId: toModelId });
    const updated = updateJob(current.id, {
      status: "switching", error: undefined, agentId: nextAgentId,
      modelId: toModelId, modelParams: current.pendingModelParams,
      pendingModelId: undefined, pendingModelParams: undefined, modelSwitchRequestedAt: undefined,
      resumePrompt: providerContinuationPrompt(current, `The user switched the active model from ${fromModelId} to ${toModelId}.`),
      resumeRequestedAt: timestamp,
    }, { expectedRevision: current.revision ?? 0 });
    if (!updated) throw new Error("Model switch lost its job revision.");
    return true;
  });
}
