"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Brain, FileDown, FolderKanban, LayoutPanelLeft, MessageSquare, PanelLeft, Search, Settings, Sparkles, StickyNote, SquarePen, X, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { boundedSearchResults, type PaletteResults } from "@/lib/palette-search";
type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenDraft: () => void;
    onOpenChat: (chatId: string, messageId?: string) => void;
    onOpenNotes: () => void;
    onOpenNote: (noteId: string) => void;
    onOpenProject: (projectId: string) => void;
    onOpenMemories: () => void;
    onOpenSettings: () => void;
    onOpenWorkspace: () => void;
    onOpenModel: () => void;
    onToggleSidebar: () => void;
    onExport: () => void;
};
const commandItems = [
    { id: "new", label: "New chat", hint: "Ctrl/Cmd+N", icon: SquarePen },
    { id: "notes", label: "Open notebooks", icon: StickyNote },
    { id: "memories", label: "Open memories", icon: Brain },
    { id: "settings", label: "Open settings", icon: Settings },
    { id: "workspace", label: "Toggle workspace", icon: LayoutPanelLeft },
    { id: "model", label: "Choose model", icon: Sparkles },
    { id: "sidebar", label: "Toggle chat bar", icon: PanelLeft },
    { id: "export", label: "Export current chat", icon: FileDown },
] as const;
// Bound both text and highlighted segments. CSS clamping alone still builds the
// entire hidden document; memoization keeps keyboard navigation from rebuilding it.
const Highlight = memo(function Highlight({ text, query }: {
    text: string;
    query: string;
}) {
    const needle = query.trim().toLowerCase();
    if (!needle)
        return <>{text}</>;
    const lower = text.toLowerCase(), parts = [];
    let offset = 0;
    for (let count = 0; count < 12; count++) {
        const index = lower.indexOf(needle, offset);
        if (index < 0)
            break;
        if (index > offset)
            parts.push(text.slice(offset, index));
        parts.push(<mark key={index} className="rounded bg-primary/20 px-0.5 text-primary">{text.slice(index, index + needle.length)}</mark>);
        offset = index + needle.length;
    }
    parts.push(text.slice(offset));
    return <>{parts}</>;
});
const empty: PaletteResults = { results: [], notes: [], projects: [], indexing: false };
export function CommandPalette(props: Props) {
    const { open, onOpenChange } = props;
    const inputRef = useRef<HTMLInputElement>(null), listRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState(""), [data, setData] = useState({ query: "", ...empty });
    const [loading, setLoading] = useState(false), [error, setError] = useState(false);
    const [retry, setRetry] = useState(0), [activeIndex, setActiveIndex] = useState(0);
    const normalized = query.trim().slice(0, 200);
    const filteredCommands = useMemo(() => commandItems.filter(item => !normalized || item.label.toLowerCase().includes(normalized.toLowerCase())), [normalized]);
    const visible = data.query === normalized ? data : empty;
    const { results, notes, projects } = visible;
    const commandCount = filteredCommands.length;
    const itemCount = commandCount + results.length + projects.length + notes.length;
    useEffect(() => {
        if (!open)
            return;
        setQuery("");
        setData({ query: "", ...empty });
        setActiveIndex(0);
        setError(false);
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [open]);
    useEffect(() => {
        setActiveIndex(0);
        setError(false);
        if (!open || !normalized) {
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        setLoading(true);
        const search = async () => {
            try {
                const response = await fetch(`/api/chats/search?q=${encodeURIComponent(normalized)}&related=1&group=chat`, { signal: controller.signal, cache: "no-store" });
                if (!response.ok)
                    throw new Error("Search failed");
                const next = boundedSearchResults(await response.json());
                if (controller.signal.aborted)
                    return;
                setData({ query: normalized, ...next });
                setLoading(false);
                setError(false);
                if (next.indexing)
                    timer = setTimeout(search, 300);
            }
            catch (cause) {
                if (controller.signal.aborted || (cause as Error).name === "AbortError")
                    return;
                setLoading(false);
                setError(true);
            }
        };
        timer = setTimeout(search, 180);
        return () => { controller.abort(); clearTimeout(timer); };
    }, [open, normalized, retry]);
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);
    const runCommand = (id: string) => {
        onOpenChange(false);
        const actions: Record<string, () => void> = { new: props.onOpenDraft, notes: props.onOpenNotes, memories: props.onOpenMemories, settings: props.onOpenSettings, workspace: props.onOpenWorkspace, model: props.onOpenModel, sidebar: props.onToggleSidebar, export: props.onExport };
        actions[id]?.();
    };
    const select = (index: number) => {
        if (index < commandCount) {
            runCommand(filteredCommands[index].id);
            return;
        }
        const chat = results[index - commandCount];
        if (chat) {
            onOpenChange(false);
            props.onOpenChat(chat.chatId, chat.messageId);
            return;
        }
        const project = projects[index - commandCount - results.length];
        if (project) {
            onOpenChange(false);
            props.onOpenProject(project.id);
            return;
        }
        const note = notes[index - commandCount - results.length - projects.length];
        if (note) {
            onOpenChange(false);
            props.onOpenNote(note.noteId);
        }
    };
    const rowProps = (index: number) => ({
        id: "palette-result-" + index, role: "option", "aria-selected": index === activeIndex,
        "data-active": index === activeIndex,
        onMouseEnter: () => setActiveIndex(index), onClick: () => select(index),
        className: cn("flex w-full items-start gap-3 rounded-md px-2 py-2 text-left", index === activeIndex ? "bg-muted" : "hover:bg-muted/60"),
    });
    const heading = "px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
    return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 max-sm:top-[14dvh] max-sm:translate-y-0 sm:max-w-xl">
   <DialogHeader className="sr-only"><DialogTitle>Search chats and commands</DialogTitle><DialogDescription>Search chat messages or run an action.</DialogDescription></DialogHeader>
   <div className="flex items-center gap-2 border-b border-border/60 px-3">
    <Search className="size-4 shrink-0 text-muted-foreground"/>
    <Input ref={inputRef} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex(current => (current + direction + Math.max(1, itemCount)) % Math.max(1, itemCount));
            }
            else if (event.key === "Enter") {
                event.preventDefault();
                if (itemCount)
                    select(activeIndex);
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
            }
        }} role="combobox" aria-expanded={open} aria-controls="palette-results" aria-autocomplete="list" aria-activedescendant={itemCount ? "palette-result-" + activeIndex : undefined} placeholder="Search chats or run a command…" aria-label="Search chats or commands" className="h-12 border-0 bg-popover px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-popover"/>
    <Button type="button" variant="ghost" size="icon-sm" className="group size-7 shrink-0 max-md:min-h-11 max-md:min-w-11" onClick={() => onOpenChange(false)} aria-label="Close search" title="Close search">
     <kbd className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:hidden">ESC</kbd><X className="hidden size-4 group-hover:block"/>
    </Button>
   </div>
   <div ref={listRef} id="palette-results" role="listbox" aria-label="Search results" aria-busy={loading || visible.indexing} className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
    {filteredCommands.length > 0 && <><p className={heading}>Commands</p>{filteredCommands.map((command, index) => {
                const Icon = command.icon;
                return <button key={command.id} type="button" {...rowProps(index)}>
      <Icon className="size-4 shrink-0 text-muted-foreground"/><span className="flex-1 text-sm">{command.label}</span>
      {"hint" in command && <kbd className="text-[10px] text-muted-foreground">{command.hint}</kbd>}
     </button>;
            })}</>}
    {normalized && <>
     <p className={heading}>Chats</p>
     {loading && <p role="status" className="px-2 py-4 text-center text-sm text-muted-foreground">Searching…</p>}
     {results.map((result, index) => <button type="button" key={result.chatId} {...rowProps(commandCount + index)}>
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1">
       <span className="block truncate text-sm"><Highlight text={result.chatTitle} query={normalized}/></span>
       <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground"><Highlight text={result.snippet} query={normalized}/></span>
       {!!result.matchedKeywords?.length && <span className="mt-1 flex flex-wrap gap-1">{result.matchedKeywords.map(keyword => <span key={keyword} className="rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"><Highlight text={keyword} query={normalized}/></span>)}</span>}
      </span><ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground"/>
     </button>)}
     {!!projects.length && <><p className={heading}>Projects</p>{projects.map((project, index) => <button type="button" key={project.id} {...rowProps(commandCount + results.length + index)}>
      <FolderKanban className="size-4 shrink-0 text-muted-foreground"/><span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: project.color }}/>
      <span className="min-w-0 flex-1 truncate text-sm"><Highlight text={project.name} query={normalized}/></span><ArrowRight className="size-3.5 shrink-0 text-muted-foreground"/>
     </button>)}</>}
     {!!notes.length && <><p className={heading}>Notebooks</p>{notes.map((note, index) => <button type="button" key={note.noteId} {...rowProps(commandCount + results.length + projects.length + index)}>
      <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1">
       <span className="block truncate text-sm"><Highlight text={noteDisplayTitle(note.title)} query={normalized}/></span>
       <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground"><Highlight text={note.snippet} query={normalized}/></span>
      </span><ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground"/>
     </button>)}</>}
     {error ? <div role="alert" className="px-2 py-3 text-center text-sm text-muted-foreground">Search failed. <button type="button" className="text-primary underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
                : visible.indexing ? <p role="status" className="px-2 py-3 text-center text-xs text-muted-foreground">Searching older chats…</p>
                    : !loading && !results.length && !notes.length && !projects.length && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No results found.</p>}
    </>}
   </div>
  </DialogContent>
 </Dialog>;
}
