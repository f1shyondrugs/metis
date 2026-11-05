"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Check, Loader2, RefreshCw, AlertCircle, Plus, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoteMedia } from "@/components/note-media";
import { NoteBannerUpload, NoteIconPicker } from "./note-appearance-controls";
import { commitNoteDraft, clearSavedNoteDraft, mergeNoteDraft, type NoteDraft } from "@/lib/note-save-state";
import { createNoteDraftPersistence } from "@/lib/note-draft-persistence";
import { registerNoteEditorFlush } from "@/lib/note-editor-lifecycle";
import { noteDisplayTitle, noteDraftStorageKey, type TreeNote } from "@/lib/notes-tree";
import { applyDocumentPatch, possibleDocumentSave, uncertainDocumentConflicts } from "@/lib/notes-document-draft";
import { cn } from "@/lib/utils";
import { parseInternalLink } from "@/lib/internal-link";

const NotesBlockEditor = dynamic(() => import("./block-editor").then(mod => mod.NotesBlockEditor), {
  ssr: false,
  loading: () => <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading editor…</div>,
});
export type NoteDocumentHandle = { flush: () => Promise<boolean> };
type Props = {
  headerOnly?: boolean;
  afterHeader?: ReactNode;
  note: TreeNote;
  ownerId: string;
  onSaved: (note: TreeNote) => void;
  onCreateSubpage: () => void;
  onOpenNote: (id: string, blockId?: string) => void;
  onOpenIssue: (id: string) => void;
  onCreateIssue: (text: string, sourceId: string, kind: "selection" | "checkbox") => Promise<{ id: string; key: string }>;
};

