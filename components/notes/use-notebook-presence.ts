"use client";
import {useCallback,useEffect,useRef,useState,type RefObject} from "react";
import {NotebookPresenceConnection} from "@/lib/notebook-presence-connection";
import {notebookScrollPosition,NotebookFollowNavigation,uniqueNotebookPeers,type NotebookPeer,type NotebookPerson,type NotebookSnapshot,type NotebookView} from "@/lib/notebook-presence";

type Options={ownerId:string;noteId:string|null;active:boolean;root:RefObject<HTMLDivElement|null>;openNote:(id:string,blockId?:string,canNavigate?:()=>boolean)=>Promise<boolean>};
export function useNotebookPresence(options:Options){
 const current=useRef(options);current.current=options;
 const [peers,setPeers]=useState<NotebookPeer[]>([]),[self,setSelf]=useState<NotebookPerson|null>(null),[connected,setConnected]=useState(false);
 const [following,setFollowing]=useState<NotebookPeer|null>(null),[notice,setNotice]=useState(""),[attempt,setAttempt]=useState(0);
 const socket=useRef<NotebookPresenceConnection|null>(null),target=useRef<NotebookPeer|null>(null);
 const navigation=useRef(new NotebookFollowNavigation()),inflight=useRef<string|null>(null),uiKey=useRef(""),lastPoint=useRef(""),markerTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const applyRef=useRef<()=>void>(()=>{}),publishRef=useRef<(force?:boolean)=>void>(()=>{});
 const invalidate=useCallback(()=>{navigation.current.stop();},[]);
 const send=useCallback((value:unknown)=>{socket.current?.send(value);},[]);
 const stop=useCallback((message="")=>{
  invalidate();target.current=null;inflight.current=null;setFollowing(null);setNotice(message);lastPoint.current="";
  const marker=current.current.root.current?.querySelector<HTMLElement>("[data-follow-point]");if(marker)marker.hidden=true;
  send({type:"follow",sessionId:null});
 },[send,invalidate]);
 const follow=useCallback((peer:NotebookPeer)=>{
  invalidate();navigation.current.move(peer.sessionId,peer.note.id);inflight.current=null;target.current=peer;setFollowing(peer);setNotice("");
  send({type:"follow",sessionId:peer.sessionId});
  applyRef.current();
 },[send,invalidate]);
 applyRef.current=()=>{
  const peer=target.current,config=current.current,root=config.root.current;
  if(!peer||!root||!peer.view)return;
  const canNavigate=navigation.current.capture();
  if(config.noteId!==peer.note.id){
   if(inflight.current===peer.note.id)return;
   inflight.current=peer.note.id;
   void config.openNote(peer.note.id,undefined,()=>current.current.active&&canNavigate()&&target.current?.sessionId===peer.sessionId&&target.current?.note.id===peer.note.id).then(ok=>{
    if(!canNavigate()||target.current?.note.id!==peer.note.id)return;
    inflight.current=null;
    if(!ok)stop("Following paused. Save your draft or resolve its conflict before switching notes.");
    else requestAnimationFrame(()=>applyRef.current());
   }).catch(()=>{if(canNavigate()&&target.current?.note.id===peer.note.id)stop("Could not open the participant’s note. Your draft is preserved.");});
   return;
  }
  const scroller=root.querySelector<HTMLElement>("[data-note-page-scroll]");
  if(!scroller)return;
  const top=peer.view.scroll*Math.max(0,scroller.scrollHeight-scroller.clientHeight);
  if(Math.abs(scroller.scrollTop-top)>2)scroller.scrollTop=top;
  const point=peer.view.point,marker=root.querySelector<HTMLElement>("[data-follow-point]");
  const key=peer.sessionId+":"+peer.note.id+":"+point?.seq;
  if(point&&marker&&key!==lastPoint.current){
   lastPoint.current=key;
   const viewport=scroller.getBoundingClientRect(),frame=root.getBoundingClientRect();
   marker.style.left=viewport.left-frame.left+point.x*viewport.width+"px";
   marker.style.top=viewport.top-frame.top+point.y*viewport.height+"px";
   marker.style.backgroundColor=peer.user.color;marker.hidden=false;
   if(markerTimer.current)clearTimeout(markerTimer.current);
   markerTimer.current=setTimeout(()=>{marker.hidden=true;},1100);
  }
 };
 useEffect(()=>{
  if(!options.active||!options.ownerId){stop();setPeers([]);setSelf(null);setConnected(false);return;}
  let disposed=false;
  setPeers([]);setSelf(null);setConnected(false);uiKey.current="";
  function receivePeer(peer:NotebookPeer){
   if(target.current?.sessionId!==peer.sessionId)return;
   if(navigation.current.move(peer.sessionId,peer.note.id))inflight.current=null;
   target.current=peer;
   setFollowing(previous=>previous&&JSON.stringify([previous.user,previous.note])===JSON.stringify([peer.user,peer.note])?previous:peer);
   applyRef.current();
  }
  const connection=new NotebookPresenceConnection({
   ownerId:options.ownerId,
   url:(location.protocol==="https:"?"wss://":"ws://")+location.host,
   onConnected:()=>{if(!disposed){setConnected(true);setNotice("");publishRef.current(true);}},
   onPacket:packet=>{
    if(disposed)return;
    try{
     if(packet.type==="presence"){
      const snapshot=packet as unknown as NotebookSnapshot;
      if(snapshot.self.id!==current.current.ownerId)return;
      setSelf(previous=>JSON.stringify(previous)===JSON.stringify(snapshot.self)?previous:snapshot.self);
      const people=uniqueNotebookPeers(snapshot.peers,snapshot.self.id).sort((a,b)=>a.user.username.localeCompare(b.user.username));
      const key=JSON.stringify(people.map(peer=>({sessionId:peer.sessionId,user:peer.user,note:peer.note})));
      if(uiKey.current!==key){uiKey.current=key;setPeers(people);}
      if(target.current){
       const peer=snapshot.peers.find(peer=>peer.sessionId===target.current?.sessionId);
       if(!peer)stop("This participant left or their note is unavailable.");else receivePeer(peer);
      }
     }else if(packet.type==="view")receivePeer(packet.peer as NotebookPeer);
     else if(packet.type==="follow-stopped")stop(typeof packet.message==="string"?packet.message:"Following stopped.");
    }catch{/* Ignore invalid transport data without changing a document. */}
   },
   onDisconnected:code=>{
    if(disposed)return;
    setConnected(false);setPeers([]);uiKey.current="";
    stop(code===4403?"Notebook presence needs a new sign-in. Your editor and draft are preserved.":"Reconnecting notebook presence. Your editor and draft are preserved.");
   },
  });
  socket.current=connection;connection.start();
  const wake=()=>{if(document.visibilityState!=="hidden")connection.wake();};
  window.addEventListener("online",wake);window.addEventListener("pageshow",wake);document.addEventListener("visibilitychange",wake);
  return()=>{disposed=true;window.removeEventListener("online",wake);window.removeEventListener("pageshow",wake);document.removeEventListener("visibilitychange",wake);if(markerTimer.current)clearTimeout(markerTimer.current);connection.destroy();if(socket.current===connection)socket.current=null;invalidate();target.current=null;inflight.current=null;setFollowing(null);};
 },[options.active,options.ownerId,attempt,stop,invalidate]);
 useEffect(()=>{
  const root=options.root.current;
  if(!root||!options.active)return;
  let scheduled:ReturnType<typeof setTimeout>|null=null,frame=0,lastSent="";
  let point:NotebookView["point"],pointNote:string|null=null,seq=0;
  const publish=(force=false)=>{
   if(force)lastSent="";
   if(scheduled)return;
   scheduled=setTimeout(()=>{
    scheduled=null;
    const config=current.current,scroller=root.querySelector<HTMLElement>("[data-note-page-scroll]");
    const view:NotebookView={scroll:notebookScrollPosition(scroller),...(point&&pointNote===config.noteId?{point}:{})};
    const payload={type:"update",noteId:config.noteId,view},encoded=JSON.stringify(payload);
    if(encoded!==lastSent&&socket.current?.connected){lastSent=encoded;send(payload);}
   },160);
  };
  publishRef.current=publish;
  const control=(event:Event)=>event.target instanceof Element&&Boolean(event.target.closest("[data-notebook-presence-control]"));
  const pointer=(event:PointerEvent)=>{
   if(control(event))return;
   if(target.current)stop();
   const scroller=root.querySelector<HTMLElement>("[data-note-page-scroll]");
   if(scroller&&scroller.contains(event.target as Node)){
    const r=scroller.getBoundingClientRect();
    if(r.width<=0||r.height<=0)return;
    pointNote=current.current.noteId;
    point={x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height)),seq:++seq};
    publish();
   }
  };
  const manual=(event:Event)=>{if(!control(event)&&target.current)stop();};
  const key=(event:KeyboardEvent)=>{
   if(event.key==="Escape"&&target.current){event.preventDefault();event.stopImmediatePropagation();stop();return;}
   if(control(event))return;
   if(!["Tab","Shift","Alt","Control","Meta"].includes(event.key)&&root.contains(event.target as Node)&&target.current)stop();
  };
  const changed=()=>{publish();};
  const reapply=()=>{publish();if(target.current){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>applyRef.current());}};
  root.addEventListener("pointerdown",pointer,true);root.addEventListener("wheel",manual,{capture:true,passive:true});root.addEventListener("touchstart",manual,{capture:true,passive:true});
  window.addEventListener("keydown",key,true);root.addEventListener("scroll",changed,true);root.addEventListener("load",reapply,true);
  const observer=new MutationObserver(reapply);observer.observe(root,{childList:true,subtree:true});
  const resize=new ResizeObserver(reapply);resize.observe(root);
  publish(true);
  return()=>{if(scheduled)clearTimeout(scheduled);cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();publishRef.current=()=>{};root.removeEventListener("pointerdown",pointer,true);root.removeEventListener("wheel",manual,true);root.removeEventListener("touchstart",manual,true);window.removeEventListener("keydown",key,true);root.removeEventListener("scroll",changed,true);root.removeEventListener("load",reapply,true);};
 },[options.active,options.root,send,stop]);
 useEffect(()=>{publishRef.current(true);requestAnimationFrame(()=>applyRef.current());},[options.noteId]);
 return {peers,self,connected,following,notice,follow,stop,reconnect:()=>setAttempt(value=>value+1)};
}
