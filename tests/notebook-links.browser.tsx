import React,{useEffect,useRef,useState} from "react";import {createRoot} from "react-dom/client";
import {NotesBlockEditor} from "../components/notes/block-editor";import {RichUserText} from "../components/rich-user-text";import {Markdown} from "../components/markdown";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
type FixtureData={noteId:string;shareToken:string;lockedToken:string;expiredToken:string};
const opened:string[]=[],notes:string[]=[];const realOpen=window.open.bind(window);
window.open=((url?:string|URL)=>{opened.push(String(url));return null;})as typeof window.open;
applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
function Fixture({data}:{data:FixtureData}){
 const base=location.origin,external=base+"/destination",local=base+"/?c=notes#note-"+data.noteId,shared=base+"/share/notes/"+data.shareToken;
 const source="[Website]("+external+")\n\n[Private note]("+local+")\n\n[Shared notebook]("+shared+")\n\n[Internal note](note://"+data.noteId+")";
 const [value,setValue]=useState(source),[report,setReport]=useState<string[]>([]),once=useRef(false);
 useEffect(()=>{
  if(once.current)return;once.current=true;
  const sleep=(ms=50)=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn:()=>unknown,label:string)=>{for(let n=0;n<200;n++){if(fn())return;await sleep();}throw Error(label);};
  const editorLink=(label:string)=>Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-editor] .ProseMirror a")).find(a=>a.textContent?.trim()===label)!;
  const preview=()=>document.querySelector<HTMLElement>("[data-hover-preview]");
  const hover=async(a:HTMLAnchorElement)=>{a.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,relatedTarget:document.body}));a.dispatchEvent(new MouseEvent("mouseenter",{relatedTarget:document.body}));await until(preview,"preview did not open");};
  const escape=async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await until(()=>!preview(),"Escape did not close preview");};
  void(async()=>{const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push("PASS "+label);};
   try{
    await until(()=>editorLink("Website"),"real editor did not mount");
    let n=opened.length;editorLink("Website").click();check(opened.length===n+1&&opened.at(-1)===external,"plain editor click opens website once");
    for(const key of ["ctrlKey","metaKey"]){n=opened.length;editorLink("Website").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,[key]:true}));check(opened.length===n+1,"editor modifier click opens once: "+key);}
    n=opened.length;editorLink("Website").dispatchEvent(new MouseEvent("auxclick",{bubbles:true,cancelable:true,button:1}));check(opened.length===n+1,"editor middle click opens once");
    editorLink("Private note").click();check(notes.at(-1)===data.noteId,"copied private notebook URL opens the canonical note");
    editorLink("Internal note").click();check(notes.at(-1)===data.noteId,"custom note link retains internal navigation");
    const root=document.querySelector<HTMLElement>("[data-editor] .notes-block-editor")!,download=document.createElement("a");download.href=base+"/api/fixture-download";download.download="example.txt";root.append(download);let downloadIntercepted=false;download.addEventListener("click",event=>{downloadIntercepted=event.defaultPrevented;event.preventDefault();});n=opened.length;download.click();check(!downloadIntercepted&&opened.length===n,"attachment download keeps native download behavior");download.remove();
    const legacy=document.createElement("a");legacy.href="/tmp/example.md";root.append(legacy);let filePath="";const fileListener=(event:Event)=>{filePath=(event as CustomEvent).detail.path;};window.addEventListener("ai-chat:open-file",fileListener);legacy.click();window.removeEventListener("ai-chat:open-file",fileListener);legacy.remove();check(filePath==="/tmp/example.md","legacy file link keeps canonical file-workspace navigation");
    await hover(editorLink("Website"));await until(()=>preview()?.textContent?.includes("Example website"),"web preview metadata missing");
    const a=editorLink("Website"),card=preview()!;
    a.dispatchEvent(new MouseEvent("mouseleave",{relatedTarget:card}));card.dispatchEvent(new MouseEvent("mouseenter",{relatedTarget:a}));card.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,relatedTarget:a}));await sleep(300);
    check(Boolean(preview()),"pointer can cross from editor link into preview without it disappearing");
    check(getComputedStyle(preview()!).pointerEvents!=="none","preview accepts pointer input");
    n=opened.length;preview()!.querySelector<HTMLButtonElement>("[data-preview-open-link]")!.click();check(opened.length===n+1,"preview Open link activates original editor link exactly once");await until(()=>!preview(),"preview did not close after activation");
    await hover(editorLink("Private note"));await until(()=>preview()?.textContent?.includes("Synthetic private note"),"private note preview missing");
    const before=notes.length;preview()!.querySelector<HTMLButtonElement>("[data-preview-open-link]")!.click();check(notes.length===before+1,"private preview uses original canonical navigation");await until(()=>!preview(),"private preview remained");
    const sent=document.querySelector<HTMLAnchorElement>("[data-sent] a")!;await hover(sent);await until(()=>preview()?.textContent?.includes("Shared root preview"),"shared URL did not resolve as a notebook");
    check(Boolean(preview()?.querySelector("[data-shared-note-preview]")),"pasted shared notebook URL shows dedicated notebook hover content");
    check(!preview()?.textContent?.includes("Shared notes unavailable"),"shared preview is not generic login-page metadata");
    const box=preview()!.getBoundingClientRect();check(box.left>=0&&box.right<=innerWidth+1,"shared hover card fits viewport");
    sent.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));await sleep();check(document.activeElement===preview()?.querySelector("[data-preview-open-link]"),"keyboard can enter the interactive preview");
    await escape();check(!preview(),"Escape dismisses interactive preview");
    const locked=document.querySelector<HTMLAnchorElement>("[data-locked] a")!;await hover(locked);await until(()=>preview()?.textContent?.includes("Password required"),"locked preview state missing");check(!preview()?.textContent?.includes("LOCKED_SECRET_CONTENT"),"locked share preview exposes no protected content");await escape();
    const expired=document.querySelector<HTMLAnchorElement>("[data-expired] a")!;await hover(expired);await until(()=>preview()?.textContent?.includes("expired or been revoked"),"expired preview state missing");check(Boolean(preview()?.querySelector("[data-preview-open-link]")),"unavailable preview still offers original link");await escape();
    check(document.querySelector("[data-source]")?.textContent===source,"opening links leaves Markdown contents unchanged");
    check(document.documentElement.scrollWidth<=innerWidth,"no horizontal overflow");
    await hover(editorLink("Shared notebook"));await until(()=>preview()?.textContent?.includes("Shared root preview"),"final preview missing");
   }catch(e){checks.push("FAIL "+String(e));}
   setReport(checks);await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:innerWidth,checks,failed:checks.filter(x=>x.startsWith("FAIL"))})});
  })();
 },[data,source,external,base]);
 return <main className="min-h-dvh bg-background p-4 text-foreground">
  <div data-editor=""><NotesBlockEditor noteId="fixture-current" value={value} onChange={setValue} onOpenNote={id=>notes.push(id)} autoFocus={false}/></div>
  <section className="mt-5 space-y-3 text-sm"><div data-sent=""><RichUserText content={shared}/></div><div data-locked=""><Markdown content={"[Locked notebook]("+base+"/share/notes/"+data.lockedToken+")"}/></div><div data-expired=""><Markdown content={"[Expired notebook]("+base+"/share/notes/"+data.expiredToken+")"}/></div></section>
  <pre data-source="" className="sr-only">{value}</pre>
  <button className="mt-4 rounded border border-border px-3 py-2 text-xs" onClick={()=>{window.open=realOpen;}}>Enable real local-tab navigation</button>
  <details className="mt-4 text-xs text-muted-foreground"><summary>{report.length} isolated link checks</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{report.join("\n")}</pre></details>
 </main>;
}
fetch("/fixture.json").then(r=>r.json()).then(data=>createRoot(document.getElementById("root")!).render(<Fixture data={data}/>));
