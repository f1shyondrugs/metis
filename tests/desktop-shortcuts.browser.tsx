import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {DesktopShortcutSettings} from "../components/desktop-shortcut-settings";
import type {DesktopShortcuts} from "../lib/desktop-assistant";
const initial:DesktopShortcuts={assistant:"Control+Shift+Space",focusInput:"Control+Shift+Enter",openChat:"Control+Shift+M",deviceSettings:"Control+Shift+D",cancel:"Escape"};
let saved=initial,capturing=false,fail=true;
Object.defineProperty(window,"metisApp",{value:{
 openDeviceSettings:async()=>{},
 setShortcutCapture:async(value:boolean)=>{capturing=value;},
 setShortcuts:async(value:DesktopShortcuts)=>{if(fail){fail=false;throw Error("Fixture disk write failed");}saved=value;return value;}
}});
function Fixture(){const[value,setValue]=useState(initial);return <main style={{maxWidth:760,margin:"32px auto",padding:16}}><DesktopShortcutSettings value={value} defaults={initial} platform="win32" onSaved={setValue}/></main>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
const checks:string[]=[],pause=()=>new Promise(resolve=>setTimeout(resolve,50));
async function until(fn:()=>unknown){for(let i=0;i<100;i++){if(fn())return;await pause();}throw Error("Timed out");}
function check(value:unknown,label:string){checks.push((value?"PASS ":"FAIL ")+label);if(!value)throw Error(label);}
function button(label:string){return Array.from(document.querySelectorAll("button")).find(button=>button.textContent===label)!;}
async function run(){
 await until(()=>document.querySelector('[aria-label="Change shortcut: Focus text / return to app"]'));
 const record=document.querySelector<HTMLButtonElement>('[aria-label="Change shortcut: Focus text / return to app"]')!;
 record.click();await until(()=>record.textContent==="Press shortcut…");
 check(document.activeElement===record&&capturing,"Shortcut recorder holds focus and pauses native actions");
 record.dispatchEvent(new KeyboardEvent("keydown",{key:"F6",code:"F6",bubbles:true,cancelable:true}));await pause();
 check(record.textContent==="F6"&&!capturing,"Recorded key updates the draft and releases capture");
 button("Save shortcuts").click();await until(()=>document.querySelector('[role="alert"]'));
 check(button("Save shortcuts").disabled===false,"Failed save preserves a retryable draft");
 button("Save shortcuts").click();await until(()=>saved.focusInput==="F6");
 await until(()=>button("Save shortcuts")?.disabled);
 check(button("Save shortcuts").disabled,"Saved shortcuts reflect the native result");
 record.click();await until(()=>capturing);window.dispatchEvent(new Event("blur"));await pause();
 check(!capturing&&record.textContent!=="Press shortcut…","Leaving settings cancels key capture");
 check(document.documentElement.scrollWidth<=innerWidth,"Settings fit the viewport");
 await fetch("/result",{method:"POST",body:JSON.stringify({mode:"shortcuts",checks,passed:true})});
}
run().catch(async error=>{await fetch("/result",{method:"POST",body:JSON.stringify({mode:"shortcuts",checks,passed:false,error:String(error)})});});
