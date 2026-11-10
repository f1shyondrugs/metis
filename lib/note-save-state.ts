import { createClientId } from "./client-id";
import type { NoteTodo, SharedNote } from "@/lib/store";

export type NoteDraft = Partial<Pick<SharedNote, "title" | "content" | "todos" | "position" | "size" | "color" | "archived" | "icon" | "cover">> & { projectId?: string | null };

export type NoteConflict = {
  field: keyof NoteDraft;
  base: unknown;
  local: unknown;
  remote: unknown;
};

const NOTE_FIELDS: Array<keyof NoteDraft> = ["title", "content", "todos", "position", "size", "projectId", "color", "archived", "icon", "cover"];

export function equalNoteValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeNoteDraft(server: SharedNote, draft?: NoteDraft): SharedNote {
  if (!draft) return server;
  const { projectId, ...rest } = draft;
  return projectId === null
    ? { ...server, ...rest, projectId: undefined }
    : { ...server, ...rest, ...(projectId !== undefined ? { projectId } : {}) };
}

function todoMap(value: unknown): Map<string, NoteTodo> {
  return new Map(Array.isArray(value) ? value.filter((todo): todo is NoteTodo => Boolean(todo && typeof todo.id === "string")).map((todo) => [todo.id, todo]) : []);
}

function mergeTodos(base: unknown, local: unknown, remote: unknown, prefer: "local" | "remote" = "local"): NoteTodo[] {
  const baseTodos = todoMap(base);
  const localTodos = todoMap(local);
  const remoteTodos = todoMap(remote);
  const ids = new Set([...baseTodos.keys(), ...localTodos.keys(), ...remoteTodos.keys()]);
  return [...ids].flatMap((id) => {
    const baseTodo = baseTodos.get(id);
    const localTodo = localTodos.get(id);
    const remoteTodo = remoteTodos.get(id);
    const localChanged = !equalNoteValue(baseTodo, localTodo);
    const remoteChanged = !equalNoteValue(baseTodo, remoteTodo);
    if (localChanged && !remoteChanged) return localTodo ? [localTodo] : [];
    if (remoteChanged && !localChanged) return remoteTodo ? [remoteTodo] : [];
    if (localChanged && remoteChanged) { const selected = prefer === "remote" ? remoteTodo : localTodo; return selected ? [selected] : []; }
    return localTodo ? [localTodo] : remoteTodo ? [remoteTodo] : [];
  });
}

export function noteConflictFields(
  base: SharedNote | undefined,
  draft: NoteDraft,
  remote: SharedNote,
): NoteConflict[] {
  if (!base) return [];
  return NOTE_FIELDS.flatMap((field): NoteConflict[] => {
    if (draft[field] === undefined) return [];
    if (field === "todos") {
      const baseTodos = todoMap(base.todos);
      const localTodos = todoMap(draft.todos);
      const remoteTodos = todoMap(remote.todos);
      const ids = new Set([...baseTodos.keys(), ...localTodos.keys(), ...remoteTodos.keys()]);
      const conflicting = [...ids].some((id) =>
        !equalNoteValue(baseTodos.get(id), localTodos.get(id)) &&
        !equalNoteValue(baseTodos.get(id), remoteTodos.get(id)) &&
        !equalNoteValue(localTodos.get(id), remoteTodos.get(id)),
      );
      return conflicting ? [{ field, base: base.todos, local: mergeTodos(base.todos, draft.todos, remote.todos, "local"), remote: mergeTodos(base.todos, draft.todos, remote.todos, "remote") }] : [];
    }
    const baseValue = (field === "projectId" || field === "icon" || field === "cover") ? base[field] ?? null : base[field];
    const localValue = (field === "projectId" || field === "icon" || field === "cover") ? draft[field] ?? null : draft[field];
    const remoteValue = (field === "projectId" || field === "icon" || field === "cover") ? remote[field] ?? null : remote[field];
    return !equalNoteValue(baseValue, remoteValue) && !equalNoteValue(baseValue, localValue) && !equalNoteValue(localValue, remoteValue)
      ? [{ field, base: baseValue, local: localValue, remote: remoteValue }]
      : [];
  });
}

