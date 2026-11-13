import React from "react";import {createRoot} from "react-dom/client";
import {CalendarPanel} from "../components/calendar/calendar-panel";
import {CalendarFilter} from "../components/calendar/calendar-filter";
import type {CalendarGroup} from "../lib/calendar/types";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
const results:string[]=[];const wait=(ms=180)=>new Promise(r=>setTimeout(r,ms));const check=(ok:unknown,label:string)=>results.push((ok?"PASS ":"FAIL ")+label);
applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
const nativeFetch=fetch.bind(window);let failSave=false,dropSave=false;
window.fetch=async(input,init)=>{
 if(String(input)==="/api/calendar"&&init?.method==="POST"&&String(init.body).includes('"action":"save"')&&failSave){failSave=false;return Response.json({error:"Synthetic save failure"},{status:503});}
 const r=await nativeFetch(input,init);
 if(String(input)==="/api/calendar"&&init?.method==="POST"&&String(init.body).includes('"action":"save"')&&dropSave){dropSave=false;throw Error("Synthetic lost reply");}
 return r;
};
createRoot(document.getElementById("root")!).render(<main style={{height:"100dvh"}} className="flex min-w-0 bg-background text-foreground"><CalendarPanel/></main>);
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(e=>e.textContent?.trim()===label||e.getAttribute("aria-label")===label);
async function press(e:HTMLElement|undefined|null){if(!e)throw Error("Missing control");if(e.getAttribute("aria-haspopup")==="menu"){e.focus();e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));}else e.click();await wait();}
function fill(e:HTMLInputElement|HTMLTextAreaElement,value:string){const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value")!.set!.call(e,value);e.dispatchEvent(new Event("input",{bubbles:true}));}
async function until(predicate:()=>boolean){for(let i=0;i<100&&!predicate();i++)await wait(50);if(!predicate())throw Error("Timed out waiting for UI");}
async function testCompactFilter(){
 const host=document.createElement("div");host.style.cssText="position:fixed;inset:0;z-index:100;background:var(--background);padding:16px";document.body.append(host);
 const root=createRoot(host);
 const groups=["Metis","Arbeit","Ferien","Privat","Skibidi","Erinnerungen","Klassenarbeiten"].map((name,i)=>({id:"filter-"+i,name,color:"#6387cc",readOnly:i===6} as CalendarGroup));
 let setWidth:(n:number)=>void=()=>{},setGroups:(c:CalendarGroup[])=>void=()=>{};
 function Harness(){
  const [width,widthState]=React.useState(190),[calendars,groupState]=React.useState(groups),[hidden,setHidden]=React.useState<string[]>([]);
  setWidth=widthState;setGroups=groupState;
  return <div style={{width,maxWidth:"100%"}}><CalendarFilter calendars={calendars} hidden={hidden} onToggle={(id,on)=>setHidden(v=>on?v.filter(x=>x!==id):[...v,id])}/></div>;
 }
 root.render(<Harness/>);
 const trigger=()=>host.querySelector<HTMLButtonElement>('[aria-label="Choose calendars"]');
 await until(()=>!!host.querySelector('[data-calendar-filter="dropdown"]'));
 check(!!trigger(),"overflow calendars collapse into a dropdown");
 check(host.getBoundingClientRect().width<=innerWidth,"compact filter fits viewport");
 await press(trigger());
 await until(()=>document.querySelectorAll('[role="menuitemcheckbox"]').length===7);
 check(document.querySelectorAll('[role="menuitemcheckbox"]').length===7,"dropdown includes every calendar");
 check(document.body.textContent?.includes("Read only"),"read-only calendar remains identified");
 const item=document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
 check(item.getBoundingClientRect().height>=44,"dropdown rows have touch targets");
 await press(item);
 check(document.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked")==="false","calendar visibility toggles");
 check(!!document.querySelector('[role="menu"]'),"dropdown stays open for multiple selections");
 document.activeElement?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait();
 check(!document.querySelector('[role="menu"]'),"Escape closes calendar dropdown");
 check(document.activeElement===trigger(),"focus returns to calendar trigger");
 setGroups([groups[0]]);setWidth(300);
 await until(()=>!!host.querySelector('[data-calendar-filter="inline"]'));
 check(host.querySelector<HTMLInputElement>('input:not([disabled])')?.checked===false,"visibility survives switching to inline");
 setGroups(groups);
 await until(()=>!!host.querySelector('[data-calendar-filter="dropdown"]'));
 setWidth(1600);
 await wait();
 if(innerWidth>=1200){check(!!host.querySelector('[data-calendar-filter="inline"]'),"widening restores a single inline row");}
 else check(!!host.querySelector('[data-calendar-filter="dropdown"]'),"available width, not device count, controls collapse");
 root.unmount();host.remove();
 const frame=document.createElement("iframe");frame.src="/sidebar";frame.style.cssText="position:fixed;left:0;top:0;width:260px;height:180px";document.body.append(frame);
 await until(()=>frame.contentDocument?.querySelectorAll("button").length===3);
 const buttons=[...frame.contentDocument!.querySelectorAll("button")],rects=buttons.map(b=>b.getBoundingClientRect());
 check(rects.every(r=>r.height===rects[0].height),"real sidebar buttons have identical heights");
 check(Math.abs((rects[1].top-rects[0].bottom)-(rects[2].top-rects[1].bottom))<1,"real sidebar vertical gaps are uniform");
 frame.remove();
}
async function run(){
 await testCompactFilter();
 await until(()=>!!document.querySelector(".fc-dayGridMonth-view")&&!!button("New event")&&!document.body.textContent?.includes("Loading calendar"));
 check(document.querySelectorAll(".fc-col-header-cell").length===7,"month view has seven day columns");
 check(!!document.querySelector('[aria-label="Calendar"]'),"named calendar region");
 check(document.body.scrollWidth<=innerWidth,"no viewport horizontal overflow");
 await press(button("Week"));check(!!document.querySelector(".fc-timeGridWeek-view"),"week view");
 check(document.querySelector(".fc-timeGridWeek-view")!.getBoundingClientRect().width>=600,"week remains readable in a bounded scroller");
 check(document.body.scrollWidth<=innerWidth,"week does not overflow viewport");
 await press(button("Today"));await press(button("Month"));
 const heading=document.querySelector('h2')?.textContent;await press(button("Next period"));check(document.querySelector("h2")?.textContent!==heading,"next month navigation");await press(button("Previous period"));
 await press(button("New event"));check(!!document.querySelector('[role="dialog"]'),"event editor opens");
 fill(document.querySelector<HTMLInputElement>('input[name="title"]')!,"Browser calendar event");
 failSave=true;await press(button("Save event"));check(!!document.querySelector('[role="dialog"]')&&document.body.textContent?.includes("Synthetic save failure"),"failed save keeps draft and dialog");
 dropSave=true;await press(button("Save event"));await until(()=>!!document.querySelector('[role="alert"]'));check(!!document.querySelector('[role="dialog"]'),"lost reply retains draft");
 await press(button("Save event"));await until(()=>!document.querySelector('[role="dialog"]'));
 check([...document.querySelectorAll(".fc-event-title")].some(e=>e.textContent==="Browser calendar event"),"saved event appears");
 const d=new Date(),start=new Date(d.getFullYear(),d.getMonth(),1).toISOString(),end=new Date(d.getFullYear(),d.getMonth()+1,1).toISOString();
 const snapshot=await(await nativeFetch("/api/calendar?"+new URLSearchParams({start,end}))).json();
 const created=snapshot.events.filter((e:{title:string})=>e.title==="Browser calendar event");check(created.length===1,"lost-reply retry creates exactly one event");
 const el=[...document.querySelectorAll<HTMLElement>(".fc-event")].find(e=>e.textContent?.includes("Browser calendar event"));await press(el);
 await until(()=>!!document.querySelector('input[name="title"]'));
 fill(document.querySelector<HTMLInputElement>('input[name="title"]')!,"Updated browser event");await press(button("Save event"));await until(()=>!document.querySelector('[role="dialog"]'));
 check([...document.querySelectorAll(".fc-event-title")].some(e=>e.textContent==="Updated browser event"),"event editing persists");
 await press([...document.querySelectorAll<HTMLElement>(".fc-event")].find(e=>e.textContent?.includes("Updated browser event")));await until(()=>!!button("Delete"));await press(button("Delete"));
 check(document.body.textContent?.includes("linked copies"),"delete confirmation discloses sync propagation");await press(button("Delete event"));await until(()=>!document.querySelector('[role="dialog"]'));
 await press(button("Connections"));check(document.body.textContent?.includes("iCloud")&&document.body.textContent?.includes("Google"),"native provider connections");
 check(document.body.textContent?.includes("Same calendar names stay in sync"),"matching-name mapping explained");
 check([...document.querySelectorAll<HTMLElement>('input[type="password"]')].every(e=>e.getBoundingClientRect().height===0),"credential forms hidden until requested");
 await press(button("Connect iCloud"));check(!!document.querySelector('input[name="password"][type="password"][data-metis-sensitive]'),"iCloud protected input");
 check(document.body.textContent?.includes("app-specific password"),"iCloud app password guidance");
 await press([...document.querySelectorAll<HTMLElement>("summary")].find(e=>e.textContent?.includes("Google setup")));
 check(!!document.querySelector('input[name="clientSecret"][type="password"][data-metis-sensitive]'),"Google protected client setup");
 const dialog=document.querySelector<HTMLElement>('[role="dialog"]')!,r=dialog.getBoundingClientRect();check(r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,"connection dialog fits viewport");
 document.activeElement?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait();
 await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});
}
const params=new URLSearchParams(location.search);
const start=()=>run().catch(async e=>{results.push("FAIL "+String(e));await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});});
if(params.has("wait")){
 const launch=document.createElement("button");launch.textContent="Run UI checks";launch.style.cssText="position:fixed;bottom:0;right:0;z-index:9999";launch.onclick=()=>{launch.remove();void start();};document.body.append(launch);
}else if(!params.has("manual"))void start();
