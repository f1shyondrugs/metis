"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Plus, Search, MoreHorizontal, ArrowUp, ArrowDown, PanelLeft, Upload, Download, Star, Clock, Trash2, Pin, Copy, Move, Settings2, FilePlus2, ListTodo, Loader2, RotateCcw, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NotePinDialog } from "@/components/note-pin-dialog";
import { NoteShareDialog } from "./note-share-dialog";
import { ProjectIconGlyph } from "@/components/project-avatar";
import { projectLogoSrc } from "@/lib/project-constants";
import type { Project } from "@/lib/store";
import { NoteDocument, type NoteDocumentHandle } from "./note-document";
import { NoteBannerUpload, NoteIconPicker } from "./note-appearance-controls";
import { BannerImage } from "@/components/banner-image";
import { NoteIcon } from "./note-icon";
import { IssuesView, IssueFileProperties } from "./issues-view";
import { buildNoteTree, noteAncestors, noteDescendantIds, noteDisplayTitle, notesInContainer, searchNoteTree, type NoteTreeNode, type TreeNote } from "@/lib/notes-tree";
import { cn } from "@/lib/utils";
import { notesNavigationTarget, subscribeNotesHashNavigation, type NotesNavigationTarget } from "@/lib/notes-navigation";

type ProjectOption = Pick<Project, "id" | "name" | "icon" | "color" | "logoStoredName" | "updatedAt">;
type WorkspaceProps = { initialProjectId?: string | null; focusNoteId?: string | null; embedded?: boolean; active?: boolean };
type Mode = "files" | "favorites" | "recent" | "trash";
const scopeKey = (id: string | null) => id || "none";
const label = (note: TreeNote) => noteDisplayTitle(note.title) || "Untitled";
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

