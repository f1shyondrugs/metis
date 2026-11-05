"use client";

import { lazy, Suspense, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { FileText, Loader2, Pencil, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NoteIcon } from "./note-icon";
import { noteLucideIcon, parseNoteIcon, searchNoteIcons } from "@/lib/note-icon";
import { projectIconLabel } from "@/lib/project-appearance";
import { PROJECT_COLORS } from "@/lib/project-constants";
import { cn } from "@/lib/utils";

const EmojiPicker = lazy(() => import("emoji-picker-react"));
const emojiTheme = {
  "--epr-bg-color": "var(--popover)", "--epr-category-label-bg-color": "var(--popover)",
  "--epr-search-input-bg-color": "var(--muted)", "--epr-search-input-bg-color-active": "var(--muted)",
  "--epr-text-color": "var(--popover-foreground)", "--epr-picker-border-color": "transparent",
  "--epr-highlight-color": "var(--ring)", "--epr-hover-bg-color": "var(--muted)",
  "--epr-focus-bg-color": "var(--muted)", "--epr-emoji-size": "24px",
} as CSSProperties;

export function NoteIconPicker({ value, onChange }: { value: string | null | undefined; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("icons");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const list = useRef<HTMLDivElement>(null);
  const { resolvedTheme, forcedTheme } = useTheme();
  const selected = parseNoteIcon(value);
  const matches = useMemo(() => {
    const names = searchNoteIcons(query);
    if (query.trim()) return names;
    const favorites = ["file-text", "check", "check-check", "circle-check", "list-checks", "book-open", "lightbulb", "calendar", "folder", "star", "rocket", "palette"];
    return [...new Set([...(selected?.kind === "lucide" ? [selected.name] : []), ...favorites, ...names])];
  }, [query, selected?.kind === "lucide" ? selected.name : null]);
  function choose(icon: string | null) { onChange(icon); setOpen(false); }
  function chooseColor(next: string | null) {
    setColor(next);
    if (selected?.kind === "lucide") onChange(noteLucideIcon(selected.name, next));
  }
  function moveInGrid(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-page-icon]")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !(event.key in offsets || event.key === "Home" || event.key === "End")) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + offsets[event.key]));
    buttons[next]?.focus();
  }
  return <Popover open={open} onOpenChange={next => {
    setOpen(next);
    if (next) { setQuery(""); setLimit(60); setColor(selected?.kind === "lucide" ? selected.color : null); setTab("icons"); }
  }}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={value ? "Change page icon" : "Add page icon"} title={value ? "Change icon" : "Add icon"}
        className="group relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-2xl transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {value ? <NoteIcon value={value} className="size-6" /> : <FileText aria-hidden="true" className="size-6 text-muted-foreground" />}
        <Pencil aria-hidden="true" className="absolute bottom-0.5 right-0.5 size-3 rounded-sm bg-background text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto p-3" style={{ maxHeight: "min(36rem, var(--radix-popover-content-available-height))" }} aria-label="Page icon picker">
      <p className="text-sm font-medium">Page icon</p>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 gap-3">
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="icons">Icons</TabsTrigger><TabsTrigger value="emojis">Emojis</TabsTrigger></TabsList>
        <TabsContent value="icons" className="min-h-0 space-y-3">
          <div className="space-y-1.5"><p className="text-xs font-medium text-muted-foreground">Icon color</p>
            <div className="flex flex-wrap gap-1" aria-label="Page icon colors">
              <button type="button" aria-label="Default icon color" aria-pressed={!color} title="Default color" className={cn("flex size-7 items-center justify-center rounded-full border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !color ? "border-foreground" : "border-border")} onClick={() => chooseColor(null)}>A</button>
              {PROJECT_COLORS.map(item => <button key={item} type="button" aria-label={"Icon color " + item} aria-pressed={color === item} title={item}
                className={cn("size-7 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", color === item ? "border-foreground" : "border-transparent")} style={{ backgroundColor: item }} onClick={() => chooseColor(item)} />)}
              <label className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border text-xs" title="Custom icon color">
                <span aria-hidden="true">+</span><input type="color" aria-label="Custom icon color" value={color || "#6366f1"} className="absolute inset-0 size-full cursor-pointer opacity-0" onChange={event => chooseColor(event.target.value)} />
              </label>
            </div>
          </div>
          <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input autoFocus value={query} aria-label="Search page icons" placeholder="Search icons… e.g. check" className="h-10 pl-9" onChange={event => { setQuery(event.target.value); setLimit(60); list.current?.scrollTo(0, 0); }}
              onKeyDown={event => {
                if (event.key === "Enter" && matches.length) { event.preventDefault(); choose(noteLucideIcon(matches[0], color)); }
                if (event.key === "ArrowDown") { event.preventDefault(); list.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
              }} />
          </div>
          <p className="text-xs text-muted-foreground" role="status">{matches.length.toLocaleString("en")} icons</p>
          <div ref={list} className="max-h-56 overflow-y-auto overscroll-contain" onKeyDown={moveInGrid}>
            {matches.length ? <div className="grid grid-cols-6 gap-1">{matches.slice(0, limit).map(name => <button key={name} data-page-icon type="button" title={projectIconLabel("lucide:" + name)} aria-label={"Select " + projectIconLabel("lucide:" + name)} aria-pressed={selected?.kind === "lucide" && selected.name === name}
              className="flex min-h-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted" onClick={() => choose(noteLucideIcon(name, color))}>
              <NoteIcon value={noteLucideIcon(name, color)} className="size-5" />
            </button>)}</div> : <p className="py-6 text-center text-sm text-muted-foreground">No icons found. Try another name.</p>}
            {matches.length > limit ? <Button type="button" variant="ghost" className="mt-2 h-11 w-full" onClick={() => setLimit(n => n + 60)}>Show more icons</Button> : null}
          </div>
        </TabsContent>
        <TabsContent value="emojis" className="min-h-0">
          <div style={emojiTheme}><Suspense fallback={<p role="status" className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading emojis…</p>}>
            {open && tab === "emojis" ? <EmojiPicker colorScheme={(forcedTheme || resolvedTheme) === "dark" ? "dark" : "light"} width="100%" height={340} emojiStyle="native" searchPlaceholder="Search emojis…" autoFocusSearch previewConfig={{ showPreview: false }} onEmojiClick={data => choose(data.emoji)} /> : null}
          </Suspense></div>
        </TabsContent>
      </Tabs>
      {value ? <Button type="button" variant="ghost" className="h-11 w-full shrink-0 text-muted-foreground" onClick={() => choose(null)}>Remove icon</Button> : null}
    </PopoverContent>
  </Popover>;
}
