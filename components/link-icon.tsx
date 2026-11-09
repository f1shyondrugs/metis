"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, LayoutDashboard, FileText, Workflow, CircleDot, Globe, Terminal, Brain, MessageSquare, File, Link2, Mail, Users } from "lucide-react";
import { parseInternalLink } from "@/lib/internal-link";
import { parseReferenceLink } from "@/lib/reference-link";
import { parseWorkspaceFileLink } from "@/lib/workspace-file-link";
import { isFileUrl } from "@/lib/file-types";
import { NoteIcon } from "@/components/notes/note-icon";
import { usePublicMarkdownShare } from "@/components/public-markdown-context";
import { cn } from "@/lib/utils";

const icons = { plan: ClipboardList, canvas: LayoutDashboard, note: FileText, automation: Workflow, issue: CircleDot,
  browser: Globe, terminal: Terminal, memory: Brain, chat: MessageSquare, file: File, subagent: Users };
const pending = new Map<string, Promise<string | null>>();
function loadNoteIcon(id: string) {
  const url = "/api/internal-link-preview?" + new URLSearchParams({ kind: "note", id, view: "icon" });
  let request = pending.get(url);
  if (!request) {
    request = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) }).then(async response => {
      if (!response.ok) return null;
      const value = await response.json() as { icon?: unknown };
      return typeof value.icon === "string" ? value.icon : null;
    }).catch(() => null).finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request;
}

/** Display only: never changes the destination, label or saved Markdown. */
export function LinkIcon({ href = "", kind, id, icon, className }: {
  href?: string; kind?: string; id?: string; icon?: string | null; className?: string;
}) {
  const share = usePublicMarkdownShare();
  const target = parseInternalLink(href) || parseReferenceLink(href);
  const resolvedKind = kind || target?.kind || (parseWorkspaceFileLink(href) || isFileUrl(href) ? "file"
    : /^https?:\/\//i.test(href) ? "browser" : /^mailto:/i.test(href) ? "mail" : /^subagent:\/\//i.test(href) ? "subagent" : "link");
  const noteId = resolvedKind === "note" ? id || target?.id : undefined;
  const host = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; icon: string | null } | null>(null);
  useEffect(() => {
    if (!noteId || share || icon !== undefined) return;
    let current = true;
    const load = () => { void loadNoteIcon(noteId).then(value => { if (current) setLoaded({ id: noteId, icon: value }); }); };
    if (typeof IntersectionObserver === "undefined" || !host.current) { load(); return () => { current = false; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    });
    observer.observe(host.current);
    return () => { current = false; observer.disconnect(); };
  }, [noteId, share, icon]);
  const Icon = resolvedKind === "mail" ? Mail : icons[resolvedKind as keyof typeof icons] || Link2;
  return <span ref={host} aria-hidden="true" data-link-icon-kind={resolvedKind}
    className={cn("mr-1 inline-flex size-[1em] shrink-0 items-center justify-center align-[-0.15em] leading-none", className)}>
    {resolvedKind === "note" ? <NoteIcon value={icon !== undefined ? icon : share && noteId ? share.noteIcons?.[noteId] ?? null : loaded && loaded.id === noteId ? loaded.icon : null} className="size-full" /> : <Icon className="size-full" />}
  </span>;
}