export function mergeTodoDraft(base: SharedNote, draft: NoteDraft, remote: SharedNote): NoteDraft {
  return draft.todos === undefined ? draft : { ...draft, todos: mergeTodos(base.todos, draft.todos, remote.todos) };
}

/** Only replay actual local changes; stale no-op fields must not overwrite remote edits. */
export function rebaseNoteDraft(base: SharedNote, draft: NoteDraft, remote: SharedNote): NoteDraft {
  const next = { ...draft };
  for (const field of NOTE_FIELDS) {
    if (next[field] === undefined) continue;
    const baseValue = (field === "projectId" || field === "icon" || field === "cover") ? base[field] ?? null : base[field];
    const localValue = (field === "projectId" || field === "icon" || field === "cover") ? next[field] ?? null : next[field];
    const remoteValue = (field === "projectId" || field === "icon" || field === "cover") ? remote[field] ?? null : remote[field];
    if (equalNoteValue(localValue, baseValue) || equalNoteValue(localValue, remoteValue)) delete next[field];
  }
  return mergeTodoDraft(base, next, remote);
}

export function flushScheduledNoteSaves(
  timers: Map<string, number>,
  cancel: (timer: number) => void,
  save: (id: string) => void,
): void {
  const pending = [...timers];
  timers.clear();
  for (const [id, timer] of pending) {
    cancel(timer);
    save(id);
  }
}

export function clearSavedNoteDraft(draft: NoteDraft, patch: NoteDraft): NoteDraft {
  const next = { ...draft };
  for (const field of Object.keys(patch) as Array<keyof NoteDraft>) {
    if (equalNoteValue(next[field], patch[field])) delete next[field];
  }
  return next;
}

export function createNoteMutationId(): string {
  return createClientId();
}

export function stableNoteIdempotencyKey(noteId: string, mutationId: string): string {
  return `note-update:${noteId}:${mutationId}`;
}

export function enqueueNoteSave<T>(
  queues: Map<string, Promise<unknown>>,
  noteId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(noteId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(noteId, next);
  void next.finally(() => {
    if (queues.get(noteId) === next) queues.delete(noteId);
  }).catch(() => undefined);
  return next;
}

export type NoteSaveResponse = { status: number; note?: SharedNote; error?: string };
export type NoteSaveResult = { note: SharedNote; originalPatch: NoteDraft; conflicts: NoteConflict[] };

/** Retry identical network requests with the same key; a CAS rebase is a new mutation. */
export async function commitNoteDraft(
  base: SharedNote,
  originalPatch: NoteDraft,
  send: (patch: NoteDraft, version: number, key: string) => Promise<NoteSaveResponse>,
): Promise<NoteSaveResult> {
  let confirmed = base;
  let patch = { ...originalPatch };
  for (let rebase = 0; rebase < 3; rebase++) {
    const key = stableNoteIdempotencyKey(base.id, createNoteMutationId());
    let response: NoteSaveResponse | undefined;
    for (let retry = 0; retry < 2; retry++) {
      try { response = await send(patch, confirmed.version, key); break; }
      catch (error) { if (retry === 1) throw error; }
    }
    if (!response) throw new Error("Could not save note. Retry when connected.");
    if (response.status === 409 && response.note) {
      const conflicts = noteConflictFields(confirmed, patch, response.note);
      if (conflicts.length) return { note: response.note, originalPatch, conflicts };
      patch = rebaseNoteDraft(confirmed, patch, response.note);
      confirmed = response.note;
      if (!Object.keys(patch).length) return { note: confirmed, originalPatch, conflicts: [] };
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !response.note) throw new Error(response.error || "Could not save note.");
    return { note: response.note, originalPatch, conflicts: [] };
  }
  throw new Error("This note keeps changing. Your draft is kept; retry to save it.");
}
