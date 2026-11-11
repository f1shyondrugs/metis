import React from "react";
import {createRoot} from "react-dom/client";
import {AccountMenu} from "../components/account/account-menu";
import type {LocalDeviceState} from "../lib/desktop-bridge";
import {DesktopFileDrop} from "../components/desktop-file-drop";
import {ChatFileDropZone} from "../components/chat-file-drop-zone";
const mode=new URLSearchParams(location.search).get("mode")||"client";
const state:LocalDeviceState={paired:true,connection:"online",permissionMode:"admin",platform:"win32",version:"fixture",hideOverlayFromCapture:true,autostartEnabled:true,appUpdate:{phase:"ready",available:true,version:"next",message:"Update ready; restart the app to install"}};
let receive:((value:unknown)=>void)|undefined,reads=0,captures=0;
Object.defineProperty(window,"metisApp",{value:mode==="browser"?undefined:{
 openDeviceSettings:async()=>{},deviceState:async()=>{reads++;return structuredClone(state);},
 setOverlayCaptureHidden:async(value:boolean)=>{captures++;if(mode==="error"&&captures===1)throw Error("Fixture disk full");state.hideOverlayFromCapture=value;return value;},
 setAutostart:async(value:boolean)=>{state.autostartEnabled=value;return value;},checkUpdates:async()=>{state.appUpdate={phase:"current",available:false,version:"",message:"Up to date"};return "Up to date";},
 onFilesDropped:(callback:(value:unknown)=>void)=>{receive=callback;return ()=>{receive=undefined;};},
}});
let dropped:File[]=[];
createRoot(document.getElementById("root")!).render(<main className="h-dvh bg-background p-4 text-foreground">
 <ChatFileDropZone className="h-40 rounded-lg border border-border p-4" onFiles={files=>{dropped=Array.from(files);}}><div id="drop">Drop fixture files here</div></ChatFileDropZone>
 <div className="fixed bottom-3 left-3 w-60"><AccountMenu profile={null} username="Fixture" updateAvailable={false} onSettings={()=>{}} onProfile={()=>{}} onUsage={()=>{}} onLogout={()=>{}}/></div>
 <pre id="results" className="mt-5 whitespace-pre-wrap text-xs"/>
</main>);
const pause=(ms=100)=>new Promise(resolve=>setTimeout(resolve,ms));
const results:string[]=[];
function check(value:unknown,label:string){results.push((value?"PASS ":"FAIL ")+label);document.getElementById("results")!.textContent=results.join("\n");if(!value)document.body.dataset.failed="true";}
function button(text:string){return Array.from(document.querySelectorAll("button,[role=menuitem]")).find(node=>node.textContent?.trim()===text) as HTMLElement;}
async function select(node:HTMLElement){node.dispatchEvent(new PointerEvent("pointerdown",{button:0,bubbles:true,pointerType:"mouse"}));node.click();await pause(180);}
void(async()=>{
 await pause(400);
 if(mode!=="browser"){
  const rect=document.getElementById("drop")!.getBoundingClientRect();
  receive?.({files:[{name:"fixture.txt",bytes:new Uint8Array([97,98,99]),lastModified:123}],point:{x:rect.left+20,y:rect.top+10}});
  await pause();check(dropped.length===1&&dropped[0].type==="text/plain"&&await dropped[0].text()==="abc","native bytes use the canonical drop owner with exact contents");
 }
 const trigger=document.querySelector('[aria-label="Open account menu"]') as HTMLElement;
 check(Boolean(trigger.querySelector('[aria-label="App update available"]'))===(mode!=="browser"),"native update dot on profile only inside app");
 await select(trigger);
 check(Boolean(button("App settings"))===(mode!=="browser"),"app settings entry is native-only");
 if(mode!=="browser"){
  await select(button("App settings"));
  check(Boolean(document.querySelector('[role=dialog]')),"profile entry opens in-app settings dialog");
  check(document.activeElement?.closest('[role=dialog]'),"keyboard focus moves into dialog");
  const streams=document.getElementById("client-streams") as HTMLElement;
  check(streams?.getAttribute("aria-checked")==="false","saved hidden setting is shown without reset");
  streams.click();await pause(200);
  if(mode==="error"){check(Boolean(document.querySelector('[role=alert]')),"save failure visible");check(state.hideOverlayFromCapture===true,"failed save preserves setting");streams.click();await pause(200);}
  check(state.hideOverlayFromCapture===false&&streams.getAttribute("aria-checked")==="true","show in streams saves inverse canonical preference");
  document.getElementById("client-autostart")!.click();await pause(200);check(state.autostartEnabled===false,"autostart edits exact local preference");
  button("Check for updates").click();await pause(200);check(state.appUpdate?.available===false,"update check clears native badge truth when current");
  check(!document.querySelector('[aria-label="App update available"]'),"current app removes profile update dot");
  check(reads<12,"menu and settings share one polling source");
  check(!Array.from(document.querySelectorAll('[role=switch]')).some(node=>node.getBoundingClientRect().right>innerWidth),"switches remain within viewport");
 }
 check(document.documentElement.scrollWidth<=innerWidth,"no horizontal overflow");
 document.body.dataset.complete="true";
 await fetch("/result",{method:"POST",body:JSON.stringify({mode,width:innerWidth,passed:!document.body.dataset.failed,results})});
})();
