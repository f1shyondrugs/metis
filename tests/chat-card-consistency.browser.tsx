import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import {PlanWorkspaceCard} from "../components/plan-workspace-card";
import {CanvasWorkspaceCard} from "../components/canvas-workspace-card";
import {AutomationCard} from "../components/automation-card";
import {CalendarEventCard} from "../components/calendar/calendar-event-card";
import {Markdown} from "../components/markdown";
import {ToolCallGroup, type ToolCallData} from "../components/tool-call-chip";
import {PublicMarkdownContext} from "../components/public-markdown-context";

const id="12345678-1234-1234-1234-123456789abc";
const savedTools: ToolCallData[] = (["plan", "canvas"] as const).map(kind => ({
 id: kind, kind, name: "create_" + kind, status: "completed",
 result: JSON.stringify({id: "saved-" + kind, name: "Deferred " + kind, content: "Saved workspace", workspaceLink: "workspace://" + kind + "/saved-" + kind}),
 // The fixture intentionally returns 404 for optional transcript details.
 resultUrl: "/api/chats/workspace-fixture/tool-result?messageId=old&toolId=" + kind,
}));
function Fixture(){
 const [opened,setOpened]=useState(""),[result,setResult]=useState("");
 useEffect(()=>{const listener=(event:Event)=>setOpened((event as CustomEvent).detail.id);window.addEventListener("ai-chat:open-calendar-event",listener);return()=>window.removeEventListener("ai-chat:open-calendar-event",listener);},[]);
 async function run(){
  const checks:string[]=[];
  const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks.push(label);};
  try{
   const cards=[...document.querySelectorAll<HTMLElement>(".markdown-body > [data-chat-card]")];
   check(cards.length===4,"all four card kinds share the frame");
   const titles=cards.map(card=>card.querySelector<HTMLElement>("[data-chat-card-title]")!);
   check(titles.every(title=>getComputedStyle(title).fontSize==="14px"&&getComputedStyle(title).fontWeight==="600"),"titles remain 14px semibold inside real chat Markdown");
   check(cards.every(card=>getComputedStyle(card.querySelector("header")!).paddingLeft==="16px"),"header padding is consistent");
   check(cards.every(card=>getComputedStyle(card).borderTopLeftRadius===getComputedStyle(cards[0]).borderTopLeftRadius),"card corners match");
   const opens=cards.map(card=>[...card.querySelectorAll<HTMLElement>("footer button,footer a")].find(e=>e.textContent?.startsWith("Open "))!);
   check(opens.every(Boolean),"each open action is labeled in the footer");
   check(opens.every(e=>e.getAttribute("data-variant")==="outline"),"open actions use the same button variant");
   check(opens.every(e=>getComputedStyle(e).fontSize==="14px"),"open labels have one text size");
   check(opens.every(e=>e.getBoundingClientRect().height>=(innerWidth<640?44:32)),"open controls retain responsive touch targets");
   check(document.querySelector("[data-calendar-event-card] dl")&&getComputedStyle(document.querySelector("[data-calendar-event-card] dl")!).fontSize==="14px","calendar details are readable");
   check(document.querySelector("[data-calendar-event-card]")?.textContent?.includes("18 Nov 2026"),"calendar values remain unchanged");
   check(getComputedStyle(document.querySelector("[data-calendar-event-card]")!).borderLeftColor==="rgb(177, 75, 201)","calendar color survives");
   check(document.querySelector("[data-workspace-card=canvas]")?.textContent?.includes("Test erfolgreich"),"canvas retains original Markdown preview");
   check(!!document.querySelector("[data-workspace-card=plan] [role=progressbar]"),"plan progress survives");
   check([...document.querySelectorAll("[data-workspace-card=plan] button")].some(e=>e.textContent==="Build"),"plan Build action survives");
   for(const [index,label] of [[0,"plan"],[1,"canvas"],[3,"automation"]] as const){opens[index].click();await new Promise(r=>setTimeout(r,20));check(document.querySelector("[data-opened]")?.textContent===label,label+" opening callback survives");}
   for (const kind of ["plan", "canvas"] as const) {
    const open = [...document.querySelectorAll<HTMLButtonElement>(`[data-deferred-tools] [data-workspace-card=${kind}] footer button`)].find(button => button.textContent === "Open " + kind);
    check(open, "deferred " + kind + " open control is present");
    open!.click();
    await new Promise(r => setTimeout(r, 100));
    check(document.querySelector("[data-opened]")?.textContent === "saved-" + kind, "deferred " + kind + " opens from saved ID with missing transcript");
   }
   const event=opens[2] as HTMLAnchorElement;
   check(event.getAttribute("href")==="/?c=calendar#event-"+id,"calendar retains canonical fallback URL");
   const modified=new MouseEvent("click",{bubbles:true,cancelable:true,ctrlKey:true});
   const stopNavigation=(e:Event)=>{check(!e.defaultPrevented,"modified calendar click remains native");e.preventDefault();};
   event.addEventListener("click",stopNavigation,{once:true});event.dispatchEvent(modified);
   event.click();await new Promise(r=>setTimeout(r,20));
   check(document.querySelector("[data-opened]")?.textContent===id,"calendar click dispatches canonical event identity");
   const links=[...document.querySelectorAll<HTMLElement>("[data-object-links] a")];
   check(links.length===5&&links.every(link=>getComputedStyle(link).textDecorationLine.includes("underline")),"object links remain underlined text, not chips");
   check(links.every(link=>link.querySelector("[data-link-icon-kind]")),"object links retain consistent icons");
   check(document.querySelector("[data-private]")?.textContent==="Calendar event (private)"&&!document.querySelector("[data-private] a"),"public share contains no calendar details or opening action");
   check(document.documentElement.scrollWidth<=innerWidth,"no horizontal viewport overflow");
   const data={passed:true,width:innerWidth,theme:document.documentElement.classList.contains("dark")?"dark":"light",checks};
   setResult("PASS · "+checks.length+" checks");await fetch("/report",{method:"POST",body:JSON.stringify(data)});
  }catch(error){setResult("FAIL · "+String(error));await fetch("/report",{method:"POST",body:JSON.stringify({passed:false,width:innerWidth,checks,error:String(error)})});}
 }
 return <main style={{maxWidth:720,margin:"0 auto",padding:16,fontFamily:"Arial, sans-serif"}} className="assistant-message-text">
  <div style={{display:"flex",gap:12,alignItems:"center",fontSize:12,marginBottom:12}}><span>Synthetic UI check · {innerWidth}px</span><button type="button" onClick={()=>void run()}>Run checks</button><output>{result}</output></div>
  <div className="markdown-body">
   <PlanWorkspaceCard title="Testplan – Linktest" content={"Testplan\n\n- [x] Links prüfen\n- [ ] Darstellung abstimmen"} onOpen={()=>setOpened("plan")} onBuild={()=>setOpened("build")}/>
   <CanvasWorkspaceCard title="Testcanvas – Linktest" content={"# Testcanvas\n\nDiese Fläche dient ausschließlich zum Testen des direkten Canvas-Links.\n\n**Test erfolgreich**, wenn dieser Text nach dem Öffnen sichtbar ist."} onOpen={()=>setOpened("canvas")}/>
   <CalendarEventCard id={id}/>
   <AutomationCard actionLabel="Automation · Paused" title="Testautomation – Linktest" icon="lucide:workflow" prompt="Testautomation für den direkten Link. Bleibt pausiert." scheduleLabel="Daily · 09:00" automationLink="automation://test" onOpen={()=>setOpened("automation")}/>
   <div data-object-links><Markdown content={"1. [Automation](automation://test) – **pausiert**, läuft nicht.\n2. [Notiz](note://test)\n3. [Plan](workspace://plan/test)\n4. [Canvas](workspace://canvas/test)\n5. [Testevent](calendar-event://"+id+")"}/></div>
  </div>
  <div data-deferred-tools><ToolCallGroup tools={savedTools} onOpenWorkspace={(_, workspaceId) => setOpened(workspaceId ?? "missing workspace ID")}/></div>
  <div style={{fontSize:12,marginTop:16}} data-opened>{opened}</div>
  <div data-private><PublicMarkdownContext.Provider value={{noteIds:[],assets:{}}}><CalendarEventCard id="private"/></PublicMarkdownContext.Provider></div>
 </main>;
}
document.documentElement.classList.toggle("dark",new URLSearchParams(location.search).get("theme")!=="light");
createRoot(document.getElementById("root")!).render(<Fixture/>);
