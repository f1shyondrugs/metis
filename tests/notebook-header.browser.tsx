import React,{useState,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {useNotebookPresence} from "../components/notes/use-notebook-presence";
import {NotebookPresenceBar,NotebookFollowFrame} from "../components/notes/notebook-presence-bar";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
import type {NotebookPeer,NotebookPerson} from "../lib/notebook-presence";
const self:NotebookPerson={id:"self",username:"amy",name:"Amy",avatar:null,color:"#aa7733"};
const peer=(id:string,noteId="alpha",sessionId=id):NotebookPeer=>({sessionId,user:{...self,id,username:id,name:id,color:"#3388aa"},note:{id:noteId,title:noteId},view:{scroll:0}});
let latest:NotebookPeer[]=[];
class PresenceSocket{
 static OPEN=1;static sockets:PresenceSocket[]=[];readyState=1;
 onmessage:((event:{data:string})=>void)|null=null;onclose:((event:{code:number})=>void)|null=null;onerror:(()=>void)|null=null;
 timer:ReturnType<typeof setInterval>;sent:unknown[]=[];
 constructor(){PresenceSocket.sockets.push(this);this.timer=setInterval(()=>this.snapshot(latest),5000);queueMicrotask(()=>this.snapshot(latest));}
 send(body:string){this.sent.push(JSON.parse(body));}
 snapshot(peers:NotebookPeer[]){if(this.readyState===1)this.onmessage?.({data:JSON.stringify({type:"presence",self,sessionId:"self-session",peers})});}
 close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({code:1000});}
 reject(){clearInterval(this.timer);this.readyState=3;this.onclose?.({code:4403});}
}
Object.assign(window,{WebSocket:PresenceSocket});
export function runNotebookHeaderFixture(Breadcrumb:React.ComponentType<Record<string,unknown>>){
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 function Fixture(){
  const root=useRef<HTMLDivElement>(null),once=useRef(false);
  const [noteId,setNoteId]=useState<string|null>("alpha"),[report,setReport]=useState<string[]>([]),[blocked,setBlocked]=useState(false),[project,setProject]=useState({id:"example",name:"Example project",icon:"code",color:"#ffcc00",logoStoredName:null as string|null,updatedAt:"2026-11-15"});
  const presence=useNotebookPresence({ownerId:self.id,noteId,active:true,root,openNote:async id=>{setNoteId(id);return true;}});
  useEffect(()=>{
   if(once.current)return;once.current=true;
   const wait=()=>new Promise(r=>setTimeout(r,80)),bar=()=>document.querySelector('[aria-label="Live editing and notebook participants"]');
   const snapshot=async(peers:NotebookPeer[])=>{latest=peers;PresenceSocket.sockets.at(-1)!.snapshot(peers);await wait();};
   void(async()=>{const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push("PASS "+label);};
    try{
     await wait();
     check(!bar(),"solo document has no Live editing row or self avatar");
     check(document.querySelector("[data-breadcrumb] svg")!==null,"breadcrumb uses actual project glyph");
     check((document.querySelector("[data-breadcrumb] span")as HTMLElement)?.style.color==="rgb(255, 204, 0)","breadcrumb preserves saved project color");
     await snapshot([peer("self","alpha","second-self-tab")]);check(!bar(),"own second tab does not count as a second person");
     await snapshot([peer("ben","beta","other-note")]);check(!bar(),"another person in a different note does not show current-document row");
     await snapshot([peer("ben","beta","other-note"),peer("ben","alpha","current-note"),peer("ben","alpha","second-device")]);
     check(Boolean(bar()),"matching document session is found even when that account also has another note open");
     check(bar()?.querySelectorAll('[aria-label^="@ben"]').length===1,"multiple sessions of another person render one avatar");
     check(document.querySelector("[data-peer-count]")?.textContent==="1","notebook-wide tree projection remains deduplicated");
     setNoteId("beta");await wait();check(Boolean(bar()),"changing notes selects matching sessions without another server packet");
     setNoteId("gamma");await wait();check(!bar(),"switching to a solo note immediately removes the row");
     setNoteId(null);await wait();check(!bar(),"project overview has no document participant row");
     setNoteId("alpha");await snapshot([peer("ben"),peer("cara")]);check(bar()?.querySelectorAll('[aria-label^="@"]').length===2,"two distinct other accounts render their own avatars");
     await snapshot([peer("ben")]);
     const participant=bar()!.querySelector<HTMLButtonElement>('[aria-label^="@ben"]')!;
     participant.click();await wait();check(Boolean(document.querySelector('[aria-label="Participant @ben"]')),"participant popover remains operable");
     const follow=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent==="Follow")!;
     follow.click();await wait();check(Boolean(document.querySelector("[data-notebook-follow-frame]")),"following still starts from the document row");
     window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait();check(!document.querySelector("[data-notebook-follow-frame]"),"Escape still stops following immediately");
     await snapshot([]);check(!bar(),"last other participant leaving removes the row without a reconnect");
     check(PresenceSocket.sockets.length===1,"solo visibility changes do not destroy the presence connection");
     await snapshot([peer("ben")]);PresenceSocket.sockets.at(-1)!.reject();await wait();
     check(!bar()&&!document.querySelector('[aria-label="People in this document"]'),"disconnect removes stale participant avatars");
     const retry=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent==="Retry");
     check(Boolean(retry)&&document.body.textContent?.includes("new sign-in"),"authentication recovery notice retains explicit Retry");
     retry!.click();await wait();check(PresenceSocket.sockets.length===2,"Retry reconnects through the existing presence hook");
     setBlocked(true);await wait();document.querySelector<HTMLButtonElement>("[data-breadcrumb] button")!.click();await wait();check(document.querySelector("[data-note-id]")?.textContent==="alpha","breadcrumb preserves failed-flush navigation guard");
     setBlocked(false);await wait();document.querySelector<HTMLButtonElement>("[data-breadcrumb] button")!.click();await wait();check(document.querySelector("[data-note-id]")?.textContent==="overview","breadcrumb opens project overview after successful flush");
     setProject(p=>({...p,icon:"rocket",color:"#0088aa",name:"A very long project name to verify icon and label truncation"}));await wait();
     check(Boolean(document.querySelector("[data-breadcrumb] .lucide-rocket")),"breadcrumb follows the configured icon rather than a project-name rule");
     check(document.documentElement.scrollWidth<=innerWidth,"long project breadcrumb does not overflow viewport");
     setProject(p=>({...p,logoStoredName:"synthetic-logo.png"}));await wait();check(Boolean(document.querySelector("[data-breadcrumb] img")),"uploaded project logos replace glyphs in the breadcrumb");
     setProject(p=>({...p,icon:"code",color:"#ffcc00",name:"Example project",logoStoredName:null}));setNoteId("alpha");await snapshot([peer("ben")]);
    }catch(e){checks.push("FAIL "+String(e));}
    setReport(checks);
    await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:innerWidth,checks,failed:checks.filter(x=>x.startsWith("FAIL"))})});
   })();
  },[]);
  return <div className="min-h-dvh bg-background text-foreground">
   <div ref={root} className="relative">
    <header data-breadcrumb="" className="flex min-h-12 items-center border-b border-border px-5 text-sm text-muted-foreground"><Breadcrumb project={project} blocked={blocked} onRoot={()=>setNoteId(null)}/></header>
    <NotebookPresenceBar peers={presence.sessions} self={presence.self} noteId={noteId} connected={presence.connected} notice={presence.notice} following={presence.following} onFollow={presence.follow} onStop={presence.stop} onReconnect={presence.reconnect}/>
    <NotebookFollowFrame peer={presence.following} onStop={presence.stop}/>
    <main data-note-page-scroll className="h-72 overflow-auto p-6"><h1 className="text-lg font-medium">Synthetic notebook document</h1><p className="mt-3 text-sm text-muted-foreground">Actual presence hook, participant controls and breadcrumb JSX. No production data.</p></main>
   </div>
   <div className="flex flex-wrap gap-2 border-t border-border p-4 text-xs"><button className="rounded border px-3 py-2" onClick={()=>{latest=[];PresenceSocket.sockets.at(-1)?.snapshot([]);}}>Solo</button><button className="rounded border px-3 py-2" onClick={()=>{latest=[peer("ben")];PresenceSocket.sockets.at(-1)?.snapshot(latest);}}>Shared document</button><span className="sr-only" data-note-id="">{noteId||"overview"}</span><span className="sr-only" data-peer-count="">{presence.peers.length}</span></div>
   <details className="p-4 text-xs text-muted-foreground"><summary>{report.length} isolated notebook-header checks</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{report.join("\n")}</pre></details>
  </div>;
 }
 createRoot(document.getElementById("root")!).render(<Fixture/>);
}
