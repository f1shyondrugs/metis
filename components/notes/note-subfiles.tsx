"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ListTodo } from "lucide-react";
import { NoteIcon } from "./note-icon";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { cn } from "@/lib/utils";

type Subfile = { id: string; title: string; icon?: string | null; kind?: string };
const PANEL_WIDTH = 240, PANEL_GAP = 24, EDGE_SPACE = 16;

/** Uses only the children supplied by the existing private/shared page boundary. */
export function NoteSubfiles({ notes, onOpenNote }: {
  notes: readonly Subfile[]; onOpenNote: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<{ left: number; top: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hasNotes = notes.length > 0;
  useEffect(() => {
    const element = host.current;
    const article = element?.closest("article");
    const page = element?.closest<HTMLElement>("[data-note-page-scroll]");
    if (!element || !article || !page) return;
    const measure = () => {
      const bounds = article.getBoundingClientRect(), container = page.getBoundingClientRect();
      const origin = element.getBoundingClientRect();
      const title = article.querySelector<HTMLElement>("[data-note-title]")?.getBoundingClientRect();
      const room = container.left + page.clientWidth - bounds.right;
      const next = room >= PANEL_WIDTH + PANEL_GAP + EDGE_SPACE
        ? { left: bounds.right - origin.left + PANEL_GAP, top: (title?.top ?? origin.top) - origin.top }
        : null;
      setFloating(current => current?.left === next?.left && current?.top === next?.top ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page); observer.observe(article);
    return () => observer.disconnect();
  }, [hasNotes]);
  if (!notes.length) return null;
  const shown = floating || expanded ? notes : notes.slice(0, 5);
  return <div ref={host} className={cn("relative min-w-0", !floating && "mb-6")}
    data-note-subfiles data-layout={floating ? "floating" : "inline"}>
    <nav aria-label="Subfiles" className={cn("min-w-0", floating && "absolute z-10 rounded-lg border border-border bg-background/95 p-3 shadow-sm")}
      style={floating ? { left: floating.left, top: floating.top, width: PANEL_WIDTH } : undefined}>
      <h2 className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        Subfiles <span className="font-normal tabular-nums">{notes.length}</span>
      </h2>
      <ul id={listId} className={cn("grid gap-0.5", floating && "max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain")}>
        {shown.map(note => <li key={note.id} className="min-w-0">
          <button type="button" onClick={() => onOpenNote(note.id)}
            className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            {note.kind === "issuebook" && !note.icon ? <ListTodo aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/> : <NoteIcon value={note.icon} className="size-4"/>}
            <span className="truncate">{noteDisplayTitle(note.title) || "Untitled"}</span>
          </button>
        </li>)}
      </ul>
      {!floating && notes.length > 5 && <button type="button" aria-expanded={expanded} aria-controls={listId}
        className="mt-1 flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronUp aria-hidden="true" className="size-3.5"/> : <ChevronDown aria-hidden="true" className="size-3.5"/>}
        {expanded ? "Show less" : "Show " + (notes.length - 5) + " more"}
      </button>}
    </nav>
  </div>;
}
