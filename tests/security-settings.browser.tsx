import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {SettingsPanel} from "../components/settings-panel";
import {AppearanceProvider} from "../components/appearance-provider";
import {TooltipProvider} from "../components/ui/tooltip";
import {SettingsDialog} from "../components/settings-dialog";
import {desktopBridge, type DesktopBridge} from "../lib/desktop-bridge";

const appFixture = new URLSearchParams(location.search).has("app");
let replayCount=0, updateChecks=0, captureChanges=0;
let hideOverlayFromCapture=true;
const simulatedBridge: DesktopBridge={
 openDeviceSettings:async()=>{},
 deviceState:async()=>({paired:true,version:"1.7.26-fixture",connection:"online",permissionMode:"admin",hideOverlayFromCapture,autostartEnabled:true}),
 setOverlayCaptureHidden:async(hidden)=>{captureChanges++; hideOverlayFromCapture=hidden;return hidden;},
 checkUpdates:async()=>{updateChecks++;return "No update available";},
};
if(appFixture) Object.assign(window,{metisApp:simulatedBridge});
const originalFetch=window.fetch.bind(window);
let lists=0;
window.fetch=async(input)=>{
 const url=String(input);
 if(url==="/api/passkeys/list"){lists++;document.title="Security fixture — list requests "+lists;return Response.json({passkeys:[]});}
 return Response.json({clients:[],settings:{},providers:[],definitions:[],connections:[],channels:[]});
};
document.title="Security fixture — list requests 0";
const noop=()=>{},done=async()=>{};
function App(){
 const [tab,setTab]=useState(appFixture?"devices":"security"),[mobile,setMobile]=useState(innerWidth<768);
 const [section,setSection]=useState<string|null>(appFixture?"settings-app":null);
 const [open,setOpen]=useState(true);
 useEffect(()=>{const resize=()=>setMobile(innerWidth<768);window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);},[]);
 const panel=<SettingsPanel
 open={open} onOpenChange={setOpen} mobile={mobile} settingsTab={tab} onSettingsTabChange={setTab}
 sectionRequest={section} onSectionRequestHandled={()=>setSection(null)}
 onReplayOnboarding={appFixture?()=>{replayCount++;setOpen(false);}:undefined}
 memories={[]} soundCuesEnabled={false} onSoundCuesEnabledChange={noop}
 voiceInputEnabled={false} voiceMaxDurationSeconds={60} voiceProvider="browser" voiceModelId="" voiceRealtime={false} voiceEndpoint="" onVoiceApiKeySave={done} onVoiceInputSettingsChange={noop}
 browserEnabled={false} browserRealtime={false} browserFps={1} browserViewportWidth={960} browserViewportHeight={720} onBrowserSettingsChange={noop}
 compressionEnabled={false} compressionMode="standard" compressionToolResults={false} compressionChatHistory={false} onCompressionSettingsChange={noop}
 models={[]} favoriteModelKeys={[]} onToggleFavoriteModel={noop} subagentModelEnabled={false} onSubagentModelEnabledChange={noop} subagentModelId="" onSubagentModelIdChange={noop} subagentModelParams={[]} onSubagentModelParamsChange={noop}
 finishSound={null} onFinishSoundChange={noop} onTestFinishSound={noop} onMemoriesChanged={noop} onMemoryDeleted={noop} onChatsChanged={noop} usageSnapshot={null} onRefreshUsage={done} isHostAdmin={false}
 />;
 return <AppearanceProvider><TooltipProvider>
   {appFixture ? (mobile ? (open ? <main className="flex h-dvh">{panel}</main> : null) : <SettingsDialog open={open} onOpenChange={setOpen}>{panel}</SettingsDialog>) : panel}
 </TooltipProvider></AppearanceProvider>;
}
createRoot(document.getElementById("root")!).render(<App/>);
if(appFixture && new URLSearchParams(location.search).has("verify")) {
 const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
 const find=(label:string)=>Array.from(document.querySelectorAll<HTMLElement>("button")).find(e=>e.textContent?.trim()===label);
 const until=async<T,>(fn:()=>T | undefined | false | null):Promise<T>=>{
   for(let i=0;i<75;i++){const result=fn();if(result)return result;await pause();}
   throw new Error("Settings fixture state did not settle");
 };
 const results:string[]=[];
 function check(value:unknown,label:string){results.push((value?"PASS ":"FAIL ")+label);}
 async function run(){
   const app=await until(()=>document.querySelector<HTMLElement>('[data-slot="desktop-app-settings"]'));
   const settings=app.closest<HTMLElement>("section[aria-label=Settings]")!;
   const [width,height]=[settings.offsetWidth,settings.offsetHeight];
   const sidebar=Array.from(document.querySelectorAll<HTMLElement>('[role="tablist"]')).find(element=>element.getBoundingClientRect().width>0);
   check(innerWidth<1024 || sidebar?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()==="Devices","uses the real side tabs with Devices selected");
   check(document.documentElement.scrollWidth<=innerWidth+1 && width<=innerWidth,"settings are responsive without horizontal overflow");
   check(!!desktopBridge()&&!!settings.querySelector('[role="combobox"][aria-label="Search settings"]'),"shared Settings search is present");
   (await until(()=>find("Check for updates"))).click();
   await until(()=>updateChecks===1);
   check(updateChecks===1,"native update button calls the existing bridge once");
   const streams=await until(()=>{
     const candidate=document.querySelector<HTMLButtonElement>("#client-streams");
     return candidate && !candidate.disabled ? candidate : null;
   });
   streams.click();await until(()=>captureChanges===1);
   await until(()=>streams.getAttribute("aria-checked")==="true");
   check(!hideOverlayFromCapture,"desktop preferences are saved with the existing bridge");
   find("Back to Devices")?.click();
   await until(()=>document.getElementById("settings-app"));
   check(!document.querySelector('[data-slot="desktop-app-settings"]'),"Back returns to the Devices overview");
   const search=settings.querySelector<HTMLInputElement>('[aria-label="Search settings"]')!;
   search.focus();
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"appearance");
   search.dispatchEvent(new Event("input",{bubbles:true}));
   const next=await until(()=>Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(e=>e.textContent?.includes("Appearance")));
   next.click();
   const general=await until(()=>document.querySelector('[data-slot="appearance-manager"]'));
   const other=general.closest<HTMLElement>("section[aria-label=Settings]")!;
   check(other===settings && width===other.offsetWidth && height===other.offsetHeight,"App settings and other Settings use identical bounds");
   search.focus();
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"app settings");
   search.dispatchEvent(new Event("input",{bubbles:true}));
   (await until(()=>Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(e=>e.textContent?.includes("App settings")))).click();
   await until(()=>document.querySelector('[data-slot="desktop-app-settings"]'));
   check(true,"Settings search routes back to App settings");
   (await until(()=>find("Replay onboarding"))).click();
   await until(()=>!document.querySelector('section[aria-label=Settings]') && replayCount===1);
   check(true,"Replay closes Settings and requests onboarding exactly once");
 }
 void run().catch(error=>results.push("FAIL "+String(error))).finally(async()=>{
   document.body.dataset.done="true";
   await originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,results})});
 });
}
