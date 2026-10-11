"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {Brain, LoaderCircle, RefreshCw, Search} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import type {ChatMemoryView} from "@/lib/chat-memory-view-model";

export function WorkspaceMemoryPanel({chatId, label}: {chatId: string; label: ChatMemoryView["label"]}) {
 const [view, setView] = useState<ChatMemoryView | null>(null);
 const [query, setQuery] = useState("");
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const request = useRef<AbortController | null>(null);
 const load = useCallback(async () => {
  request.current?.abort();
  const controller = new AbortController();
  request.current = controller;
  setLoading(true);
  try {
   const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/memories`, {cache: "no-store", signal: controller.signal});
   const data = await response.json() as ChatMemoryView & {error?: string};
   if (!response.ok) throw new Error(data.error || "Could not load memories.");
   if (controller.signal.aborted) return;
   setView(data);
   setError("");
  } catch (cause) {
   if (controller.signal.aborted) return;
   setError(cause instanceof Error ? cause.message : "Could not load memories.");
  } finally {
   if (!controller.signal.aborted) setLoading(false);
  }
 }, [chatId]);

 useEffect(() => {
  void load();
  const refresh = () => { if (document.visibilityState === "visible") void load(); };
  const timer = window.setInterval(refresh, 8000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
   window.clearInterval(timer);
   window.removeEventListener("focus", refresh);
   document.removeEventListener("visibilitychange", refresh);
   request.current?.abort();
  };
 }, [load]);

 const search = query.trim().toLocaleLowerCase();
 const groups = view?.groups.map(group => ({
  ...group,
  memories: group.memories.filter(memory => !search || [memory.content, ...(memory.tags || [])].some(value => value.toLocaleLowerCase().includes(search))),
 }));
 const count = view?.groups.reduce((total, group) => total + group.memories.length, 0) || 0;
 const matches = groups?.reduce((total, group) => total + group.memories.length, 0) || 0;

 return <section className="flex min-h-0 flex-1 flex-col" aria-label={view?.label || label}>
  <div className="shrink-0 space-y-3 border-b border-border/40 pb-3">
   <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
     <h2 className="flex items-center gap-2 text-sm font-medium"><Brain className="size-4" aria-hidden="true"/>{view?.label || label}</h2>
     <p className="mt-1 text-xs leading-5 text-muted-foreground">{view?.incognito ? "Durable memory is unavailable in Incognito." : "Saved context for this conversation and its workspace."}</p>
    </div>
    <Button type="button" variant="ghost" size="icon-sm" className="size-9 shrink-0" aria-label="Refresh memories" title="Refresh memories" disabled={loading} onClick={() => void load()}>
     {loading ? <LoaderCircle className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}
    </Button>
   </div>
   {!view?.incognito && <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true"/>
    <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search memories" placeholder="Search memories…" className="h-9 pl-9"/>
   </div>}
  </div>
  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3">
   {error && <div role="alert" className="mb-3 text-xs leading-5 text-destructive">{error} <button type="button" className="underline underline-offset-4" onClick={() => void load()}>Try again</button></div>}
   {!view && loading && <p role="status" className="py-4 text-xs text-muted-foreground">Loading memories…</p>}
   {view?.incognito ? <p className="py-4 text-xs leading-5 text-muted-foreground">This conversation does not read or save chat, project or global memories.</p> : groups?.map(group =>
    <section key={group.scope} className="pb-5" aria-label={group.label}>
     <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium">{group.label}</h3>
      <span className="text-[11px] tabular-nums text-muted-foreground">{group.enabled ? group.memories.length : "Off"}</span>
     </div>
     <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{group.description}</p>
     {group.enabled && (group.memories.length ? <ul className="mt-2 divide-y divide-border/35 border-y border-border/35">
      {group.memories.map(memory => <li key={memory.id} className="py-3">
       <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{memory.content}</p>
       {memory.tags?.length ? <p className="mt-1 text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{memory.tags.join(" · ")}</p> : null}
      </li>)}
     </ul> : <p className="py-3 text-xs leading-5 text-muted-foreground">{search ? "No matching memories." : "No memories saved here yet."}</p>)}
    </section>)}
  </div>
  {view && !view.incognito && <p className="shrink-0 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">{search ? `${matches} of ${count} memories` : `${count} saved memories`}</p>}
 </section>;
}
