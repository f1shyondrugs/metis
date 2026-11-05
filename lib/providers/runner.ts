import { deferProviderLimitedJob } from "@/lib/db-jobs";
import { commitPendingModelSwitch } from "@/lib/model-switch";
import { requestTaskContinuation } from "@/lib/task-continuation";
import { researchContinuationForJob } from "@/lib/research-completion";
import { requestProviderRetry, runWithProviderRetries } from "@/lib/provider-retry-runner";
import {
  appendMessage,
  getChat,
  updateChat,
  upsertMessage,
  checkpointAssistantMessage,
  type Chat,
  type ToolPart,
} from "@/lib/db-store";
import type { MessagePart } from "@/lib/store";
import { extractSuggestions, stripSuggestionsFromParts, type ResponseSuggestion } from "@/lib/response-suggestions";
import { canonicalizeToolPart } from "@/lib/providers/tool-events";
import {
  appendTextMessagePart,
  reconcileMessageParts,
  updateThinkingMessagePart,
  upsertToolMessagePart,
} from "@/lib/message-parts";
import {
  findActiveConnection,
  getProviderConnection,
  getProviderConnectionSecret,
} from "@/lib/provider-connections";
import { getProviderDefinition } from "@/lib/providers/registry";
import { providerExecution } from "@/lib/providers/run-kind";
import { normalizeLegacyProviderModelId } from "@/lib/providers/model-aliases";
import { providerAdapterForExecution } from "@/lib/providers/adapters";
import type { ProviderResult } from "@/lib/providers/adapters/contract";
import {
  type ProviderContext,
  telemetryCategory,
  finalizeAlternativeTools,
  type CompactionEvent,
} from "@/lib/providers/adapters/provider-support";
import { modelKey, parseModelKey } from "@/lib/providers/types";
import type { AgentJob } from "@/lib/jobs";
import { appendRunEvent, getJob, jobLeaseDiagnostics, touchJob, updateJob } from "@/lib/db-jobs";
import { modeById } from "@/lib/modes";
import { estimateProviderInputTokens } from "@/lib/providers/adapters/provider-support";
import { activeInFlightTool, providerIdleTimeouts } from "@/lib/providers/stream-guard";
import { logError } from "@/lib/error-logs";
import {
  compactMessagePartsForPersistence,
  persistToolsForMessage,
} from "@/lib/tool-persistence";
import { recordSignal } from "@/lib/model-telemetry";
import { providerModelsForConnection } from "@/lib/providers/discovery";
import { usageConfiguration } from "@/lib/usage-configuration";
import { contextWindowForSelection } from "@/lib/context-window";
import {
  clearProviderSessionBinding,
  getProviderSessionBinding,
  nativeSessionNeedsManagedCompaction,
} from "@/lib/providers/session-bindings";
import { withEditedFileTracking, withLocalFileEditSnapshot } from "@/lib/file-edit-snapshot";
import { getAgentCwd } from "@/lib/mcp";
import { isJobWaitingForUser } from "@/lib/user-input-resume";
import { parkEndedUserInputWriter, commitWithUserInputContinuation } from "@/lib/db-jobs";

async function runProvider(context: ProviderContext): Promise<ProviderResult> {
  const providerKey =
    context.connection.providerKey ||
    parseModelKey(context.job.modelId).providerKey;
  return providerAdapterForExecution(providerExecution(providerKey)).runTurn(context);
}

export async function runAlternativeProviderJob(job: AgentJob, initialChat: Chat) {
  return runWithProviderRetries(job, current =>
    runAlternativeProviderAttempt(current, getChat(current.chatId, current.userId) || initialChat));
}

