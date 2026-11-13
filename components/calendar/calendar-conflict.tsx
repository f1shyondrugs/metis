"use client";
import {useEffect,useRef,useState} from "react";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {calendarAction} from "./calendar-connections";
type Snapshot={title:string;start:string;end:string;description:string;location:string}|null;
type Detail={id:string;version:number;local:Snapshot;remote:Snapshot};
export function CalendarConflict({id,onClose,onChanged}:{id:string;onClose:()=>void;onChanged:()=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const pending=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const c=new AbortController();fetch("/api/calendar?conflict="+encodeURIComponent(id),{signal:c.signal,cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!c.signal.aborted)setDetail(d.conflict);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[id]);
 async function resolve(choice:"metis"|"remote"){if(!detail||pending.current)return;pending.current=true;setBusy(true);setError("");try{await calendarAction({action:"resolve",id,choice,version:detail.version});if(!mounted.current)return;onChanged();onClose();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Could not resolve conflict.");}finally{pending.current=false;if(mounted.current)setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent closeButtonDisabled={busy} className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
  <DialogHeader><DialogTitle>Resolve sync conflict</DialogTitle><DialogDescription>Review both versions. Your selection will be synchronized to all linked writable calendars.</DialogDescription></DialogHeader>
  {!detail&&!error?<p role="status">Loading both versions…</p>:null}
  {detail?<div className="grid gap-4 sm:grid-cols-2">{([["Metis",detail.local],["Remote",detail.remote]] as const).map(([label,snapshot])=><section key={label} className="min-w-0 space-y-2 rounded-md border border-border p-3"><h3 className="text-xs font-medium text-muted-foreground">{label}</h3>{snapshot?<><p className="break-words text-sm font-medium">{snapshot.title}</p><p className="break-words text-xs">{snapshot.start}<br/>{snapshot.end}</p><p className="break-words text-xs">{snapshot.location}</p><p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs">{snapshot.description}</p></>:<p className="text-sm">Deleted</p>}</section>)}</div>:null}
  {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  <DialogFooter><Button variant="outline" size="action" disabled={!detail||busy} onClick={()=>void resolve("metis")}>Keep Metis version</Button><Button size="action" disabled={!detail||busy} onClick={()=>void resolve("remote")}>Use remote version</Button></DialogFooter>
 </DialogContent></Dialog>;
}
