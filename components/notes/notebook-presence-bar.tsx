"use client";
import {useEffect,useRef,useState} from "react";
import {Eye,Users,X} from "lucide-react";
import {ProfileAvatar} from "@/components/account/account-menu";
import {Button} from "@/components/ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import type {NotebookPeer,NotebookPerson} from "@/lib/notebook-presence";

type Controls={following:NotebookPeer|null;onFollow:(peer:NotebookPeer)=>void;onStop:()=>void};
export function ParticipantButton({peer,following,onFollow,onStop,small=false}:Controls&{peer:NotebookPeer;small?:boolean}){
 const [open,setOpen]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),keyboard=useRef(false);
 const clear=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
 const enter=()=>{clear();keyboard.current=false;timer.current=setTimeout(()=>setOpen(true),180);};
 const leave=()=>{if(keyboard.current)return;clear();timer.current=setTimeout(()=>setOpen(false),220);};
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;setOpen(false);},[following?.sessionId]);
 const followed=following?.sessionId===peer.sessionId;
 return <Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
   <Button type="button" variant="ghost" size={small?"icon-sm":"icon-action"} data-notebook-presence-control className={small?"size-11 shrink-0 rounded-full p-0 sm:size-7 pointer-coarse:min-h-11 pointer-coarse:min-w-11":"shrink-0 rounded-full p-1"}
    aria-label={"@"+peer.user.username+" — viewing "+peer.note.title} aria-pressed={followed}
    onPointerEnter={event=>{if(event.pointerType!=="touch")enter();}} onPointerLeave={event=>{if(event.pointerType!=="touch")leave();}} onClick={event=>{clear();keyboard.current=event.detail===0;}}
    onKeyDown={event=>{if(event.key==="ArrowDown"){event.preventDefault();keyboard.current=true;setOpen(true);}}}>
    <ProfileAvatar profile={{displayName:peer.user.name,avatar:peer.user.avatar}} name={peer.user.username} className={small?"size-6 ring-2 ring-background":"size-7 ring-2 ring-background"}/>
   </Button>
  </PopoverTrigger>
  <PopoverContent data-notebook-presence-control aria-label={"Participant @"+peer.user.username} align="end" sideOffset={6} className="z-[80] max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-1rem)] space-y-3 overflow-y-auto"
   onOpenAutoFocus={event=>{if(!keyboard.current)event.preventDefault();}} onPointerEnter={clear} onPointerLeave={event=>{if(event.pointerType!=="touch")leave();}}>
   <div className="flex items-center gap-3"><ProfileAvatar profile={{displayName:peer.user.name,avatar:peer.user.avatar}} name={peer.user.username} className="size-10"/>
    <div className="min-w-0"><p className="text-sm font-medium [overflow-wrap:anywhere]">{peer.user.name}</p><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">@{peer.user.username}</p></div>
   </div>
   <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]"><Eye className="mr-1 inline size-3.5" aria-hidden="true"/>Viewing {peer.note.title}</p>
   <Button size="action" variant={followed?"outline":"default"} className="w-full" onClick={()=>{clear();setOpen(false);if(followed)onStop();else onFollow(peer);}}>{followed?"Stop following":"Follow"}</Button>
  </PopoverContent>
 </Popover>;
}
export function NotebookPresenceBar({peers,self,connected,status,notice,onReconnect,...controls}:Controls&{
 peers:NotebookPeer[];self:NotebookPerson|null;connected:boolean;status?:string;notice:string;onReconnect:()=>void;
}){
 return <section data-notebook-presence-control aria-label="Live editing and notebook participants" className="z-20 shrink-0 border-b border-border bg-background px-3 py-1 sm:px-5">
  <div className="flex min-h-11 min-w-0 items-center gap-2">
   <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Users className="size-4" aria-hidden="true"/><span role="status">{status||"Live editing"}{!connected?" · Presence offline":""}</span></div>
   <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto py-1" aria-label="People in notebooks">
    {self?<span className="shrink-0 px-1" title={"You (@"+self.username+")"}><ProfileAvatar profile={{displayName:self.name,avatar:self.avatar}} name={self.username} className="size-7"/></span>:null}
    {peers.map(peer=><ParticipantButton key={peer.user.id} peer={peer} {...controls}/>)}
    {!peers.length&&connected?<span className="whitespace-nowrap px-2 text-xs text-muted-foreground">Only you here</span>:null}
   </div>
   {!connected?<Button size="action" variant="ghost" onClick={onReconnect}>Retry</Button>:null}
  </div>
  {notice?<p role="status" className="pb-2 text-xs text-muted-foreground">{notice}</p>:null}
 </section>;
}
export function NotebookFollowFrame({peer,onStop}: {peer:NotebookPeer|null;onStop:()=>void}){
 if(!peer)return null;
 return <>
  <div data-notebook-follow-frame aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 rounded-xl border-2" style={{borderColor:peer.user.color,boxShadow:"inset 0 0 0 1px color-mix(in srgb, var(--foreground) 20%, transparent)"}}/>
  <div data-notebook-presence-control className="flex shrink-0 justify-center px-3 py-2">
   <div role="status" className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background py-1 pl-3 pr-1 text-xs shadow-sm" style={{borderColor:"color-mix(in srgb, "+peer.user.color+" 55%, var(--border))"}}>
    <span>Following</span><ProfileAvatar profile={{displayName:peer.user.name,avatar:peer.user.avatar}} name={peer.user.username} className="size-6"/>
    <span className="min-w-0 max-w-40 truncate font-medium" title={"@"+peer.user.username}>@{peer.user.username}</span>
    <span className="sr-only">Click, scroll, type, or press Escape to stop following.</span>
    <Button size="action" variant="ghost" className="shrink-0 rounded-full px-2" aria-label={"Stop following @"+peer.user.username} title="Stop following (Esc)" onClick={onStop}><X className="size-4" aria-hidden="true"/>Stop<kbd className="hidden rounded border border-border px-1 text-[10px] text-muted-foreground md:inline">Esc</kbd></Button>
   </div>
  </div>
 </>;
}
