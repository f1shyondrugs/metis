import type { ProjectModelSelection } from "./project-model";

export type ChatModelSettingsSelection = ProjectModelSelection & { modelChainId?: string | null };
export type ChatModelSettingsResult = {
  current: boolean;
  selection: ChatModelSettingsSelection;
  error?: Error;
};
type Writer = (chatId: string, selection: ChatModelSettingsSelection, signal?: AbortSignal) => Promise<ChatModelSettingsSelection>;
type Entry = {
  revision: number;
  intent: number;
  pending: number;
  confirmed: ChatModelSettingsSelection;
  latest: ChatModelSettingsSelection;
  tail: Promise<void>;
};

function copy(selection: ChatModelSettingsSelection): ChatModelSettingsSelection {
  return { modelId: selection.modelId, modelParams: selection.modelParams.map(({ id, value }) => ({ id, value })), ...(selection.modelChainId !== undefined ? { modelChainId: selection.modelChainId } : {}) };
}

/** Serializes full selections per chat; account defaults never participate in restoration. */
export function createChatModelSettingsQueue(write: Writer) {
  const entries = new Map<string, Entry>();
  const controller = new AbortController();
  let disposed = false;
  const revision = (chatId: string) => entries.get(chatId)?.revision ?? 0;
  const pending = (chatId: string) => Boolean(entries.get(chatId)?.pending);
  const acceptsSnapshot = (chatId: string, readRevision: number) => !pending(chatId) && revision(chatId) === readRevision;

  return {
    revision,
    pending,
    acceptsSnapshot,
    /** End an authentication lifetime before queued writes can inherit another session. */
    dispose() {
      disposed = true;
      controller.abort();
      entries.clear();
    },
    /** A read started before a write or its confirmation cannot restore stale settings. */
    resolve(chatId: string, saved: ChatModelSettingsSelection, readRevision?: number) {
      const entry = entries.get(chatId);
      return copy(entry && (entry.pending > 0 || (readRevision !== undefined && !acceptsSnapshot(chatId, readRevision)))
        ? entry.latest : saved);
    },
    save(chatId: string, next: ChatModelSettingsSelection, baseline: ChatModelSettingsSelection): Promise<ChatModelSettingsResult> {
      if (disposed) return Promise.resolve({ current: false, selection: copy(baseline) });
      let entry = entries.get(chatId);
      if (!entry) {
        entry = { revision: 0, intent: 0, pending: 0, confirmed: copy(baseline), latest: copy(baseline), tail: Promise.resolve() };
        entries.set(chatId, entry);
      }
      const target = entry;
      const idle = target.pending === 0;
      if (idle) target.confirmed = copy(baseline);
      const intent = ++target.intent;
      target.revision++;
      target.pending++;
      target.latest = copy(next);
      const requested = copy(next);

      const persist = async (): Promise<ChatModelSettingsResult> => {
        let error: Error | undefined;
        if (!disposed) {
          try {
            const saved = await write(chatId, copy(requested), controller.signal);
            if (!disposed) {
              if (!saved || typeof saved.modelId !== "string" || !saved.modelId || !Array.isArray(saved.modelParams)
                || saved.modelParams.some(param => !param || typeof param.id !== "string" || typeof param.value !== "string")) {
                throw new Error("Invalid chat model settings response.");
              }
              // An earlier successful write is still the durable rollback baseline.
              target.confirmed = copy(saved);
            }
          } catch (cause) {
            error = cause instanceof Error ? cause : new Error("Could not save chat model settings.");
          }
        }
        target.pending--;
        target.revision++;
        if (disposed) return { current: false, selection: copy(target.confirmed) };
        const current = target.intent === intent;
        if (current) target.latest = copy(target.confirmed);
        return { current, selection: copy(current ? target.latest : target.confirmed), ...(error ? { error } : {}) };
      };

      // Start an idle chat immediately, while other chats and later writes stay independent.
      const operation = idle ? persist() : target.tail.then(persist);
      target.tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