export function NotesWorkspace({ initialProjectId = null, focusNoteId, embedded = false, active = true }: WorkspaceProps) {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [cache, setCache] = useState<Record<string, TreeNote[]>>({});
  const [ownerId, setOwnerId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("files");
  const [creation, setCreation] = useState<{parentId:string|null;kind:"note"|"issuebook";title:string}|null>(null);
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [pinNote, setPinNote] = useState<TreeNote | null>(null);
  const [shareNote, setShareNote] = useState<TreeNote | null>(null);
  const [moveNote, setMoveNote] = useState<TreeNote | null>(null);
  const [moveProject, setMoveProject] = useState<string | null>(null);
  const [moveParent, setMoveParent] = useState("");
  const [moveChoices, setMoveChoices] = useState<TreeNote[]>([]);
  const [appearance, setAppearance] = useState(false);
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");
  const [fullWidth, setFullWidth] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<{ noteId: string; blockId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "inside" | "after" } | null>(null);
  const doc = useRef<NoteDocumentHandle>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const loadSerial = useRef(0);
  const navigationSerial = useRef(0);
  const notes = useMemo(() => cache[scopeKey(projectId)] || [], [cache, projectId]);
  const selected = notes.find(note => note.id === selectedId) || null;
  const activeNotes = notes.filter(note => !note.archived);
  const containerName = projectId ? projects.find(project => project.id === projectId)?.name || "Project" : "No Project";

  const load = useCallback(async (container: string | null, background = false) => {
    const serial = ++loadSerial.current;
    if (!background) setLoading(true);
    try {
      const body = await json<{ notes: TreeNote[]; ownerId?: string }>("/api/notes?includeArchived=true&projectId=" + encodeURIComponent(scopeKey(container)));
      if (serial !== loadSerial.current) return;
      const scoped = notesInContainer(body.notes, container);
      setCache(current => {
        const previous = new Map((current[scopeKey(container)] || []).map(note => [note.id, note]));
        return { ...current, [scopeKey(container)]: scoped.map(note => {
          const newer = previous.get(note.id);
          return newer && newer.version > note.version ? newer : note;
        }) };
      });
      if (body.ownerId) setOwnerId(body.ownerId);
      setError("");
    } catch (cause) {
      if (serial === loadSerial.current) setError(cause instanceof Error ? cause.message : "Could not load files.");
    } finally {
      if (serial === loadSerial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    json<{ projects: ProjectOption[] }>("/api/projects").then(body => { if (active) setProjects(body.projects); }).catch(cause => { if (active) setError(cause.message); });
    const refresh = () => { void json<{ projects: ProjectOption[] }>("/api/projects").then(body => { if (active) setProjects(body.projects); }); };
    window.addEventListener("metis:projects-changed", refresh);
    return () => { active = false; window.removeEventListener("metis:projects-changed", refresh); };
  }, []);
  useEffect(() => { void load(projectId); }, [load, projectId]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(projectId, true); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("ai-chat:notes-updated", refresh);
    window.addEventListener("metis:notes-changed", refresh);
    window.addEventListener("metis-issues-changed", refresh);
    return () => { clearInterval(timer); window.removeEventListener("ai-chat:notes-updated", refresh); window.removeEventListener("metis:notes-changed", refresh); window.removeEventListener("metis-issues-changed", refresh); };
  }, [active, load, projectId]);
  useEffect(() => {
    if (!ownerId) return;
    try { setRecent(JSON.parse(localStorage.getItem("metis:notes:recent:" + ownerId) || "[]")); } catch { setRecent([]); }
  }, [ownerId]);

  const flush = useCallback(async () => (await doc.current?.flush()) ?? true, []);
  const openNote = useCallback(async (id: string, blockId?: string) => {
    const serial = ++navigationSerial.current;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    try {
      const { note } = await json<{ note: TreeNote }>("/api/notes/" + encodeURIComponent(id));
      if (serial !== navigationSerial.current) return;
      const container = note.projectId || null;
      setProjectId(container);
      setCache(current => {
        const existing = current[scopeKey(container)] || [];
        return { ...current, [scopeKey(container)]: [...existing.filter(item => item.id !== id), note] };
      });
      setPendingBlock(blockId ? { noteId: id, blockId } : null);
      setSelectedId(id); setMode(note.archived ? "trash" : "files"); setSidebar(false);
      setRecent(current => {
        const next = [id, ...current.filter(item => item !== id)].slice(0, 30);
        if (ownerId) try { localStorage.setItem("metis:notes:recent:" + ownerId, JSON.stringify(next)); } catch {}
        return next;
      });
      setError("");
      if (!embedded) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + "#note-" + encodeURIComponent(id) + (blockId ? "/block-" + encodeURIComponent(blockId) : ""));
    } catch (cause) { if (serial === navigationSerial.current) setError(cause instanceof Error ? cause.message : "Could not open file."); }
  }, [embedded, flush, ownerId]);

  const openIssue = useCallback(async (id: string) => {
    const serial = ++navigationSerial.current;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    try {
      const { issue } = await json<{ issue: { id: string; noteId: string; projectId: string | null } }>("/api/issues/" + encodeURIComponent(id));
      if (serial !== navigationSerial.current) return;
      await openNote(issue.noteId);
      setError("");
    } catch (cause) { if (serial === navigationSerial.current) setError(cause instanceof Error ? cause.message : "Could not open issue."); }
  }, [flush, openNote]);

  const navigationCallbacks = useRef({ openNote, openIssue });
  navigationCallbacks.current = { openNote, openIssue };
  useEffect(() => {
    if (embedded || !active) return;
    const navigate = (target: NotesNavigationTarget) => {
      if (target.kind === "issue") void navigationCallbacks.current.openIssue(target.id);
      else void navigationCallbacks.current.openNote(target.id, target.blockId);
    };
    const initial = notesNavigationTarget(window.location.hash, focusNoteId);
    if (initial) navigate(initial);
    // Fragment and Back/Forward navigation can preserve this component instance.
    return subscribeNotesHashNavigation(window, navigate);
  }, [active, embedded, focusNoteId]);
  useEffect(() => {
    if (embedded || !active) return;
    const focusSearch = () => { setSidebar(true); searchInput.current?.focus(); };
    const openLinkedNote = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; blockId?: string }>).detail;
      if (detail?.id) void openNote(detail.id, detail.blockId);
    };
    const openLinkedIssue = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) void openIssue(id);
    };
    window.addEventListener("ai-chat:focus-notes-search", focusSearch);
    window.addEventListener("ai-chat:open-issue", openLinkedIssue);
    window.addEventListener("ai-chat:open-note", openLinkedNote);
    window.addEventListener("metis:open-note-block", openLinkedNote);
    return () => { window.removeEventListener("ai-chat:focus-notes-search", focusSearch); window.removeEventListener("ai-chat:open-issue", openLinkedIssue); window.removeEventListener("ai-chat:open-note", openLinkedNote); window.removeEventListener("metis:open-note-block", openLinkedNote); };
  }, [active, embedded, openIssue, openNote]);
  useEffect(() => {
    if (!pendingBlock || selectedId !== pendingBlock.noteId) return;
    const focus = () => {
      const container = document.querySelector(`[data-note-document="${CSS.escape(pendingBlock.noteId)}"]`);
      const block = container?.querySelector(`[data-block-id="${CSS.escape(pendingBlock.blockId)}"]`);
      if (!block) return false;
      block.scrollIntoView({ block: "center", behavior: "smooth" });
      setPendingBlock(null);
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-block-id"] });
    const timer = window.setTimeout(() => observer.disconnect(), 30000);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [pendingBlock, selectedId]);

  async function switchContainer(id: string | null) {
    const serial = ++navigationSerial.current;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    setSelectedId(null); setProjectId(id); setQuery(""); setMode("files");
  }
  function saved(note: TreeNote) {
    ++loadSerial.current;
    setLoading(false);
    const key = scopeKey(note.projectId || null);
    setCache(current => ({ ...current, [key]: (current[key] || []).map(item => item.id === note.id ? note : item) }));
  }
  async function createFile(parentId: string | null = null, input?: { title?: string; content?: string; kind?:"note"|"issuebook" }) {
    const serial = ++navigationSerial.current;
    const container = projectId;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    setWorking(true);
    try {
      const parent=notes.find(note=>note.id===parentId);
      let note:TreeNote;
      if(parent?.kind==="issuebook"&&input?.kind!=="issuebook") {
        const {issue}=await json<{issue:{noteId:string}}>("/api/issues",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({projectId:container,issuebookId:parentId,title:input?.title||"Untitled issue",description:input?.content||"",status:"todo"})});
        note=(await json<{note:TreeNote}>("/api/notes/"+issue.noteId)).note;
      } else {
        ({note}=await json<{ note: TreeNote }>("/api/notes", {
          method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ title: input?.title || (input?.kind==="issuebook"?"Untitled issuebook":"Untitled"), content: input?.content || "", kind: input?.kind || "note", scope: "global", projectId: container, parentId }),
        }));
      }
      const key = scopeKey(note.projectId || null);
      setCache(current => ({ ...current, [key]: [...current[key] || [], note] }));
      if (serial !== navigationSerial.current) return;
      if (parentId) setExpanded(current => new Set([...current, parentId]));
      setSelectedId(note.id); setMode("files"); setSidebar(false); setCreation(null); setError("");
      if (!embedded) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + "#note-" + encodeURIComponent(note.id));
    } catch (cause) { if (serial === navigationSerial.current) setError(cause instanceof Error ? cause.message : "Could not create file."); }
    finally { setWorking(false); }
  }
  async function patch(note: TreeNote, fields: Record<string, unknown>) {
    if (!(await flush())) return;
    const current = await json<{ note: TreeNote }>("/api/notes/" + encodeURIComponent(note.id));
    const body = await json<{ note: TreeNote }>("/api/notes/" + encodeURIComponent(note.id), {
      method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ ...fields, version: current.note.version }),
    });
    saved(body.note);
    return body.note;
  }
  async function archive(note: TreeNote, archived: boolean) {
    setWorking(true);
    try {
      if (!await patch(note, { archived })) return;
      if (selectedId && noteDescendantIds(notes, note.id).has(selectedId)) setSelectedId(null);
      await load(projectId); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update file."); }
    finally { setWorking(false); }
  }
  async function duplicate(note: TreeNote) {
    const serial = ++navigationSerial.current;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    setWorking(true);
    try {
      const current = await json<{ note: TreeNote }>("/api/notes/" + encodeURIComponent(note.id));
      const body = await json<{ notes: TreeNote[]; rootId: string }>("/api/notes/" + encodeURIComponent(note.id) + "/duplicate", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ version: current.note.version }),
      });
      const key = scopeKey(note.projectId || null);
      setCache(cache => ({ ...cache, [key]: [...cache[key] || [], ...body.notes] }));
      if (serial === navigationSerial.current) await openNote(body.rootId);
    } catch (cause) {
      if (serial === navigationSerial.current) setError(cause instanceof Error ? cause.message : "Could not duplicate file.");
    } finally { setWorking(false); }
  }
  async function fetchMoveChoices(id: string | null) {
    const body = await json<{ notes: TreeNote[] }>("/api/notes?projectId=" + encodeURIComponent(scopeKey(id)));
    setMoveChoices(notesInContainer(body.notes, id));
  }
  async function showMove(note: TreeNote, destination = note.projectId || null, parent = note.parentId || "") {
    if (!(await flush())) return;
    setMoveNote(note); setMoveProject(destination); setMoveParent(parent);
    try { await fetchMoveChoices(destination); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load destination."); }
  }
  async function move(note: TreeNote, destination: string | null, parent: string | null, position?: { beforeId?: string; afterId?: string }) {
    const serial = ++navigationSerial.current;
    if (!(await flush()) || serial !== navigationSerial.current) return;
    setWorking(true);
    try {
      const current = await json<{ note: TreeNote }>("/api/notes/" + encodeURIComponent(note.id));
      await json("/api/notes/" + encodeURIComponent(note.id) + "/move", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: destination, parentId: parent, ...position, version: current.note.version }),
      });
      setMoveNote(null);
      if (serial !== navigationSerial.current) {
        window.dispatchEvent(new Event("metis:notes-changed"));
        return;
      }
      setProjectId(destination);
      await load(destination);
      if (parent) setExpanded(old => new Set([...old, parent]));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not move file."); }
    finally { setWorking(false); }
  }
  function drop(event: DragEvent, destination: string | null, parent: string | null, position?: { beforeId?: string; afterId?: string }) {
    event.preventDefault(); event.stopPropagation();
    setDropTarget(null);
    const id = event.dataTransfer.getData("application/metis-note");
    const note = Object.values(cache).flat().find(item => item.id === id);
    if (!note || note.id === parent) return;
    if ((note.projectId || null) !== destination) void showMove(note, destination, parent || "");
    else void move(note, destination, parent, position);
  }
  function reorder(note: TreeNote, direction: -1 | 1) {
    const siblings = buildNoteTree(activeNotes.filter(item => (item.parentId || null) === (note.parentId || null))).map(node => node.note);
    const index = siblings.findIndex(item => item.id === note.id);
    const anchor = siblings[index + direction];
    if (anchor) void move(note, note.projectId || null, note.parentId || null, direction < 0 ? { beforeId: anchor.id } : { afterId: anchor.id });
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length || !(await flush())) return;
    setWorking(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("file", file); form.set("projectId", scopeKey(projectId));
        if (selectedId) form.set("parentId", selectedId);
        await json("/api/notes/import", { method: "POST", body: form });
      }
      await load(projectId); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import files."); }
    finally { setWorking(false); if (importInput.current) importInput.current.value = ""; }
  }
  async function createIssue(text: string, sourceId: string, kind: "selection" | "checkbox") {
    if (!selectedId) throw new Error("Open a file first.");
    const body = await json<{ issue: { id: string; key?: string; identifier?: string } }>("/api/issues", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ projectId, issuebookId: selected?.issueId ? selected.parentId : undefined, title: text.split("\n")[0].slice(0, 200), description: text, source: { noteId: selectedId, sourceId, kind, excerpt: text } }),
    });
    void load(projectId, true);
    return { id: body.issue.id, key: body.issue.key || body.issue.identifier || "Issue" };
  }

  const baseTree = useMemo(() => {
    let files = notes.filter(note => mode === "trash" ? note.archived : !note.archived);
    if (mode === "favorites") files = files.filter(note => note.favorite);
    if (mode === "recent") files = recent.map(id => files.find(note => note.id === id)).filter((note): note is TreeNote => Boolean(note));
    return searchNoteTree(buildNoteTree(files), query);
  }, [notes, mode, recent, query]);
  useEffect(() => {
    if (!selectedId) return;
    const ancestors = noteAncestors(notes, selectedId).slice(0, -1).map(note => note.id);
    setExpanded(current => ancestors.every(id => current.has(id)) ? current : new Set([...current, ...ancestors]));
  }, [notes, selectedId]);
  const crumbs = selected ? noteAncestors(notes, selected.id) : [];
  const subfiles = selected ? buildNoteTree(activeNotes.filter(note => note.parentId === selected.id)).map(node => node.note) : [];
  const backlinks = selected ? activeNotes.filter(note => note.id !== selected.id && note.content.includes("note://" + selected.id)) : [];
  const forbiddenMoveParents = moveNote ? noteDescendantIds(notes, moveNote.id) : new Set<string>();

  function nodeView(node: NoteTreeNode, depth = 0) {
    const { note, children } = node;
    const isOpen = query ? true : expanded.has(note.id);
    return <div key={note.id} role="treeitem" aria-selected={selectedId === note.id} aria-expanded={children.length ? isOpen : undefined}>
      <div
        className={cn("group relative flex min-h-10 items-center rounded-md pr-1 text-sm hover:bg-muted/70", selectedId === note.id && "bg-muted text-foreground", dropTarget?.id === note.id && (dropTarget.position === "inside" ? "ring-1 ring-primary bg-primary/10" : dropTarget.position === "before" ? "before:absolute before:inset-x-0 before:top-0 before:border-t-2 before:border-primary" : "after:absolute after:inset-x-0 after:bottom-0 after:border-b-2 after:border-primary"))}
        style={{ paddingLeft: Math.min(depth, 12) * 15 + 3 }}
        draggable={mode !== "trash"}
        onDragStart={event => { event.dataTransfer.setData("application/metis-note", note.id); event.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => setDropTarget(null)}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current?.id === note.id ? null : current); }}
        onDragOver={event => {
          if (mode === "trash" || !event.dataTransfer.types.includes("application/metis-note")) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const fraction = (event.clientY - rect.top) / rect.height;
          setDropTarget({ id: note.id, position: fraction < .25 ? "before" : fraction > .75 ? "after" : "inside" });
        }}
        onDrop={event => {
          const position = dropTarget?.id === note.id ? dropTarget.position : "inside";
          drop(event, note.projectId || null, position === "inside" ? note.id : note.parentId || null, position === "before" ? { beforeId: note.id } : position === "after" ? { afterId: note.id } : undefined);
        }}
        onKeyDown={event => {
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && mode !== "trash") { event.preventDefault(); reorder(note, event.key === "ArrowUp" ? -1 : 1); return; }
          if (event.key === "ArrowRight") { setExpanded(old => new Set([...old, note.id])); event.preventDefault(); }
          if (event.key === "ArrowLeft") { setExpanded(old => { const next = new Set(old); next.delete(note.id); return next; }); event.preventDefault(); }
        }}
      >
        <button type="button" aria-label={(isOpen ? "Collapse " : "Expand ") + label(note)} disabled={!children.length} className="flex size-7 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-0" onClick={() => setExpanded(old => { const next = new Set(old); if (next.has(note.id)) next.delete(note.id); else next.add(note.id); return next; })}>{isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => void openNote(note.id)}>
          {note.icon ? <NoteIcon value={note.icon} className="size-3.5" /> : note.kind==="issuebook" ? <ListTodo className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate">{label(note)}</span>
          {note.favorite && <Star className="size-3 shrink-0 text-amber-500" />}
        </button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={"Actions for " + label(note)} className="flex size-7 items-center justify-center text-muted-foreground opacity-70 group-hover:opacity-100"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {note.archived ? <DropdownMenuItem onClick={() => void archive(note, false)}><RotateCcw className="size-4" />Restore file and subfiles</DropdownMenuItem> : <>
              <DropdownMenuItem onClick={() => { void openNote(note.id).then(() => setCreation({parentId:note.id,kind:"note",title:""})); }}><FilePlus2 className="size-4" />{note.kind==="issuebook"?"Add issue":"Add subfile"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void duplicate(note)}><Copy className="size-4" />Duplicate tree</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void showMove(note)}><Move className="size-4" />Move…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => reorder(note, -1)}><ArrowUp className="size-4" />Move up<span className="ml-auto text-xs text-muted-foreground">Alt ↑</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => reorder(note, 1)}><ArrowDown className="size-4" />Move down<span className="ml-auto text-xs text-muted-foreground">Alt ↓</span></DropdownMenuItem>
              <DropdownMenuItem onClick={() => { void patch(note, { favorite: !note.favorite }).catch(cause => setError(cause.message)); }}><Star className="size-4" />{note.favorite ? "Remove favorite" : "Add favorite"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { void flush().then(ok=>{if(ok)setShareNote(note);}); }}><Share2 className="size-4" />Share tree…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPinNote(note)}><Pin className="size-4" />Pin in chats…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => void archive(note, true)}><Trash2 className="size-4" />Move tree to trash</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isOpen && children.length > 0 && <div role="group">{children.map(child => nodeView(child, depth + 1))}</div>}
    </div>;
  }

  return <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-background" data-notes-workspace data-embedded={embedded || undefined}>
    {sidebar && <button type="button" className={cn("absolute inset-0 z-20 bg-black/40", !embedded && "lg:hidden")} aria-label="Close file browser" onClick={() => setSidebar(false)} />}
    <aside aria-label="Notes file browser" className={cn("absolute inset-y-0 left-0 z-30 w-[280px] max-w-full shrink-0 flex-col border-r border-border bg-background", !embedded && "lg:relative lg:z-0 lg:flex lg:w-[260px]", sidebar ? "flex" : "hidden")}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium">Files</span>
        <div className="flex items-center gap-0.5"><Button variant="ghost" size="icon" className="size-8" aria-label="New root file" disabled={working} onClick={() => setCreation({parentId:null,kind:"note",title:""})}><Plus className="size-4" /></Button><Button variant="ghost" size="icon" className={cn("size-8", !embedded && "lg:hidden")} aria-label="Close file browser" onClick={() => setSidebar(false)}><X className="size-4" /></Button></div>
      </div>
      <div className="relative mx-3 my-3"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this file tree…" aria-label="Search files" className="h-9 pl-8 text-xs" /></div>
      <div className="mb-2 flex items-center gap-0.5 px-2" role="tablist" aria-label="File views">
        {([{ id: "files", title: "Files", icon: FileText }, { id: "favorites", title: "Favorites", icon: Star }, { id: "recent", title: "Recent", icon: Clock }, { id: "trash", title: "Trash", icon: Trash2 }] as const).map(view => <button key={view.id} role="tab" aria-selected={mode === view.id} title={view.title} onClick={() => { setMode(view.id); }} className={cn("flex min-h-9 flex-1 items-center justify-center rounded-md text-muted-foreground hover:bg-muted", mode === view.id && "bg-muted text-foreground")}><view.icon className="size-3.5" /><span className="sr-only">{view.title}</span></button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3" role="tree" aria-label="Project file trees">
        {[{ id: null, name: "No Project" }, ...projects].map(project => {
          const active = projectId === project.id;
          return <div key={scopeKey(project.id)} role="treeitem" aria-expanded={active}>
            <button type="button" className={cn("mt-1 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm", active ? "font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50")} aria-label={"Open " + project.name + " file tree"} aria-pressed={active} onClick={() => void switchContainer(project.id)} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, project.id, null)}>{active ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{project.id ? project.logoStoredName ? (
              <Image src={projectLogoSrc(project.id, project.updatedAt)} alt="" width={16} height={16} unoptimized className="size-4 shrink-0 rounded-sm object-cover" />
            ) : (
              <span className="inline-flex size-4 shrink-0" style={{ color: project.color }}>
                <ProjectIconGlyph icon={project.icon} className="size-4" />
              </span>
            ) : <FolderOpen className="size-4 shrink-0" />}<span className="truncate">{project.name}</span></button>
            {active && <div role="group" className="ml-3 border-l border-border/60 pl-1">
              {loading ? <div role="status" className="flex items-center gap-2 px-3 py-5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading files…</div> : baseTree.length ? baseTree.map(node => nodeView(node)) : <div className="px-3 py-5 text-xs leading-relaxed text-muted-foreground">{query ? "No files match your search." : mode === "trash" ? "Trash is empty." : mode === "favorites" ? "Star a file to keep it here." : mode === "recent" ? "Open a file to find it here later." : "No files yet. Create your first Markdown file."}</div>}
            </div>}
          </div>;
        })}
      </div>
      <div className="flex shrink-0 gap-1 border-t border-border p-2">
        <Button variant="ghost" size="sm" className="flex-1 text-xs" disabled={working} onClick={() => importInput.current?.click()}><Upload className="size-3.5" />Import</Button>
        <Button asChild variant="ghost" size="sm" className="flex-1 text-xs"><a href={"/api/notes/export?projectId=" + encodeURIComponent(scopeKey(projectId))} download><Download className="size-3.5" />Export</a></Button>
        <input ref={importInput} type="file" accept=".md,.zip,text/markdown,application/zip" multiple hidden aria-label="Import Markdown files or project archive" onChange={event => { void importFiles(event.target.files); }} />
      </div>
    </aside>
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <Button variant="ghost" size="icon" aria-label="Open file browser" className={cn("size-9", !embedded && "lg:hidden")} onClick={() => setSidebar(true)}><PanelLeft className="size-4" /></Button>
        <div className="min-w-0 flex-1 overflow-hidden text-sm text-muted-foreground">
          <button className="max-w-[150px] truncate align-middle hover:text-foreground" onClick={() => { void flush().then(ok => { if (ok) setSelectedId(null); }); }}>{containerName}</button>
          {crumbs.map((note, index) => <span key={note.id}><ChevronRight className="mx-1 inline size-3 align-middle" /><button className={cn("max-w-[160px] truncate align-middle hover:text-foreground", index === crumbs.length - 1 && "text-foreground")} onClick={() => void openNote(note.id)}>{label(note)}</button></span>)}
        </div>
        {selected && !selected.archived && <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" aria-label="Share note tree" onClick={()=>{void flush().then(ok=>{if(ok)setShareNote(selected);});}}><Share2 className="size-3.5"/><span className="hidden sm:inline">Share</span></Button>}
        {selected && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="File options"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setIcon(selected.icon || ""); setCover(selected.cover || ""); setFullWidth(Boolean(selected.fullWidth)); setAppearance(true); }}><Settings2 className="size-4" />Page appearance…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPinNote(selected)}><Pin className="size-4" />Pin in chats…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(window.location.origin + "/?c=notes#note-" + selected.id).catch(() => setError("Could not copy link.")); }}><Copy className="size-4" />Copy file link</DropdownMenuItem>
          <DropdownMenuItem asChild><a href={"/api/notes/" + selected.id + "/export"} download><Download className="size-4" />Download Markdown</a></DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>}
      </header>
      {error && <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"><span className="min-w-0 flex-1">{error}</span><Button variant="outline" size="sm" onClick={() => void load(projectId)}>Retry</Button><Button variant="ghost" size="icon" className="size-7" aria-label="Dismiss error" onClick={() => setError("")}><X className="size-3.5" /></Button></div>}
      {working && <div role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Saving changes…</div>}
      {selected?.kind==="issuebook"&&!selected.archived && ownerId ? <div className="min-h-0 flex-1 overflow-y-auto">
        <NoteDocument key={ownerId + ":" + selected.id} ref={doc} note={selected} ownerId={ownerId} headerOnly onSaved={saved} onCreateSubpage={() => setCreation({parentId:selected.id,kind:"note",title:""})} onOpenNote={(id, blockId) => { void openNote(id, blockId); }} onOpenIssue={id => { void openIssue(id); }} onCreateIssue={createIssue} />
        <IssuesView className="h-auto min-h-[24rem]" key={selected.id} projectId={projectId} issuebookId={selected.id} onOpenNote={id=>{void openNote(id);}} onOpenDocument={id=>{void openNote(id);}}/>
      </div> : <div className="min-h-0 flex-1 overflow-y-auto">
        {selected && ownerId ? <>
          {selected.archived && <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3 text-sm"><span>This file is in trash.</span><Button variant="outline" size="sm" onClick={() => void archive(selected, false)}><RotateCcw className="size-3.5" />Restore</Button></div>}
          <NoteDocument key={ownerId + ":" + selected.id} ref={doc} note={selected} ownerId={ownerId} afterHeader={selected.issueId ? <IssueFileProperties key={selected.id} issueId={selected.issueId} projectId={projectId} onOpenNote={id=>{void openNote(id);}} onBeforeChange={flush} onChanged={()=>{void load(projectId,true);}}/> : undefined} onSaved={saved} onCreateSubpage={() => { setCreation({parentId:selected.id,kind:"note",title:""}); }} onOpenNote={(id, blockId) => { void openNote(id, blockId); }} onOpenIssue={id => { void openIssue(id); }} onCreateIssue={createIssue} />
          {subfiles.length > 0 && <section aria-label="Subfiles" className={cn("mb-8 border-t border-border py-5", selected.issueId || selected.kind === "issuebook" ? "w-full px-4 sm:px-6" : "mx-auto max-w-[920px] px-5 sm:px-10")}><h3 className="mb-2 text-xs font-medium text-muted-foreground">Subfiles</h3><div className="grid gap-1">{subfiles.map(note => <button key={note.id} onClick={() => void openNote(note.id)} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"><FileText className="size-4 text-muted-foreground" />{label(note)}</button>)}</div></section>}
          {backlinks.length > 0 && <section className={cn("mb-12 border-t border-border py-5", selected.issueId || selected.kind === "issuebook" ? "w-full px-4 sm:px-6" : "mx-auto max-w-[920px] px-5 sm:px-10")}><h3 className="mb-2 text-xs font-medium text-muted-foreground">Linked from</h3>{backlinks.map(note => <button className="mr-3 text-sm underline underline-offset-4" key={note.id} onClick={() => void openNote(note.id)}>{label(note)}</button>)}</section>}
        </> : <div className="mx-auto flex min-h-[420px] max-w-md flex-col items-center justify-center px-8 py-16 text-center">
          <FileText className="mb-5 size-9 text-muted-foreground/50" />
          <h2 className="text-xl font-semibold tracking-tight">{containerName}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Write a quick note or build a tree of Markdown files. Each file can hold its own subfiles.</p>
          <Button className="mt-6" disabled={working} onClick={() => setCreation({parentId:null,kind:"note",title:""})}><Plus className="size-4" />New file</Button>
          {activeNotes.length > 0 && <div className="mt-8 grid w-full gap-1 text-left">{activeNotes.filter(note => !note.parentId).slice(0, 6).map(note => <button key={note.id} onClick={() => void openNote(note.id)} className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm hover:bg-muted"><FileText className="size-3.5 text-muted-foreground" /><span className="truncate">{label(note)}</span></button>)}</div>}
        </div>}
      </div>}
    </main>
    <Dialog open={Boolean(creation)} onOpenChange={open=>{if(!open&&!working)setCreation(null);}}><DialogContent><DialogHeader><DialogTitle>Create file or issuebook</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={event=>{event.preventDefault();if(creation)void createFile(creation.parentId,creation);}}>
        <div role="radiogroup" aria-label="File type" className="grid grid-cols-2 gap-3">
          {([{kind:"note",title:"Markdown file",description:"Write a note with optional subfiles.",Icon:FileText},{kind:"issuebook",title:"Issuebook",description:"Track issues, each with its own Markdown file.",Icon:ListTodo}] as const).map(option=><button type="button" key={option.kind} role="radio" aria-checked={creation?.kind===option.kind} disabled={working} onClick={()=>setCreation(current=>current?{...current,kind:option.kind}:current)} className={cn("flex flex-col gap-2 rounded-lg border p-4 text-left",creation?.kind===option.kind?"border-primary bg-muted":"border-border hover:bg-muted/50")}><option.Icon className="size-5"/><span className="text-sm font-medium">{option.title}</span><span className="text-xs leading-relaxed text-muted-foreground">{option.description}</span></button>)}
        </div>
        <label className="grid gap-2 text-sm">Name<Input autoFocus aria-label="New file name" value={creation?.title||""} maxLength={200} placeholder={creation?.kind==="issuebook"?"Untitled issuebook":"Untitled"} disabled={working} onChange={event=>setCreation(current=>current?{...current,title:event.target.value}:current)}/></label>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={working} onClick={()=>setCreation(null)}>Cancel</Button><Button type="submit" disabled={working}>{working?<Loader2 className="size-4 animate-spin"/>:null}Create</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    {shareNote && <NoteShareDialog key={shareNote.id} note={shareNote} onClose={()=>setShareNote(null)}/>}
    <NotePinDialog note={pinNote} open={Boolean(pinNote)} onOpenChange={open => { if (!open) setPinNote(null); }} />
    <Dialog open={Boolean(moveNote)} onOpenChange={open => { if (!open) setMoveNote(null); }}><DialogContent><DialogHeader><DialogTitle>Move file and subfiles</DialogTitle></DialogHeader>
      <label className="grid gap-2 text-sm">Project<select aria-label="Destination project" className="h-10 rounded-md border border-border bg-background px-3" value={moveProject || ""} onChange={event => { const id = event.target.value || null; setMoveProject(id); setMoveParent(""); void fetchMoveChoices(id).catch(cause => setError(cause.message)); }}><option value="">No Project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Parent file<select aria-label="Destination parent file" className="h-10 rounded-md border border-border bg-background px-3" value={moveParent} onChange={event => setMoveParent(event.target.value)}><option value="">Top level</option>{moveChoices.filter(note => !forbiddenMoveParents.has(note.id)).map(note => <option key={note.id} value={note.id}>{label(note)}</option>)}</select></label>
      {moveProject && moveNote?.projectId !== moveProject && <p className="text-xs text-muted-foreground">Files moved into this project become available to its members.</p>}
      <DialogFooter><Button variant="outline" onClick={() => setMoveNote(null)}>Cancel</Button><Button disabled={working || !moveNote} onClick={() => { if (moveNote) void move(moveNote, moveProject, moveParent || null); }}>Move tree</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={appearance} onOpenChange={setAppearance}><DialogContent><DialogHeader><DialogTitle>Page appearance</DialogTitle></DialogHeader>
      <div className="flex items-center gap-2"><NoteIconPicker value={icon} onChange={value => setIcon(value || "")} />{selected && <NoteBannerUpload key={selected.id} noteId={selected.id} value={cover} onChange={value => setCover(value || "")} />}</div>
      {cover && <BannerImage src={cover} alt="Banner preview" className="h-28 rounded-lg"/>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fullWidth} onChange={event => setFullWidth(event.target.checked)} />Full width</label>
      <DialogFooter><Button variant="outline" onClick={() => setAppearance(false)}>Cancel</Button><Button onClick={() => { if (selected) void patch(selected, { icon: icon || null, cover: cover || null, fullWidth }).then(note => { if (note) setAppearance(false); }).catch(cause => setError(cause.message)); }}>Save</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