export const NoteDocument = forwardRef<NoteDocumentHandle, Props>(function NoteDocument({
  note, ownerId, onSaved, onCreateSubpage, onOpenNote, onOpenIssue, onCreateIssue, headerOnly = false, afterHeader,
}, ref) {
  const [document, setDocument] = useState<TreeNote>(note);
  const [status, setStatus] = useState<"saved" | "saving" | "offline" | "conflict">("saved");
  const [error, setError] = useState("");
  const [remoteConflict, setRemoteConflict] = useState<TreeNote | null>(null);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const confirmed = useRef<TreeNote>(note);
  const draft = useRef<NoteDraft>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const inFlightPatch = useRef<NoteDraft>({});
  const uncertainPatch = useRef<NoteDraft>({});
  const mounted = useRef(true);
  const blocked = useRef(false);
  const saveCallback = useRef(onSaved);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  saveCallback.current = onSaved;
  const storageKey = noteDraftStorageKey(ownerId, note.id);

  const writeLocalDraft = useCallback(() => {
    try {
      if (Object.keys(draft.current).length) localStorage.setItem(storageKey, JSON.stringify({ ownerId, base: confirmed.current, draft: draft.current, possibleSave: possibleDocumentSave(confirmed.current, uncertainPatch.current, inFlightPatch.current) }));
      else localStorage.removeItem(storageKey);
    } catch {
      if (mounted.current) setError("Browser storage is unavailable. Keep this page open until the note is saved.");
    }
  }, [ownerId, storageKey]);
  const localPersistence = useMemo(() => createNoteDraftPersistence(writeLocalDraft), [writeLocalDraft]);
  const persist = localPersistence.flush;

  const flush = useCallback(async function save(): Promise<boolean> {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    persist();
    if (blocked.current) return false;
    if (saving.current) {
      const ok = await saving.current;
      return ok && Object.keys(draft.current).length ? save() : ok;
    }
    if (!Object.keys(draft.current).length) return true;
    const task = (async () => {
      if (mounted.current) { setStatus("saving"); setError(""); }
      let outcomeUnknown = false;
      try {
        while (Object.keys(draft.current).length) {
          const patch = { ...draft.current };
          inFlightPatch.current = patch;
          persist();
          const result = await commitNoteDraft(confirmed.current, patch, async (next, version, key) => {
            try {
              const response = await fetch("/api/notes/" + encodeURIComponent(note.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Idempotency-Key": key },
                body: JSON.stringify({ ...next, version }),
              });
              const body = await response.json().catch(() => ({}));
              outcomeUnknown = response.status >= 500 || response.ok && (!body.note || body.note.id !== note.id);
              return { status: response.status, note: body.note, error: body.error };
            } catch (cause) {
              outcomeUnknown = true;
              throw cause;
            }
          });
          inFlightPatch.current = {};
          if (result.conflicts.length || uncertainDocumentConflicts(confirmed.current, patch, result.note, uncertainPatch.current).length) {
            blocked.current = true;
            persist();
            if (mounted.current) { setRemoteConflict(result.note); setStatus("conflict"); setError("This file was changed elsewhere. Choose which version to keep."); }
            return false;
          }
          uncertainPatch.current = {};
          draft.current = clearSavedNoteDraft(draft.current, patch);
          confirmed.current = result.note;
          persist();
          if (mounted.current) {
            setDocument(mergeNoteDraft(result.note, draft.current));
            saveCallback.current(result.note);
          }
        }
        if (mounted.current) setStatus("saved");
        return true;
      } catch (cause) {
        if (outcomeUnknown) uncertainPatch.current = possibleDocumentSave(confirmed.current, uncertainPatch.current, inFlightPatch.current);
        inFlightPatch.current = {};
        persist();
        if (mounted.current) { setStatus("offline"); setError(cause instanceof Error ? cause.message : "Could not save. Your draft is kept in this browser."); }
        return false;
      }
    })();
    saving.current = task;
    try { return await task; } finally { saving.current = null; inFlightPatch.current = {}; }
  }, [note.id, persist]);
  flushRef.current = flush;
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const update = useCallback((patch: NoteDraft) => {
    draft.current = applyDocumentPatch(confirmed.current, draft.current, patch, possibleDocumentSave(confirmed.current, uncertainPatch.current, inFlightPatch.current));
    setDocument(mergeNoteDraft(confirmed.current, draft.current));
    localPersistence.schedule();
    if (!blocked.current) setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 650);
  }, [localPersistence]);

  useEffect(() => {
    mounted.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as { ownerId: string; base: TreeNote; draft: NoteDraft; possibleSave?: NoteDraft } | null;
      if (stored?.ownerId === ownerId && stored.base?.id === note.id && stored.draft && typeof stored.draft === "object") {
        confirmed.current = stored.base;
        draft.current = stored.draft;
        uncertainPatch.current = stored.possibleSave || {};
        setDocument(mergeNoteDraft(stored.base, stored.draft));
        void flushRef.current();
      }
    } catch { setError("A saved local draft could not be read. It has not been overwritten."); }
    const unregister = registerNoteEditorFlush(() => flushRef.current());
    const online = () => { void flushRef.current(); };
    const unload = (event: BeforeUnloadEvent) => {
      persist();
      if (Object.keys(draft.current).length) { event.preventDefault(); event.returnValue = ""; }
    };
    const hidden = () => { if (globalThis.document.visibilityState === "hidden") persist(); };
    globalThis.document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", persist);
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", unload);
    return () => {
      persist();
      void flushRef.current();
      mounted.current = false;
      unregister();
      globalThis.document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", unload);
      if (timer.current) clearTimeout(timer.current);
    };
    // A document instance is keyed by account and note ID in the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (note.version < confirmed.current.version || blocked.current || Object.keys(draft.current).length) return;
    confirmed.current = note;
    setDocument(note);
  }, [note]);

  async function makeIssue(text: string, sourceId?: string, kind: "selection" | "checkbox" = "selection") {
    if (!text.trim() || creatingIssue) return;
    setCreatingIssue(true);
    try {
      if (!(await flushRef.current())) throw new Error("Save or resolve this file before creating an issue.");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
      const issue = await onCreateIssue(text, sourceId || "selection:" + hash, kind);
      if (kind === "checkbox" && !sourceId?.startsWith("todo:")) return issue;
      const current = mergeNoteDraft(confirmed.current, draft.current);
      const reference = "[" + issue.key + "](issue://" + issue.id + ")";
      const legacyId = sourceId?.startsWith("todo:") ? sourceId.slice(5) : null;
      update({
        content: current.content.includes("(issue://" + issue.id + ")") ? current.content : current.content + "\n\n" + reference + "\n",
        ...(legacyId ? { todos: (current.todos || []).filter(todo => todo.id !== legacyId || todo.content !== text) } : {}),
      });
      await flushRef.current();
      return issue;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create issue."); }
    finally { setCreatingIssue(false); }
  }

  const todos = document.todos || [];
  const issuePage = document.kind === "issuebook" || Boolean(document.issueId);
  return <article
    className={cn("w-full pt-7 sm:pt-10", headerOnly ? "pb-0" : "pb-24", issuePage ? "max-w-none px-4 sm:px-6" : cn("mx-auto px-5 sm:px-10", document.fullWidth ? "max-w-none" : "max-w-[920px]"))}
    data-note-document={note.id}
    onClick={event => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      const href = anchor?.getAttribute("href") || "";
      const target = parseInternalLink(href);
      if (!target || (target.kind !== "note" && target.kind !== "issue")) return;
      event.preventDefault();
      persist();
      if (target.kind === "note") onOpenNote(target.id, target.blockId);
      else onOpenIssue(target.id);
    }}
  >
    {document.cover && <div className="relative mb-7 h-36 overflow-hidden rounded-lg bg-muted"><Image src={document.cover} alt="Page banner" fill unoptimized sizes="100vw" className="object-cover" /></div>}
    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1" aria-label={document.issueId ? "Issue appearance" : "Note appearance"}>
        <NoteIconPicker value={document.icon} onChange={icon => update({ icon })} />
        <NoteBannerUpload noteId={note.id} value={document.cover} onChange={cover => update({ cover })} />
      </div>
      <span className="flex items-center gap-1.5" role="status">
        {status === "saving" ? <Loader2 className="size-3 animate-spin" /> : status === "saved" ? <Check className="size-3" /> : <AlertCircle className="size-3" />}
        {status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "conflict" ? "Conflict" : "Draft kept locally"}
      </span>
    </div>
    <input
      aria-label="File title" value={noteDisplayTitle(document.title)} placeholder="Untitled" maxLength={document.issueId ? 300 : 200}
      onChange={event => update({ title: noteDisplayTitle(event.target.value) })}
      className="mb-6 w-full border-0 bg-transparent text-3xl font-semibold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl"
    />
    {error && <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p>{error}</p>
      {remoteConflict ? <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => {
          confirmed.current = remoteConflict;
          uncertainPatch.current = {};
          blocked.current = false;
          setRemoteConflict(null);
          persist();
          void flushRef.current();
        }}>Keep my draft</Button>
        <Button variant="outline" size="sm" onClick={() => {
          confirmed.current = remoteConflict;
          draft.current = {};
          uncertainPatch.current = {};
          blocked.current = false;
          setDocument(remoteConflict);
          saveCallback.current(remoteConflict);
          setRemoteConflict(null);
          setError("");
          setStatus("saved");
          persist();
        }}>Use saved version</Button>
      </div> : <Button className="mt-2" variant="outline" size="sm" onClick={() => void flushRef.current()}><RefreshCw className="size-3" />Retry save</Button>}
    </div>}
    {afterHeader}
    {!headerOnly && <>
    {document.asset && <div className="mb-5"><NoteMedia note={document} /></div>}
    {todos.length > 0 && <section aria-label="Checklist" className="mb-6 border-b border-border pb-5">
      {todos.map(todo => <div key={todo.id} className="group flex min-h-10 items-center gap-2">
        <input type="checkbox" aria-label={todo.content} checked={todo.status === "completed"} onChange={event => update({ todos: todos.map(item => item.id === todo.id ? { ...item, status: event.target.checked ? "completed" : "pending" } : item) })} />
        <span className={cn("min-w-0 flex-1 text-sm", todo.status === "completed" && "text-muted-foreground line-through")}>{todo.content}</span>
        <Button variant="ghost" size="sm" disabled={creatingIssue} aria-label={"Create issue from " + todo.content} onClick={() => void makeIssue(todo.content, "todo:" + todo.id, "checkbox")}><ListTodo className="size-3.5" /><span className="hidden sm:inline">Create issue</span></Button>
      </div>)}
    </section>}
    <NotesBlockEditor
      maxLength={document.issueId ? 100_000 : 50_000}
      value={document.content}
      onChange={content => update({ content })}
      noteId={note.id}
      onCreateSubpage={() => { persist(); onCreateSubpage(); }}
      onCreateIssue={(text, context) => makeIssue(text, context?.sourceId, context?.kind)}
      onOpenNote={(id, blockId) => { persist(); onOpenNote(id, blockId); }}
    />
    <Button variant="ghost" size="sm" className="mt-8 text-muted-foreground" onClick={() => { persist(); onCreateSubpage(); }}><Plus className="size-3.5" />Add subfile</Button>
    </>}
  </article>;
});
