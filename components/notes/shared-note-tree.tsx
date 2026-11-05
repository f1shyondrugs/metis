"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, ListTodo, LockKeyhole, Menu, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { FileEmbed } from "@/components/file-embed";
import { SharedNotePasswordGate } from "@/components/notes/shared-note-password-gate";
import { NoteIcon } from "@/components/notes/note-icon";
import { Button } from "@/components/ui/button";
import { noteDisplayTitle } from "@/lib/notes-tree";
import { notesNavigationTarget } from "@/lib/notes-navigation";
import type { PublicNoteShare, PublicSharedNote } from "@/lib/note-share-types";
import { cn } from "@/lib/utils";

const title = (note: PublicSharedNote) => noteDisplayTitle(note.title) || "Untitled";
export function sharedNoteSelection(share: PublicNoteShare, requested?: string | null) {
  return share.notes.find(note=>note.id===requested) || share.notes.find(note=>note.id===share.rootId) || null;
}
export function sharedNoteBreadcrumbs(share: PublicNoteShare, id: string): PublicSharedNote[] {
  const byId=new Map(share.notes.map(note=>[note.id,note]));
  const result:PublicSharedNote[]=[],seen=new Set<string>();
  let note=byId.get(id);
  while(note&&!seen.has(note.id)){
    seen.add(note.id);result.unshift(note);
    if(note.id===share.rootId)break;
    note=note.parentId?byId.get(note.parentId):undefined;
  }
  return result;
}

