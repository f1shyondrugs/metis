"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {Brain, LoaderCircle, RefreshCw, Search} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import type {ChatMemoryView} from "@/lib/chat-memory-view-model";

type MemoryScope = ChatMemoryView["groups"][number]["scope"];
const scopes: MemoryScope[] = ["chat", "project", "global"];

export function WorkspaceMemoryPanel({chatId, label}: {chatId: string; label: ChatMemoryView["label"]}) {
 const [view, setView] = useState<ChatMemoryView | null>(null);
 const [activeScope, setActiveScope] = useState<MemoryScope>("chat");
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

 const scopeLabel = (scope: MemoryScope) => scope === "chat" ? view?.label || label : scope === "project" ? "Project Memory" : "Global Memory";
 const group = view?.groups.find(item => item.scope === activeScope);
 const search = query.trim().toLocaleLowerCase();
 const memories = group?.memories.filter(memory => !search || [memory.content, ...(memory.tags || [])].some(value => value.toLocaleLowerCase().includes(search))) || [];
 const count = group?.memories.length || 0;

 return <section className="flex min-h-0 flex-1 flex-col" aria-label="Memory">
  <div className="flex shrink-0 items-start justify-between gap-3 pb-2">
   <div className="min-w-0">
    <h2 className="flex items-center gap-2 text-sm font-medium"><Brain className="size-4" aria-hidden="true"/>Memory</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{view?.incognito ? "Durable memory is unavailable in Incognito." : "Saved context for this conversation and its workspace."}</p>
   </div>
   <Button type="button" variant="ghost" size="icon-sm" className="size-9 shrink-0" aria-label="Refresh memories" title="Refresh memories" disabled={loading} onClick={() => void load()}>
    {loading ? <LoaderCircle className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}
   </Button>
  </div>
  {view?.incognito ? <p className="py-4 text-xs leading-5 text-muted-foreground">This conversation does not read or save chat, project or global memories.</p> :
   <Tabs value={activeScope} onValueChange={value => {setActiveScope(value as MemoryScope); setQuery("");}} className="min-h-0 flex-1 gap-0">
    <div className="shrink-0 overflow-x-auto border-b border-border/40">
     <TabsList variant="line" aria-label="Memory scopes" className="h-10 w-full min-w-max justify-start gap-3 p-0">
      {scopes.map(scope => <TabsTrigger key={scope} value={scope} className="h-10 shrink-0 px-1 text-xs data-[state=active]:text-foreground data-[state=active]:after:opacity-100 after:bottom-0">
       {scopeLabel(scope)}
      </TabsTrigger>)}
     </TabsList>
    </div>
    <div className="relative my-3 shrink-0">
     <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true"/>
     <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search memories" placeholder={`Search ${scopeLabel(activeScope).toLocaleLowerCase()}…`} className="h-9 pl-9"/>
    </div>
    {error && <div role="alert" className="mb-3 text-xs leading-5 text-destructive">{error} <button type="button" className="underline underline-offset-4" onClick={() => void load()}>Try again</button></div>}
    {scopes.map(scope => <TabsContent key={scope} value={scope} className="min-h-0 overflow-y-auto overscroll-contain">
     {!view && loading ? <p role="status" className="py-4 text-xs text-muted-foreground">Loading memories…</p> : view && <>
      <div className="flex items-start justify-between gap-3">
       <p className="text-xs leading-5 text-muted-foreground">{group?.description || "This chat is not linked to a project."}</p>
       <span className="shrink-0 text-[11px] leading-5 tabular-nums text-muted-foreground">{group && !group.enabled ? "Off" : count}</span>
      </div>
      {group?.enabled && (memories.length ? <ul className="mt-2 divide-y divide-border/35 border-y border-border/35">
       {memories.map(memory => <li key={memory.id} className="py-3">
        <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{memory.content}</p>
        {memory.tags?.length ? <p className="mt-1 text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{memory.tags.join(" · ")}</p> : null}
       </li>)}
      </ul> : <p className="py-3 text-xs leading-5 text-muted-foreground">{search ? "No matching memories." : "No memories saved here yet."}</p>)}
     </>}
    </TabsContent>)}
    {view && <p className="shrink-0 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">{search ? `${memories.length} of ${count} memories` : `${count} saved memories`}</p>}
   </Tabs>
  }
 </section>;
}
