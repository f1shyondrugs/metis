"use client";
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { DeletedChat } from "@/lib/chat-trash";

export function RecentlyDeletedChats({onChatsChanged}:{onChatsChanged:()=>void}) {
  const [chats,setChats]=useState<DeletedChat[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [busy,setBusy]=useState<string|null>(null),[target,setTarget]=useState<DeletedChat|null>(null);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError("");
    try {
      const response=await fetch("/api/chats/deleted",{cache:"no-store",signal});
      if(!response.ok) throw new Error("Could not load recently deleted chats.");
      const data=await response.json();
      if(!signal?.aborted) setChats(data.chats);
    } catch(error) {if(!signal?.aborted)setError(error instanceof Error?error.message:"Could not load chats.");}
    finally {if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  async function change(chat:DeletedChat,permanent=false) {
    setBusy(chat.id);setError("");
    try {
      const response=await fetch("/api/chats/deleted",{method:permanent?"DELETE":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:chat.id})});
      if(!response.ok) throw new Error(permanent?"Could not permanently delete chat.":"Could not restore chat.");
      setChats(current=>current.filter(item=>item.id!==chat.id));
      onChatsChanged();
    } catch(error) {setError((error as Error).message);throw error;}
    finally {setBusy(null);}
  }
  return <section className="space-y-4" aria-labelledby="settings-deleted">
    <div><h3 id="settings-deleted" className="flex items-center gap-2 text-sm font-medium"><Trash2 className="size-4 text-muted-foreground" />Recently deleted</h3>
      <p className="mt-1 text-xs text-muted-foreground">Restore deleted chats, including their messages and workspaces. Chats stay here until you permanently delete them. Incognito chats are not saved here.</p></div>
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{error}<Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={()=>void load()}>Retry</Button></div>:null}
    {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading recently deleted chats…</p>
      : !error && !chats.length ? <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">No recently deleted chats.</p>
      : <ul className="divide-y divide-border">{chats.map(chat=><li key={chat.id} className="flex flex-wrap items-center gap-2 py-3">
        <div className="min-w-0 flex-1 basis-40"><p className="truncate text-sm font-medium">{chat.title||"Untitled"}</p><p className="mt-0.5 text-xs text-muted-foreground">Deleted {new Date(chat.deletedAt).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"})}</p></div>
        <Button variant="outline" size="sm" className="min-h-11" disabled={Boolean(busy)} onClick={()=>void change(chat).catch(()=>{})}><RotateCcw className="size-4" />{busy===chat.id?"Working…":"Restore"}</Button>
        <Button variant="ghost" size="icon-sm" className="size-11 shrink-0 text-muted-foreground hover:text-destructive" disabled={Boolean(busy)} aria-label={`Permanently delete ${chat.title||"chat"}`} onClick={()=>setTarget(chat)}><Trash2 className="size-4" /></Button>
      </li>)}</ul>}
    <ConfirmDialog open={Boolean(target)} onOpenChange={open=>{if(!open)setTarget(null);}} title="Permanently delete chat?" description={`“${target?.title||"Untitled"}” cannot be restored after permanent deletion.`} confirmLabel="Delete permanently" onConfirm={async()=>{if(target)await change(target,true).catch(()=>{});}} />
  </section>;
}
