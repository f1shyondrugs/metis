import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {CalendarWorkspace} from "../components/calendar/calendar-workspace";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
type Harness={state:{accountView:string|null;notesOpen:boolean;automationsOpen:boolean;loads:string[]};calendarOpen:boolean;chatId:string|null;reconcile:()=>void;openCalendar:()=>void;openNotes:()=>void;openAutomations:()=>void;openChat:(id:string)=>void};
const wait=(ms=30)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){for(let n=0;n<300;n++){if(check())return;await wait();}throw Error("Navigation did not settle");}
export function runCalendarRoutingFixture(create:(browser:Window)=>Harness){
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 function Fixture(){
  const [h]=useState(()=>{const result=create(window);result.reconcile();return result;}),[,update]=useState(0),[report,setReport]=useState<string[]>([]),[sidebar,setSidebar]=useState(true);
  const once=useRef(false);
  const paint=()=>update(n=>n+1);
  useEffect(()=>{const pop=()=>{h.reconcile();paint();};window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop);},[h]);
  useEffect(()=>{
   if(once.current)return;once.current=true;
   void(async()=>{
    const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push("PASS "+label);setReport([...checks]);};
    const open=async(label:string,c:string)=>{document.querySelector<HTMLButtonElement>('[data-nav="'+label+'"]')!.click();await until(()=>new URLSearchParams(location.search).get("c")===c&&Boolean(document.querySelector("[data-calendar-workspace]"))===(c==="calendar"));};
    try{
     await until(()=>Boolean(document.querySelector(".fc"))&&document.body.textContent?.includes("Design review")===true);
     check(new URLSearchParams(location.search).get("c")==="calendar","direct calendar URL initializes the real Calendar workspace");
     check(h.state.accountView===null,"Calendar is not an account view");
     check(!document.body.textContent?.includes("Back to chat"),"no account-page Back to chat header");
     check(!document.querySelector("textarea"),"chat composer is not mounted");
     check(document.querySelector('[data-nav=Calendar]')?.getAttribute("aria-current")==="page","calendar navigation is selected from the URL");
     check(Boolean(document.querySelector('[aria-label="Calendar"] .fc')),"real calendar grid and synthetic events render in the main workspace");
     await open("Notebooks","notes");check(h.state.notesOpen&&!h.calendarOpen,"notes navigation closes Calendar");
     await open("Calendar","calendar");check(!h.state.notesOpen,"Calendar closes Notebooks");
     history.back();await until(()=>new URLSearchParams(location.search).get("c")==="notes"&&!document.querySelector("[data-calendar-workspace]"));
     check(true,"native browser Back returns to Notebooks");
     history.forward();await until(()=>new URLSearchParams(location.search).get("c")==="calendar"&&Boolean(document.querySelector("[data-calendar-workspace]")));
     check(true,"native browser Forward restores Calendar");
     await open("Automations","automations");check(h.state.automationsOpen&&!h.calendarOpen,"Automations remains an independent destination");
     await open("Calendar","calendar");check(!h.state.automationsOpen,"Calendar closes Automations");
     await open("Chat","fixture-chat");check(h.chatId==="fixture-chat","returning to a chat keeps its identity");
     await open("Calendar","calendar");
     check(!h.state.loads.includes("calendar"),"reserved Calendar route is never loaded as a chat");
     await until(()=>Boolean(document.querySelector(".fc")));
     check(document.documentElement.scrollWidth<=innerWidth,"no horizontal overflow at "+innerWidth+"px");
    }catch(error){checks.push("FAIL "+String(error));setReport([...checks]);}
    await fetch("/routing-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:innerWidth,checks,failed:checks.filter(x=>x.startsWith("FAIL")),url:location.search})});
   })();
  },[h]);
  return <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
   <nav aria-label="Fixture navigation" className="flex shrink-0 flex-wrap gap-2 border-b border-border p-2 text-xs">
    {(["Calendar","Notebooks","Automations","Chat"]as const).map(label=><button key={label} data-nav={label} aria-current={label==="Calendar"&&h.calendarOpen?"page":undefined} className="rounded-md px-2 py-1 aria-[current=page]:bg-secondary"
      onClick={()=>{if(label==="Chat")h.openChat("fixture-chat");else if(label==="Notebooks")h.openNotes();else if(label==="Automations")h.openAutomations();else h.openCalendar();paint();}}>{label}</button>)}
   </nav>
   {h.calendarOpen?<CalendarWorkspace onOpenSidebar={()=>setSidebar(v=>!v)} onToggleSidebar={()=>setSidebar(v=>!v)} sidebarOpen={sidebar}/>:<main aria-label="Other workspace"><p>{h.state.notesOpen?"Notebooks":h.state.automationsOpen?"Automations":"Chat"}</p><textarea aria-label="Message"/></main>}
   <details className="fixed bottom-2 right-2 z-50 max-w-[90vw] rounded-md border border-border bg-background p-2 text-[10px]"><summary>Isolated routing checks ({report.length})</summary><pre className="whitespace-pre-wrap">{report.join("\n")}</pre></details>
  </div>;
 }
 createRoot(document.getElementById("root")!).render(<Fixture/>);
}
