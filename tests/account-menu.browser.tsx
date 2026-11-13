import React from "react";
import {createRoot} from "react-dom/client";
import {AccountMenu} from "../components/account/account-menu";
import {applyAppearanceTheme,createDefaultAppearanceState,getSelectedTheme} from "../lib/appearance-storage";
import type {DesktopBridge} from "../lib/desktop-bridge";
const root=createRoot(document.getElementById("root")!);
const events:string[]=[];const results:string[]=[];
const wait=(ms=220)=>new Promise(r=>setTimeout(r,ms));
const check=(ok:unknown,label:string)=>results.push((ok?"PASS ":"FAIL ")+label);
const bridge:DesktopBridge={openDeviceSettings:async()=>{},deviceState:async()=>({paired:false,version:"test",appUpdate:{available:true,phase:"available",version:"test-next",message:"Synthetic update"}})};
function mount(desktop:boolean,optional=true){
 (window as Window & {metisApp?:DesktopBridge}).metisApp=desktop?bridge:undefined;
 root.render(<main className="flex min-h-dvh items-end bg-background p-4 text-foreground"><section className="w-60 max-w-full"><AccountMenu key={String(desktop)+optional} profile={null} username="Preview user" updateAvailable onProfile={()=>events.push("Profile")} onSettings={()=>events.push("Settings")} onUsage={()=>events.push("Usage")} onLogout={()=>events.push("Logout")} onAgentHub={optional?()=>events.push("Agent Hub"):undefined} onNotifications={optional?()=>events.push("Notifications"):undefined} unreadCount={optional?2:0}/></section></main>);
}
const control=(label:string)=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"],button')].find(e=>e.textContent?.trim()===label);
async function press(el:HTMLElement|undefined|null){if(!el)throw Error("Missing control");el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerType:"mouse"}));el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,pointerType:"mouse"}));el.click();await wait();}
async function open(){await press(document.querySelector<HTMLElement>('[aria-label="Open account menu"]'));}
async function escape(){document.activeElement?.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await wait();}
function menu(){return document.querySelector<HTMLElement>('[role="menu"]')!;}
async function run(){
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"midnight");
 mount(true);await wait();await open();
 if(new URLSearchParams(location.search).has("before"))return;
 const desktopItems=[...menu().querySelectorAll('[role="menuitem"]')].map(e=>e.textContent?.trim());
 check(JSON.stringify(desktopItems)===JSON.stringify(["App settings","Profile","Notifications","Agent Hub","Settings","Usage","Logout"]),"desktop action order");
 check(!menu().textContent?.includes("Getting started"),"Getting started removed");
 const app=control("App settings")!;
 check(app.previousElementSibling?.getAttribute("role")==="separator"&&app.nextElementSibling?.getAttribute("role")==="separator","App settings bounded by two separators");
 check(app.previousElementSibling?.previousElementSibling?.textContent==="Preview user","username precedes App section");
 check(menu().querySelectorAll('[role="separator"]').length===3,"exact desktop group separators");
 check(!!app.querySelector('[aria-label="App update available"]'),"app update indicator preserved");
 check(!!control("Notifications")?.querySelector('[aria-label="Unread notifications"]'),"notification indicator preserved");
 const dots=[app.querySelector<HTMLElement>('[aria-label="App update available"]')!,control("Notifications")!.querySelector<HTMLElement>('[aria-label="Unread notifications"]')!,control("Settings")!.querySelector<HTMLElement>('[aria-label="Update available"]')!];
 check(dots.every(e=>{const r=e.getBoundingClientRect();return r.width===8&&r.height===8;}),"all menu indicators are identical 8px circles");
 check(Math.max(...dots.map(e=>e.getBoundingClientRect().right))-Math.min(...dots.map(e=>e.getBoundingClientRect().right))<1,"menu indicators share the same right alignment");
 check([...menu().querySelectorAll<HTMLElement>('[role="menuitem"]')].every(e=>e.getBoundingClientRect().height>=44),"touch targets remain 44px");
 const rect=menu().getBoundingClientRect();
 check(rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,"menu fits viewport");
 menu().focus();menu().dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));await wait();
 check(document.activeElement?.textContent?.trim()==="App settings","keyboard starts at App settings");
 document.activeElement?.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));await wait();
 check(document.activeElement?.textContent?.trim()==="Profile","keyboard skips separator to Profile");
 await press(app);
 check(!!document.querySelector('[role="dialog"]')&&document.querySelector('[role="dialog"]')?.textContent?.includes("App settings"),"App settings opens canonical dialog");
 await escape();
 for(const label of ["Profile","Notifications","Agent Hub","Settings","Usage","Logout"]){await open();await press(control(label));check(events.at(-1)===label,"callback retained: "+label);}
 mount(false);await wait();await open();
 check(!control("App settings"),"web hides native App settings");
 check(!menu().textContent?.includes("Getting started"),"web omits Getting started");
 check(menu().querySelectorAll('[role="separator"]').length===2,"web has no empty native section");
 check(menu().querySelector('[role="menuitem"]')?.textContent?.trim()==="Profile","web starts at Profile");
 await escape();mount(false,false);await wait();await open();
 check(!control("Notifications")&&!control("Agent Hub"),"optional actions remain conditional");
 await escape();mount(true);await wait();await open();
 await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});
}
run().catch(async error=>{results.push("FAIL "+String(error));await fetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});});
