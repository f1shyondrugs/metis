export const COMPOSER_SEND_DEDUP_MS = 900;

export function composerLiveText(domText: string | null | undefined, stateText: string) {
  const fromDom = stripComposerPlaceholderLeak((domText ?? "").replace(/\u00a0/g, " "));
  const fromState = stripComposerPlaceholderLeak(stateText.replace(/\u00a0/g, " "));
  return fromDom.trim() ? fromDom : fromState;
}

export function stripComposerPlaceholderLeak(text: string, placeholder = "Message Metis…") {
  const live = text.replace(/\u00a0/g, " ").trim();
  const label = placeholder.replace(/\u00a0/g, " ").trim();
  return label && live === label ? "" : text;
}

/** Never overwrite a focused editor unless force (send, voice, mention, chat switch). */
export function shouldSyncComposerDom(
  currentText: string,
  nextValue: string,
  focused: boolean,
  force = false,
) {
  if (currentText === nextValue) return false;
  if (force) return true;
  return !focused;
}

export function composerTranscriptInsert(current: string, transcript: string) {
  const live = current.replace(/\u00a0/g, " ").trim();
  const spoken = transcript.trim();
  if (!spoken) return live;
  return live ? `${live} ${spoken}` : spoken;
}

type VoiceDraftSnapshot = { text: string; chatId: string | null; epoch: number; editedAt: string };

/** Final STT text may only replace the exact, still untouched insertion. */
export function composerTranscriptFinalizer(
  before: string,
  read: () => VoiceDraftSnapshot,
  apply: (text: string) => void,
) {
  const inserted = { ...read() };
  let consumed = false;
  return (transcript: string) => {
    if (consumed) return;
    consumed = true;
    const current = read();
    if (!transcript.trim() || current.chatId !== inserted.chatId || current.epoch !== inserted.epoch
      || current.editedAt !== inserted.editedAt || current.text !== inserted.text) return;
    const next = composerTranscriptInsert(before, transcript);
    if (next !== current.text) apply(next);
  };
}

export function shouldAcceptRemoteComposerInput(options: {
  dirtyUntil: number;
  now?: number;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  remoteInput: unknown;
}) {
  if (typeof options.remoteInput !== "string") return false;
  if ((options.now ?? Date.now()) < options.dirtyUntil) return false;
  const remoteTs = Date.parse(options.remoteUpdatedAt || "") || 0;
  const localTs = Date.parse(options.localUpdatedAt || "") || 0;
  if (localTs && remoteTs < localTs) return false;
  return true;
}

export const COMPOSER_DIRTY_MS = 1500;
export const COMPOSER_STATE_COMMIT_MS = 320;

/** Full AppShell state updates only when the field flips empty, not on every key. */
export function shouldCommitComposerParentState(previous: string, next: string) {
  return Boolean(previous.trim()) !== Boolean(next.trim());
}

export function shouldPersistComposerSession(options: {
  chatId: string | null | undefined;
  persistChatId: string | null | undefined;
  incognito?: boolean;
}) {
  if (!options.chatId || options.incognito) return false;
  return options.persistChatId === options.chatId;
}

export function composerUserEditMeta(now = Date.now()) {
  return {
    updatedAt: new Date(now).toISOString(),
    dirtyUntil: now + COMPOSER_DIRTY_MS,
  };
}

export function shouldIgnoreComposerEnter(event: {
  key: string;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.repeat) return true;
  if (event.isComposing || event.keyCode === 229) return true;
  return false;
}

export function isDuplicateComposerSend(
  text: string,
  last: { text: string; at: number },
  now = Date.now(),
  windowMs = COMPOSER_SEND_DEDUP_MS,
) {
  if (!text) return false;
  return last.text === text && now - last.at < windowMs;
}

export type ComposerSendAction = "ignore" | "queue" | "send";

export function decideComposerSend(options: {
  force: boolean;
  isOverride: boolean;
  hasContent: boolean;
  sendInFlight: boolean;
  busy: boolean;
  waitingForQuestion: boolean;
  duplicate: boolean;
  hasActiveRuntime?: boolean;
}): ComposerSendAction {
  if (options.duplicate && !options.force) return "ignore";
  if (!options.hasContent && !options.isOverride) return "ignore";
  // Force/override must not start a second in-flight POST (queue spam / 409).
  if (options.sendInFlight) return options.force || options.isOverride ? "ignore" : "queue";
  if (options.force || options.isOverride) return "send";
  if (!options.hasContent) return "ignore";
  if (options.waitingForQuestion || options.busy || options.hasActiveRuntime) return "queue";
  return "send";
}

/** One queued follow-up at a time. Used by Send-now and any future client drain. */
export function shouldStartQueuedFollowUp(options: {
  drainInFlight: boolean;
  sendInFlight: boolean;
  busy: boolean;
  waitingForQuestion: boolean;
  hasActiveRuntime?: boolean;
  interruptActiveRun?: boolean;
}) {
  return (
    !options.waitingForQuestion &&
    !options.drainInFlight &&
    !options.sendInFlight &&
    Boolean(options.interruptActiveRun || (
      !options.busy && !options.waitingForQuestion && !options.hasActiveRuntime
    ))
  );
}

export function shouldAutoDrainQueue(options: {
  busy: boolean;
  sendInFlight: boolean;
  waitingForQuestion: boolean;
  drainBlocked: boolean;
  drainInProgress: boolean;
  queueLength: number;
  hasActiveRuntime?: boolean;
  serverOwnsDrain?: boolean;
}) {
  if (options.serverOwnsDrain) return false;
  return (
    !options.busy &&
    !options.sendInFlight &&
    !options.waitingForQuestion &&
    !options.drainBlocked &&
    !options.drainInProgress &&
    !options.hasActiveRuntime &&
    options.queueLength > 0
  );
}

export function mergeQueuedFollowUps<T extends { id: string }>(
  local: T[],
  server: T[],
  options?: { consumedIds?: Iterable<string>; removedIds?: Iterable<string> },
): T[] {
  const consumed = new Set(options?.consumedIds);
  const removed = new Set(options?.removedIds);
  const byId = new Map<string, T>();
  for (const item of local) {
    if (consumed.has(item.id) || removed.has(item.id)) continue;
    byId.set(item.id, item);
  }
  for (const item of server) {
    if (consumed.has(item.id) || removed.has(item.id)) continue;
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
  }
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of [...local, ...server]) {
    const next = byId.get(item.id);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    merged.push(next);
  }
  // Preserve React state identity for live-sync echoes. A new but equal queue
  // otherwise triggers autosave, another sync event, and an endless refresh loop.
  return merged.length === local.length && merged.every((item, index) => item === local[index])
    ? local
    : merged;
}

/** Only attachments for this submission gate send; other chats' uploads do not. */
export function hasUnfinishedComposerUploads(
  attachments: ReadonlyArray<{ uploadTaskId?: string }>,
  statusFor: (id: string) => string | undefined,
) {
  return attachments.some((file) => file.uploadTaskId && statusFor(file.uploadTaskId) !== "completed");
}
