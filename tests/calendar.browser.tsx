import React from "react";import {createRoot} from "react-dom/client";
import {CalendarPanel} from "../components/calendar/calendar-panel";
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
async function press(e:HTMLElement|undefined|null){if(!e)throw Error("Missing control");e.click();await wait();}
function fill(e:HTMLInputElement|HTMLTextAreaElement,value:string){const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value")!.set!.call(e,value);e.dispatchEvent(new Event("input",{bubbles:true}));}
async function until(predicate:()=>boolean){for(let i=0;i<100&&!predicate();i++)await wait(50);if(!predicate())throw Error("Timed out waiting for UI");}
async function run(){
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
if(!new URLSearchParams(location.search).has("manual"))run().catch(async e=>{results.push("FAIL "+String(e));await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});});