async function runAlternativeProviderAttempt(
  job: AgentJob,
  initialChat: Chat,
) {
  const runStartedAt = Date.now();
  const agentCwd = getAgentCwd(job.userId || undefined);
  let completionCommitted = false;
  const rawParsed = parseModelKey(job.modelId || initialChat.modelId || "");
  const normalizedModelId = normalizeLegacyProviderModelId(
    rawParsed.providerKey,
    rawParsed.modelId,
  );
  const parsed = { ...rawParsed, modelId: normalizedModelId };
  if (normalizedModelId !== rawParsed.modelId) {
    const canonicalKey = modelKey(
      rawParsed.providerKey,
      normalizedModelId,
      rawParsed.connectionId,
    );
    updateJob(job.id, { modelId: canonicalKey });
    updateChat(job.chatId, { modelId: canonicalKey }, job.userId);
  }
  const definition = getProviderDefinition(parsed.providerKey);
  if (!definition || parsed.providerKey === "cursor") return false;
  if (!job.userId)
    throw new Error("A user account is required for provider connections.");
  const connection = parsed.connectionId
    ? getProviderConnection(parsed.connectionId, job.userId)
    : findActiveConnection(job.userId, parsed.providerKey);
  if (
    !connection ||
    !connection.enabled ||
    connection.providerKey !== parsed.providerKey
  ) {
    throw new Error(`No enabled ${definition.name} connection is configured.`);
  }
  if (!definition.authTypes.includes(connection.authType)) {
    throw new Error(
      `${definition.name} no longer supports ${connection.authType} authentication.`,
    );
  }
  const credential = getProviderConnectionSecret(connection.id, job.userId);
  if (!credential) throw new Error("Provider connection not found.");
  if (
    definition.kind !== "compatible" &&
    definition.kind !== "antigravity-agent" &&
    definition.kind !== "codex-agent" &&
    !credential.secret
  ) {
    throw new Error(`${definition.name} requires a configured credential.`);
  }

  const assistantMessageId = crypto.randomUUID();
  let chat = getChat(job.chatId, job.userId) || initialChat;
  let text = "";
  let suggestions: ResponseSuggestion[] = [];
  const tools: ToolPart[] = [];
  const parts: MessagePart[] = [];
  const controller = new AbortController();
  type AbortCause = "cancelled" | "model_switch" | "stalled" | "lease_lost";
  let abortCause: AbortCause | null = null;
  let abortDetail = "";
  let lastProviderProgressAt = Date.now();
  const execution = providerExecution(parsed.providerKey);
  const adapter = providerAdapterForExecution(execution);
  const { providerIdleMs, providerToolIdleMs } = providerIdleTimeouts(
    adapter.capabilities.progressDelivery,
  );
  const markProviderProgress = () => {
    lastProviderProgressAt = Date.now();
  };
  const cancellationWatcher = setInterval(() => {
    const currentJob = getJob(job.id);
    const pendingModelId = currentJob?.pendingModelId?.trim();
    if (pendingModelId && pendingModelId !== job.modelId) {
      abortCause = "model_switch";
      controller.abort();
      return;
    }
    if (currentJob?.status === "cancelled") {
      abortCause = "cancelled";
      controller.abort();
    }
  }, 250);
  let lastLeaseHeartbeatAt = Date.now();
  let leaseFailureContext: Record<string, unknown> | undefined;
  const leaseHeartbeat = setInterval(() => {
    const heartbeatAt = Date.now();
    const heartbeatDelayMs = Math.max(0, heartbeatAt - lastLeaseHeartbeatAt - 30_000);
    lastLeaseHeartbeatAt = heartbeatAt;
    const touched = touchJob(job.id);
    if (touched || controller.signal.aborted) return;
    leaseFailureContext = { ...jobLeaseDiagnostics(job.id), heartbeatDelayMs };
    abortCause = "lease_lost";
    abortDetail = "The provider run lost its worker lease and was stopped to prevent duplicate execution.";
    controller.abort();
  }, 30_000);
  const progressWatchdog = setInterval(() => {
    if (controller.signal.aborted) return;
    const activeTool = activeInFlightTool(tools);
    const limit = activeTool ? providerToolIdleMs : providerIdleMs;
    const idleFor = Date.now() - lastProviderProgressAt;
    if (idleFor < limit) return;
    abortCause = "stalled";
    abortDetail = activeTool
      ? `Agent tool ${activeTool.name} produced no progress for ${Math.round(idleFor / 1000)} seconds.`
      : `Provider produced no progress for ${Math.round(idleFor / 1000)} seconds.`;
    emit("status", { status: "stalled", message: `${abortDetail} Stopping this run instead of leaving the chat stuck.` });
    controller.abort();
  }, 5_000);
  const emit = (event: string, data: unknown) =>
    appendRunEvent(job.id, job.chatId, job.userId, event, data);
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  let checkpointDirty = false;
  const durableMessageProjection = () => {
    const durableTools = tools.length
      ? persistToolsForMessage(job.chatId, assistantMessageId, tools)
      : [];
    const durableParts = reconcileMessageParts({
      parts,
      content: text,
      tools: durableTools,
    });
    return {
      content: text,
      ...(suggestions.length ? { suggestions } : {}),
      ...(durableTools.length ? { tools: durableTools } : {}),
      ...(durableParts.length
        ? { parts: compactMessagePartsForPersistence(durableParts) }
        : {}),
    };
  };
  const checkpointNow = () => {
    checkpointAssistantMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      ...durableMessageProjection(),
    });
    checkpointDirty = false;
  };
  const checkpoint = (immediate = false) => {
    checkpointDirty = true;
    if (immediate) {
      if (checkpointTimer) clearTimeout(checkpointTimer);
      checkpointTimer = undefined;
      checkpointNow();
      return;
    }
    if (checkpointTimer) return;
    checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      if (checkpointDirty) checkpointNow();
    }, 500);
  };
  const handoffModelSwitch = () => commitPendingModelSwitch(job.id, job.modelId || initialChat.modelId || "", event => {
    for (const tool of tools.filter(tool => tool.status === "running")) {
      tool.status = "cancelled";
      upsertToolMessagePart(parts, tool);
      emit("tool", { callId: tool.id, name: tool.name, status: tool.status, kind: tool.kind });
    }
    parts.push(event);
    checkpoint(true);
  });

  const onText = (value: string) => {
    if (!value) return;
    markProviderProgress();
    text += value;
    appendTextMessagePart(parts, value);
    checkpoint();
    emit("text", { text: value });
  };
  const onTool = (tool: ToolPart) => {
    markProviderProgress();
    // write_todos is a state surface, not an append-only tool history. Give it
    // one stable id per run so every update replaces the same Tasks card in
    // persistence and in the live SSE UI instead of creating ghost checklists.
    const canonical = canonicalizeToolPart(tool);
    let normalizedTool =
      canonical.kind === "todo" ? { ...canonical, id: `todo-${job.id}` } : canonical;
    // A gateway's inner todo identity may only become known after its arguments finish.
    if (canonical.kind === "todo" && canonical.id !== normalizedTool.id) {
      const provisional = tools.findIndex(item => item.id === canonical.id);
      if (provisional >= 0) {
        const alreadyPresent = tools.some(item => item.id === normalizedTool.id);
        if (alreadyPresent) tools.splice(provisional, 1);
        else tools[provisional] = { ...tools[provisional], id: normalizedTool.id };
        const partIndex = parts.findIndex(item => item.type === "tool" && item.id === canonical.id);
        if (partIndex >= 0) {
          if (alreadyPresent) parts.splice(partIndex, 1);
          else parts[partIndex] = { ...parts[partIndex], id: normalizedTool.id } as MessagePart;
        }
      }
    }
    let existingIndex = tools.findIndex(
      (item) => item.id === normalizedTool.id,
    );
    if (existingIndex < 0 && normalizedTool.status !== "running") {
      existingIndex = tools.findLastIndex(
        (item) =>
          item.status === "running" && item.name === normalizedTool.name,
      );
      if (existingIndex >= 0) {
        normalizedTool.id = tools[existingIndex].id;
      }
    }
    normalizedTool = withLocalFileEditSnapshot(
      normalizedTool,
      existingIndex >= 0 ? tools[existingIndex] : undefined,
      agentCwd,
    );
    normalizedTool = withEditedFileTracking(normalizedTool, agentCwd, existingIndex >= 0 ? tools[existingIndex] : undefined,
      { userId: job.userId, chatId: job.chatId, jobId: job.id, incognito: Boolean(job.incognito || chat.incognito) });
    if (existingIndex >= 0) {
      tools[existingIndex] = { ...tools[existingIndex], ...normalizedTool };
    } else {
      tools.push(normalizedTool);
    }
    upsertToolMessagePart(parts, normalizedTool);
    checkpoint(normalizedTool.phase !== "preparing" || existingIndex < 0);
    emit("tool", {
      callId: normalizedTool.id,
      name: normalizedTool.name,
      status: normalizedTool.status,
      kind: normalizedTool.kind,
      ...(normalizedTool.source ? { source: normalizedTool.source } : {}),
      ...(normalizedTool.phase ? { phase: normalizedTool.phase } : {}),
      ...(normalizedTool.inputChars !== undefined ? { inputChars: normalizedTool.inputChars } : {}),
      ...(normalizedTool.input ? { input: normalizedTool.input } : {}),
      ...(normalizedTool.result ? { result: normalizedTool.result } : {}),
      ...(normalizedTool.todos?.length ? { todos: normalizedTool.todos } : {}),
      ...(normalizedTool.subagent ? { subagent: normalizedTool.subagent } : {}),
    });
  };
  const onCompaction = (event: CompactionEvent) => {
    markProviderProgress();
    const part: MessagePart = { ...event };
    const existing = parts.findIndex((item) => item.type === "compaction");
    if (existing >= 0) parts[existing] = part;
    else parts.push(part);
    checkpoint(true);
    emit("compaction", event);
  };
  const onThinking = (data: {
    text?: string;
    replace?: boolean;
    done?: boolean;
    durationMs?: number;
  }) => {
    markProviderProgress();
    updateThinkingMessagePart(parts, data);
    checkpoint(data.done === true);
    emit("thinking", data);
    if (data.done !== true) {
      emit("status", { status: "running", message: "Thinking…" });
    }
  };

  appendMessage(job.chatId, {
    id: assistantMessageId,
    role: "assistant",
    content: "",
  });
  emit("assistantId", { messageId: assistantMessageId });
  emit("status", { status: "running", message: "Starting model…" });
  updateChat(
    job.chatId,
    {
      runStatus: "running",
      runUpdatedAt: new Date().toISOString(),
      queueMessage: null,
    },
    job.userId,
  );

  try {
    const runParams = (Array.isArray(job.modelParams) ? job.modelParams : chat.modelParams)?.map(param => ({ ...param }));
    const selectedModel = providerModelsForConnection(credential)
      .find((candidate) => candidate.id === parsed.modelId);
    const selectedContextWindow = contextWindowForSelection(
      selectedModel || { id: parsed.modelId, providerId: definition.key }, runParams,
    );
    const runConfiguration = usageConfiguration(runParams, selectedContextWindow);
    if (adapter.capabilities.contextOwner === "native") {
      const binding = getProviderSessionBinding(chat, execution, credential.id);
      const selectedModel = providerModelsForConnection(credential)
        .find((candidate) => candidate.id === parsed.modelId);
      const contextWindow = contextWindowForSelection(
        selectedModel || { id: parsed.modelId, providerId: definition.key },
        Array.isArray(job.modelParams) ? job.modelParams : chat.modelParams,
      );
      if (binding?.lastKnownGoodCursor && nativeSessionNeedsManagedCompaction(execution, binding, contextWindow)) {
        emit("status", {
          status: "compacting",
          message: "Native provider context reached the compaction threshold; continuing in a fresh compacted session.",
        });
        clearProviderSessionBinding(job.chatId, job.userId, execution, credential.id);
        updateChat(job.chatId, { agentId: null }, job.userId);
        chat = getChat(job.chatId, job.userId) || chat;
      }
    }
    const result = await runProvider({
      job,
      chat,
      connection: credential,
      modelId: parsed.modelId,
      signal: controller.signal,
      onText,
      onTool,
      onCompaction,
      onThinking,
      onStream: (data) => {
        markProviderProgress();
        emit(data.type === "compaction" ? "compaction" : "stream", data);
      },
    });
    if (handoffModelSwitch()) return true;
    const durableStatus = getJob(job.id)?.status;
    if (durableStatus === "interrupted") {
      checkpoint();
      emit("status", {
        status: "interrupted",
        message: "Run was interrupted before the provider finished.",
      });
      return true;
    }
    if (isJobWaitingForUser(durableStatus)) {
      checkpoint(true);
      if (parkEndedUserInputWriter(job.id)) return true;
    }
    if (abortCause === "stalled" || abortCause === "lease_lost") throw new Error(abortDetail);
    const cancelled =
      abortCause === "cancelled" || durableStatus === "cancelled";
    if (cancelled) {
      updateChat(
        job.chatId,
        {
          runStatus: "cancelled",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          pendingApproval: null,
        },
        job.userId,
      );
      emit("done", { status: "cancelled", provider: definition.key });
      updateJob(job.id, { status: "cancelled" });
      return true;
    }
    // An empty provider response is kept empty. Do not fabricate assistant text;
    // the caller can surface the actual run status and diagnostics.
    finalizeAlternativeTools(tools);
    checkpoint(true);
    const research = await researchContinuationForJob(getJob(job.id) || job);
    if (handoffModelSwitch()) return true;
    if (requestTaskContinuation({
      jobId: job.id,
      assistantMessage: { id: assistantMessageId, role: "assistant", content: text, tools, parts },
      outcome: "success",
      checkpoint: () => checkpoint(true),
      agentId: result.agentId,
      research,
    })) return true;
    const extractedSuggestions = extractSuggestions(text);
    text = extractedSuggestions.text;
    suggestions = extractedSuggestions.suggestions;
    parts.splice(0, parts.length, ...stripSuggestionsFromParts(parts));
    if (suggestions.length) emit("suggestions", { suggestions });
    if (
      modeById(job.modeId || chat.sessionState?.modeId).id === "plan" &&
      text.trim()
    ) {
      const current = getChat(job.chatId, job.userId);
      const existingPlan = current?.workspaces?.find(
        (workspace) => workspace.type === "plan",
      );
      if (!existingPlan && current) {
        const timestamp = new Date().toISOString();
        const workspace = {
          id: crypto.randomUUID(),
          type: "plan" as const,
          name: "Plan",
          content: text.trim().slice(0, 100_000),
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        };
        updateChat(
          job.chatId,
          {
            workspaces: [...(current.workspaces || []), workspace].slice(-20),
          },
          job.userId,
        );
        text = `${text.trim()}\n\n[Plan: ${workspace.name}](workspace://plan/${workspace.id})`;
        appendRunEvent(job.id, job.chatId, job.userId, "workspace", {
          workspace,
        });
      }
    }
    recordSignal({
      modelId: parsed.modelId,
      category: telemetryCategory(job.message),
      success: true,
      totalLatencyMs: Math.max(0, Date.now() - runStartedAt),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      toolCallCount: tools.length,
      toolFailures: tools.some((tool) => tool.status === "error"),
      createdAt: new Date().toISOString(),
    });
    checkpoint();
    const measuredInputTokens =
      result.usage?.inputTokens ?? result.usage?.totalProcessedTokens;
    const inputTokens =
      measuredInputTokens ??
      estimateProviderInputTokens(chat, job, parsed.modelId);

    const runtimeWindow =
      typeof result.usage?.maxTokens === "number" && result.usage.maxTokens >= 32_768
        ? result.usage.maxTokens
        : undefined;
    const contextWindow = runtimeWindow ?? selectedContextWindow;
    const contextWindowSource = runtimeWindow
      ? "runtime" as const
      : selectedModel?.contextWindowSource || (selectedContextWindow ? "catalog" as const : undefined);
    const compactionAfter = [...parts].reverse().find((item) => item.type === "compaction")?.afterTokens;
    const contextUsedTokens =
      result.usage?.usedTokens ??
      compactionAfter ??
      inputTokens;
    if (contextUsedTokens || contextWindow) {
      emit("context", {
        usedTokens: contextUsedTokens,
        maxTokens: contextWindow,
        source: runtimeWindow ? "provider" : measuredInputTokens !== undefined ? "provider" : "estimate",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cachedInputTokens: result.usage?.cachedInputTokens,
        totalProcessedTokens: result.usage?.totalProcessedTokens,
        compactsAutomatically: result.usage?.compactsAutomatically,
        autoCompactThreshold: result.usage?.autoCompactThreshold,
      });
    }
    // Persist the durable answer before publishing terminal run state. If a
    // later event append fails, a successful model/tool run must not regress
    // from completed -> error.
    upsertMessage(job.chatId, {
      id: assistantMessageId,
      role: "assistant",
      ...durableMessageProjection(),
      runMetadata: {
        ...runConfiguration,
        providerId: definition.key,
        modelId: parsed.modelId,
        inputTokens,
        ...(measuredInputTokens === undefined
          ? { inputTokensEstimated: true }
          : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        ...(result.usage?.cachedInputTokens !== undefined ? { cachedInputTokens: result.usage.cachedInputTokens } : {}),
        ...(result.usage?.cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens: result.usage.cacheWriteInputTokens } : {}),
        ...(result.usage?.tokenUsageScope ? { tokenUsageScope: result.usage.tokenUsageScope } : {}),
        ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
        ...(result.usage?.totalProcessedTokens !== undefined ? { totalProcessedTokens: result.usage.totalProcessedTokens } : {}),
        ...(contextUsedTokens !== undefined ? { contextUsedTokens } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(contextWindowSource ? { contextWindowSource } : {}),
        ...(result.usage?.maxOutputTokens !== undefined ? { maxOutputTokens: result.usage.maxOutputTokens } : selectedModel?.maxOutputTokens ? { maxOutputTokens: selectedModel.maxOutputTokens } : {}),
        ...(result.usage?.compactsAutomatically !== undefined ? { compactsAutomatically: result.usage.compactsAutomatically } : {}),
        ...(result.usage?.autoCompactThreshold !== undefined ? { autoCompactThreshold: result.usage.autoCompactThreshold } : {}),
        ...(result.usage?.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
        completedAt: new Date().toISOString(),
      },
    });
    commitWithUserInputContinuation(job.id, () => {
      const completedChat = updateChat(
        job.chatId,
        {
          ...(result.agentId ? { agentId: result.agentId } : {}),
          runStatus: "completed",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          pendingApproval: null,
        },
        job.userId,
      );
      if (!completedChat) {
        throw new Error("Run completion lost its active worker lease before the chat projection was committed.");
      }
      chat = completedChat;
      // Publish the terminal timeline event while the worker still owns the
      // lease. updateJob(completed) releases that lease and must be last.
      emit("done", {
        status: "finished",
        provider: definition.key,
        modelId: parsed.modelId,
        ...(result.agentId ? { agentId: result.agentId } : {}),
      });
      updateJob(job.id, {
        status: "completed",
        ...(result.agentId ? { agentId: result.agentId } : {}),
      });
      completionCommitted = true;
    }, result.agentId, assistantMessageId);
  } catch (error) {
    if (handoffModelSwitch()) return true;
    if (completionCommitted) {
      const message = error instanceof Error ? error.message : String(error);
      void logError({
        level: "warn",
        source: "worker",
        chatId: job.chatId,
        userId: job.userId || undefined,
        message: `Post-completion provider bookkeeping failed (${definition.key}): ${message}`,
        stack: error instanceof Error ? error.stack : undefined,
        context: { jobId: job.id, provider: definition.key, modelId: parsed.modelId },
      });
      return true;
    }
    const durableStatus = getJob(job.id)?.status;
    const interrupted = durableStatus === "interrupted";
    const cancelled = abortCause === "cancelled" || durableStatus === "cancelled";
    const runtimeFailure = abortCause === "stalled" || abortCause === "lease_lost";
    const message = cancelled
      ? "Provider run cancelled."
      : interrupted
        ? "Provider run interrupted."
        : runtimeFailure
          ? abortDetail || "Provider run stopped after losing runtime progress."
          : error instanceof Error
            ? error.message
            : "Provider run failed.";
    const interruptedTools = tools.filter(tool => tool.status === "running");
    finalizeAlternativeTools(tools);
    if (!cancelled && !interrupted && abortCause !== "lease_lost") {
      checkpoint(true);
      if (deferProviderLimitedJob(job.id, error, event => { parts.push(event); checkpoint(true); })) return true;
      if (requestProviderRetry(job.id, error, event => {
        for (const tool of interruptedTools) emit("tool", {
          callId: tool.id, name: tool.name, status: tool.status, kind: tool.kind,
          ...(tool.result ? { result: tool.result } : {}),
        });
        parts.push(event);
        checkpoint(true);
      })) return true;
    }
    recordSignal({
      modelId: parsed.modelId,
      category: telemetryCategory(job.message),
      success: false,
      totalLatencyMs: Math.max(0, Date.now() - runStartedAt),
      toolCallCount: tools.length,
      toolFailures: true,
      createdAt: new Date().toISOString(),
    });
    if (!cancelled && !interrupted) {
      void logError({
        level: "error",
        source: "worker",
        chatId: job.chatId,
        userId: job.userId || undefined,
        message: `Provider run failed (${definition.key}): ${message}`,
        stack: error instanceof Error ? error.stack : undefined,
        context: {
          jobId: job.id,
          provider: definition.key,
          modelId: parsed.modelId,
          ...(leaseFailureContext ? { lease: leaseFailureContext } : {}),
        },
      });
    }
    if (interrupted) {
      checkpoint();
      emit("status", { status: "interrupted", message });
    } else if (cancelled) {
      updateChat(
        job.chatId,
        { runStatus: "cancelled", runUpdatedAt: new Date().toISOString() },
        job.userId,
      );
      emit("done", { status: "cancelled", provider: definition.key });
      updateJob(job.id, { status: "cancelled", error: message });
    } else {
      upsertMessage(job.chatId, {
        id: assistantMessageId,
        role: "assistant",
        ...durableMessageProjection(),
        errorMessage: message,
      });
      updateChat(
        job.chatId,
        {
          runStatus: "error",
          runUpdatedAt: new Date().toISOString(),
          queueMessage: null,
          badge: "red",
        },
        job.userId,
      );
      emit("error", { message });
      updateJob(job.id, { status: "error", error: message });
    }
  } finally {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    if (checkpointDirty) checkpointNow();
    clearInterval(cancellationWatcher);
    clearInterval(leaseHeartbeat);
    clearInterval(progressWatchdog);
  }
  return true;
}

export {
  COMPACTION_MARKER,
  compactChatHistoryForPrompt,
  compactProviderMessages,
  codexReasoningEffortForSelection,
  codexServiceTierForSelection,
  aiReasoningForSelection,
  anthropicProviderOptionsForSelection,
  compatibleProviderOptionsForSelection,
} from "@/lib/providers/adapters/provider-support";
export { codexTool } from "@/lib/providers/adapters/codex";
export type { CompactionEvent } from "@/lib/providers/adapters/provider-support";