export function SharedNoteTree({ token, initialShare }: {token:string;initialShare:PublicNoteShare}) {
  const [share,setShare]=useState<PublicNoteShare|null>(initialShare);
  const [selectedId,setSelectedId]=useState(initialShare.rootId);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set([initialShare.rootId]));
  const [sidebar,setSidebar]=useState(false);
  const [blockTarget,setBlockTarget]=useState<{noteId:string;blockId:string}|null>(null);
  const [error,setError]=useState("");
  const [locked,setLocked]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true,request:AbortController|undefined;
    const refresh=()=>{
      if(document.visibilityState==="hidden")return;
      request?.abort();const current=new AbortController();request=current;
      void fetch("/api/shared-notes/"+encodeURIComponent(token),{cache:"no-store",credentials:"same-origin",signal:current.signal})
        .then(async response=>{
          if(response.status===401){if(active){setShare(null);setLocked(true);setError("");}return;}
          if(response.status===404){if(active){setShare(null);setLocked(false);setError("This share link is no longer available.");}return;}
          if(!response.ok)throw new Error("Could not refresh these shared notes.");
          const next=await response.json() as PublicNoteShare;
          if(active){setShare(next);setLocked(false);setError("");}
        }).catch(cause=>{if(active&&!current.signal.aborted)setError(cause instanceof Error?cause.message:"Could not refresh these shared notes.");});
    };
    const timer=window.setInterval(refresh,15000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    refresh();
    return()=>{active=false;request?.abort();clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
  },[token,retry]);
  const openNote=useCallback((id:string,blockId?:string)=>{
    if(!share?.notes.some(note=>note.id===id))return;
    setSelectedId(id);setSidebar(false);
    setExpanded(previous=>new Set([...previous,...sharedNoteBreadcrumbs(share,id).map(note=>note.id)]));
    window.location.hash="note-"+encodeURIComponent(id)+(blockId?"/block-"+encodeURIComponent(blockId):"");
    setBlockTarget(blockId?{noteId:id,blockId}:null);
  },[share]);
  useEffect(()=>{
    if(!share)return;
    const navigate=()=>{
      const target=notesNavigationTarget(window.location.hash);
      if(target?.kind!=="note")return;
      const note=sharedNoteSelection(share,target.id);
      if(note){
        setSelectedId(note.id);
        setExpanded(old=>new Set([...old,...sharedNoteBreadcrumbs(share,note.id).map(item=>item.id)]));
        setBlockTarget(note.id===target.id&&target.blockId?{noteId:note.id,blockId:target.blockId}:null);
      }
    };
    navigate();window.addEventListener("hashchange",navigate);
    return()=>window.removeEventListener("hashchange",navigate);
  },[share]);
  const note=share?sharedNoteSelection(share,selectedId):null;
  useEffect(()=>{
    if(!blockTarget||note?.id!==blockTarget.noteId)return;
    const frame=requestAnimationFrame(()=>{
      const block=document.getElementById("block-"+blockTarget.blockId)||document.getElementById(blockTarget.blockId);
      block?.scrollIntoView({block:"center"});
      setBlockTarget(null);
    });
    return()=>cancelAnimationFrame(frame);
  },[blockTarget,note?.id,share]);
  const root=share?.notes.find(note=>note.id===share.rootId);
  const crumbs=share&&note?sharedNoteBreadcrumbs(share,note.id):[];
  const rows=useMemo(()=>{
    if(!share)return[];
    const root=share.notes.find(note=>note.id===share.rootId);
    if(!root)return[];
    const children=new Map<string,PublicSharedNote[]>();
    for(const item of share.notes){
      if(!item.parentId)continue;
      const list=children.get(item.parentId)||[];list.push(item);children.set(item.parentId,list);
    }
    for(const list of children.values())list.sort((a,b)=>a.sortKey-b.sortKey||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const visible:Array<{note:PublicSharedNote;depth:number;children:boolean}>=[],stack=[{note:root,depth:0}],seen=new Set<string>();
    while(stack.length){
      const item=stack.pop()!;if(seen.has(item.note.id))continue;seen.add(item.note.id);
      const subpages=children.get(item.note.id)||[];
      visible.push({...item,children:subpages.length>0});
      if(expanded.has(item.note.id))for(let i=subpages.length-1;i>=0;i--)stack.push({note:subpages[i],depth:item.depth+1});
    }
    return visible;
  },[share,expanded]);
  const publicShare=useMemo(()=>({noteIds:share?.notes.map(note=>note.id)||[],assets:share?.assets||{},onOpenNote:openNote}),[share,openNote]);
  if(locked)return <SharedNotePasswordGate token={token} onUnlocked={next=>{setShare(next);setLocked(false);setError("");}}/>;
  if(!share||!root||!note)return <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center"><FileText className="size-8 text-muted-foreground"/><h1 className="text-xl font-semibold">Shared notes unavailable</h1><p className="text-sm text-muted-foreground">{error||"This link has expired or sharing was stopped."}</p><Button variant="outline" onClick={()=>setRetry(value=>value+1)}>Retry</Button></main>;
  const sharedAssetUrls=new Set(Object.values(share.assets));
  const coverColor=note.cover&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(note.cover)?note.cover:null;
  const coverUrl=note.cover&&sharedAssetUrls.has(note.cover)?note.cover:null;
  return <div className="relative flex h-dvh min-h-0 overflow-hidden bg-background" data-shared-note-tree>
    {sidebar&&<button aria-label="Close shared page browser" className="absolute inset-0 z-20 bg-black/40 lg:hidden" onClick={()=>setSidebar(false)}/>}
    <aside aria-label="Shared note tree" className={cn("absolute inset-y-0 left-0 z-30 w-[280px] shrink-0 flex-col border-r border-border bg-background lg:relative lg:z-0 lg:flex lg:w-[260px]",sidebar?"flex":"hidden")}>
      <div className="flex h-12 items-center justify-between border-b border-border px-4"><span className="text-sm font-medium">Shared pages</span><Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Close shared page browser" onClick={()=>setSidebar(false)}><X className="size-4"/></Button></div>
      <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Shared pages">
        {rows.map(row=><div key={row.note.id} className={cn("flex min-h-10 items-center rounded-md",note.id===row.note.id?"bg-muted":"hover:bg-muted/60")} style={{paddingLeft:Math.min(row.depth,12)*14}}>
          <button className="flex size-7 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-0" disabled={!row.children} aria-label={(expanded.has(row.note.id)?"Collapse ":"Expand ")+title(row.note)} aria-expanded={row.children?expanded.has(row.note.id):undefined} onClick={()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(row.note.id))next.delete(row.note.id);else next.add(row.note.id);return next;})}>{expanded.has(row.note.id)?<ChevronDown className="size-3.5"/>:<ChevronRight className="size-3.5"/>}</button>
          <button className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-sm" aria-current={note.id===row.note.id?"page":undefined} onClick={()=>openNote(row.note.id)}>
            {row.note.icon?<NoteIcon value={row.note.icon} className="size-3.5" />:row.note.kind==="issuebook"?<ListTodo className="size-3.5 shrink-0 text-muted-foreground"/>:<FileText className="size-3.5 shrink-0 text-muted-foreground"/>}<span className="truncate">{title(row.note)}</span>
          </button>
        </div>)}
      </nav>
      <p className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground"><LockKeyhole className="size-3.5"/>Read-only link</p>
    </aside>
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Open shared page browser" onClick={()=>setSidebar(true)}><Menu className="size-4"/></Button>
        <div className="min-w-0 flex-1 overflow-hidden text-sm text-muted-foreground">{crumbs.map((item,index)=><span key={item.id}>{index>0?<ChevronRight className="mx-1 inline size-3"/>:null}<button className={cn("max-w-40 truncate align-middle hover:text-foreground",item.id===note.id&&"text-foreground")} onClick={()=>openNote(item.id)}>{title(item)}</button></span>)}</div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3"/>Read only</span>
      </header>
      {error?<div role="alert" className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1">{error}</span><Button variant="ghost" size="sm" onClick={()=>setRetry(value=>value+1)}>Retry</Button></div>:null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {coverColor?<div className="h-36 w-full sm:h-48" style={{backgroundColor:coverColor}}/>:coverUrl?/* eslint-disable-next-line @next/next/no-img-element */<img src={coverUrl} alt="" className="h-36 w-full object-cover sm:h-48" referrerPolicy="no-referrer"/>:null}
        <article key={note.id} className={cn("mx-auto px-5 py-8 sm:px-10",note.fullWidth?"max-w-none":"max-w-[920px]")}>
          {note.icon?<NoteIcon value={note.icon} className="mb-4 size-10 text-4xl" />:null}
          <h1 className="mb-2 break-words text-3xl font-semibold tracking-tight">{title(note)}</h1>
          <p className="mb-7 text-xs text-muted-foreground">Updated <time dateTime={note.updatedAt}>{note.updatedAt.slice(0,10)}</time></p>
          {note.asset&&sharedAssetUrls.has(note.asset.url)?<FileEmbed file={note.asset} resizable={false} className="mb-6 rounded-lg border border-border"/>:null}
          {note.todos?.length?<section aria-label="Checklist" className="mb-6 space-y-2 border-b border-border pb-5">
            {note.todos.map(todo=><label key={todo.id} className="flex min-h-8 items-start gap-2 text-sm"><input type="checkbox" checked={todo.status==="completed"} disabled className="mt-1"/><span className={cn("min-w-0 flex-1",todo.status==="completed"&&"text-muted-foreground line-through")}>{todo.content}{todo.status==="in_progress"?<span className="ml-2 text-xs text-muted-foreground">In progress</span>:null}</span></label>)}
          </section>:null}
          {note.content.trim()?<Markdown content={note.content} publicShare={publicShare}/>:!note.asset&&!note.todos?.length?<p className="text-sm text-muted-foreground">This page is empty.</p>:null}
        </article>
      </div>
    </main>
  </div>;
}
