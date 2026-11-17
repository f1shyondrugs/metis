import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
type Header=React.ComponentType<Record<string,unknown>>;
export function runHeaderFixture({AccountHeader,CalendarHeader,PrimaryHeader}:{AccountHeader:Header;CalendarHeader:Header;PrimaryHeader:Header}){
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 const views=["profile","agent-hub","settings","usage","notifications","calendar","notes","automations","project"];
 const names=["Profile","Agent Hub","Settings","Usage","Notifications","Calendar","Notebooks","Automations","Project"];
 function Fixture(){
  const [view,setView]=useState("settings"),[report,setReport]=useState<string[]>([]),[calls,setCalls]=useState(0),once=useRef(false);
  const callback=()=>setCalls(c=>c+1);
  useEffect(()=>{
   if(once.current)return;once.current=true;
   void(async()=>{
    const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push("PASS "+label);};
    const wait=()=>new Promise(r=>setTimeout(r,60));
    try{
     for(let i=0;i<views.length;i++){
      setView(views[i]);await wait();
      const header=document.querySelector("header")!,title=header.querySelector("h1, p")!,rect=header.getBoundingClientRect();
      check(views[i]==="project"?title.textContent!.includes("A very long project"):title.textContent!.trim()===names[i],"current title: "+names[i]);
      check(rect.height===(innerWidth>=768?48:56),"single compact row: "+names[i]);
      check(header.scrollWidth<=header.clientWidth,"header fits: "+names[i]);
      check(title.getBoundingClientRect().width>0,"title stays visible: "+names[i]);
      const visibleButtons=Array.from(header.querySelectorAll("button")).filter(b=>b.getBoundingClientRect().width>0);
      check(visibleButtons.every(b=>b.getBoundingClientRect().height>=(innerWidth<768?44:32)),"usable controls: "+names[i]);
      const back=header.querySelector<HTMLButtonElement>('[aria-label="Back to chat"]');
      if(i<5){check(Boolean(back)&&back!.textContent==="","icon-only back: "+names[i]);check(back!.title==="Back to chat","back tooltip: "+names[i]);back!.focus();check(document.activeElement===back,"keyboard focus: "+names[i]);back!.click();await wait();}
      else check(!back,"primary workspace keeps sidebar navigation: "+names[i]);
     }
     check(document.documentElement.scrollWidth<=innerWidth,"no horizontal page overflow");
     setView("settings");await wait();
     check(Number(document.querySelector("[data-calls]")?.textContent)===5,"all five back callbacks preserved");
     const mobile=document.querySelector<HTMLButtonElement>('[aria-label="Open sidebar"]')!;
     if(innerWidth<768){mobile.click();await wait();check(Number(document.querySelector("[data-calls]")?.textContent)===6,"mobile sidebar callback preserved");}
     setView("calendar");await wait();
     const toggle=document.querySelector<HTMLButtonElement>('[aria-label="Hide sidebar"]')!;
     if(innerWidth>=768){toggle.click();await wait();check(Number(document.querySelector("[data-calls]")?.textContent)===6,"desktop sidebar callback preserved");}
     setView("settings");
    }catch(e){checks.push("FAIL "+String(e));}
    setReport(checks);
    await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:innerWidth,checks,failed:checks.filter(x=>x.startsWith("FAIL"))})});
   })();
  },[]);
  const isAccount=views.indexOf(view)<5;
  return <div className="min-h-dvh bg-background text-foreground">
   <nav className="flex flex-wrap gap-1 border-b border-border p-3" aria-label="Isolated header preview">
    {views.map((v,i)=><button key={v} className="rounded-md px-3 py-2 text-xs hover:bg-muted" aria-pressed={view===v} onClick={()=>setView(v)}>{names[i]}</button>)}
   </nav>
   <div className="flex min-h-[480px]">
    <aside className="hidden w-48 shrink-0 border-r border-border p-4 text-sm md:block"><p className="mb-6 font-medium">Metis</p>{["Notebooks","Calendar","Automations"].map(x=><p className="py-2 text-muted-foreground" key={x}>{x}</p>)}</aside>
    <section className="min-w-0 flex-1">
     {isAccount?<AccountHeader view={view} onClose={callback} onOpenNav={callback}/>:view==="calendar"?<CalendarHeader onOpenSidebar={callback} onToggleSidebar={callback}/>:<PrimaryHeader section={view} onOpenNav={callback} onToggleSidebar={callback}/>}
     <div className="p-6 text-sm text-muted-foreground"><p>Isolated production-header preview</p><p className="mt-2">Page content is omitted. No account data.</p></div>
    </section>
   </div>
   <details className="border-t border-border p-3 text-xs text-muted-foreground"><summary>{report.length} header checks · callback count <span data-calls="">{calls}</span></summary><pre className="whitespace-pre-wrap">{report.join("\n")}</pre></details>
  </div>;
 }
 createRoot(document.getElementById("root")!).render(<Fixture/>);
}
