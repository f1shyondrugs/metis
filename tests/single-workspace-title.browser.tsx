import React,{useState,useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {AccountPanel,type AccountView} from "../components/account/account-panel";
import {AgentHub} from "../components/agent-hub";
import {AutomationsPanel} from "../components/automations-panel";
import {CalendarWorkspace} from "../components/calendar/calendar-workspace";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
type Header=React.ComponentType<Record<string,unknown>>;
export function runSingleTitleFixture(PrimaryHeader:Header){
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 const native=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  const url=String(input);
  if(url.startsWith("/api/calendar"))return native(input,init);
  if(url.startsWith("/api/account-usage"))return Response.json({usage:{from:"2026-11-01",to:"2026-11-15",timezone:"UTC",totals:{requests:0,inputTokens:0,outputTokens:0,tokens:0,costUsd:null,tokenReports:0,costReports:0,inputReports:0,outputReports:0},days:[],models:[],providers:[]}});
  if(url==="/api/projects")return Response.json({projects:[]});
  if(url==="/api/automations")return Response.json({automations:[]});
  if(url==="/api/notifications/inbox")return Response.json({notifications:[]});
  return Response.json({error:"Synthetic unavailable service"},{status:503});
 };
 const names={calendar:"Calendar",automations:"Automations",profile:"Profile",usage:"Usage",notifications:"Notifications","agent-hub":"Agent Hub"};
 type View=keyof typeof names;
 const intro=["Recurring agent work, with its history and browser state intact.","A little about you, and what you build.","Your activity across models, in one place.","Discover and manage your agent’s skills, connections and instructions."];
 const profile={displayName:"Preview user",bio:"User-authored bio stays visible.",avatar:null,links:[],shareId:null,shareActivity:false,handle:null};
 function Fixture(){
  const [view,setView]=useState<View>("automations"),[report,setReport]=useState<string[]>([]),once=useRef(false);
  useEffect(()=>{
   if(once.current)return;once.current=true;
   const wait=()=>new Promise(r=>setTimeout(r,300));
   void(async()=>{const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push("PASS "+label);};
    const click=(label:string)=>{const b=Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page] button")).find(b=>b.textContent?.trim()===label||b.getAttribute("aria-label")===label);if(!b)throw Error("Missing "+label);b.click();};
    try{
     for(const value of Object.keys(names) as View[]){
      setView(value);await wait();
      const page=document.querySelector<HTMLElement>("[data-page]")!,headings=Array.from(page.querySelectorAll("h1,h2,h3"));
      check(page.querySelectorAll("h1").length===1,"single page h1: "+names[value]);
      check(headings.filter(h=>h.textContent?.trim()===names[value]).length===1,"area name appears only in top heading: "+names[value]);
      check(Boolean(page.querySelector("h1")?.closest("header")),"title in upper header: "+names[value]);
      check(intro.every(text=>!page.textContent?.includes(text)),"no generic introductory description: "+names[value]);
      check(page.scrollWidth<=page.clientWidth,"page fits viewport: "+names[value]);
      if(value==="calendar"){
       check(Boolean(page.querySelector('[aria-label="Sync calendars"]'))&&Boolean(page.querySelector('[aria-label="Connections"]')),"calendar actions retained");
       click("New event");await wait();check(Boolean(document.querySelector('[role="dialog"]')),"calendar creation still opens");document.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();await wait();
      }
      if(value==="automations"){click("Create automation");await wait();check(Boolean(page.querySelector("input")),"automation creation still opens");}
      if(value==="profile"){check(page.textContent?.includes(profile.bio),"user-authored biography retained");click("Edit profile");await wait();check(Boolean(page.querySelector("form")),"profile edit still opens");check(page.querySelectorAll("h1").length===1,"profile edit retains sole top title");}
      if(value==="usage")check(Boolean(page.querySelector('[aria-label="Usage date range"]'))&&Boolean(page.querySelector('[aria-label="Refresh usage"]')),"usage filtering and refresh retained");
      if(value==="notifications")check(page.textContent?.includes("Mark all as read")&&page.textContent?.includes("You’re all caught up"),"notification action and empty state retained");
      if(value==="agent-hub")check(Boolean(page.querySelector('[role="tab"][data-state]'))&&page.textContent?.includes("Connections/MCPs"),"Agent Hub category navigation retained");
     }
     check(document.documentElement.scrollWidth<=innerWidth,"no document horizontal overflow");
    }catch(e){checks.push("FAIL "+String(e));}
    setReport(checks);setView("automations");
    await native("/single-title-report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({width:innerWidth,checks,failed:checks.filter(x=>x.startsWith("FAIL"))})});
   })();
  },[]);
  return <div className="flex h-dvh flex-col bg-background text-foreground">
   <nav className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2 text-xs" aria-label="Isolated page navigation">{(Object.keys(names) as View[]).map(v=><button key={v} className="px-3 py-2" onClick={()=>setView(v)}>{names[v]}</button>)}</nav>
   <div data-page="" className="flex min-h-0 min-w-0 flex-1 flex-col">
    {view==="calendar"?<CalendarWorkspace onOpenSidebar={()=>{}} onToggleSidebar={()=>{}} sidebarOpen/>:view==="automations"?<><PrimaryHeader section="automations"/><AutomationsPanel key={view} onOpenChat={()=>{}} modes={[]}/></>:<AccountPanel key={view} view={view as AccountView} onClose={()=>setView("automations")} onOpenNav={()=>{}} profile={profile} onProfileChange={()=>{}} profileError={false} onRetry={()=>{}}>{view==="agent-hub"?<AgentHub isHostAdmin={false} onModesChanged={()=>{}} onTrySkill={()=>{}}/>:null}</AccountPanel>}
   </div>
   <details className="fixed bottom-2 right-2 z-50 max-w-[90vw] rounded-md border border-border bg-background p-2 text-[10px]"><summary>Isolated full-panel checks ({report.length})</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{report.join("\n")}</pre></details>
  </div>;
 }
 createRoot(document.getElementById("root")!).render(<Fixture/>);
}
