import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountMenu } from "../components/account/account-menu";
import { AppearanceProvider } from "../components/appearance-provider";
import { SettingsDialog } from "../components/settings-dialog";
import { SettingsPanel } from "../components/settings-panel";
import { TooltipProvider } from "../components/ui/tooltip";
import { useIsMobile } from "../hooks/use-mobile";
import type { DesktopBridge, LocalDeviceState } from "../lib/desktop-bridge";

const params = new URLSearchParams(location.search);
const calls: string[] = [];
const shortcuts = {assistant:"Control+Shift+A",focusInput:"Control+Shift+F",openChat:"Control+Shift+C",deviceSettings:"Control+Shift+D",cancel:"Escape"};
const state: LocalDeviceState = {
  paired: true, version: "1.7.26-fixture", platform: "win32", connection: "online", permissionMode: "admin",
  hideOverlayFromCapture: true, autostartEnabled: true, fileDrop: {available: true, error: ""},
  appUpdate: {available: true, phase: "ready", version: "1.7.27-fixture", message: "Update ready"},
  assistant: {hotkey: shortcuts.assistant, hotkeyAvailable: true, shortcuts, defaults: shortcuts},
};
const bridge: DesktopBridge = {
  deviceState: async () => structuredClone(state),
  openDeviceSettings: async () => { calls.push("device"); },
  checkUpdates: async () => { calls.push("update"); return "Update ready"; },
  setOverlayCaptureHidden: async hidden => { calls.push("capture:"+hidden); return state.hideOverlayFromCapture=hidden; },
  setAutostart: async enabled => { calls.push("autostart:"+enabled); return state.autostartEnabled=enabled; },
  openAssistant: async () => { calls.push("assistant"); },
  openServerSettings: async () => { calls.push("server"); },
  requestDesktopPermissions: async () => { calls.push("permissions"); },
};
if (!params.has("web")) Object.assign(window, {metisApp: bridge});
const originalFetch = window.fetch.bind(window);
window.fetch = async () => Response.json({clients: [], settings: {}, providers: [], definitions: [], connections: [], channels: []});
const noop=()=>{},done=async()=>{};
function App() {
  const mobile=useIsMobile();
  const [tab,setTab]=useState("general"), [open,setOpen]=useState(false);
  const panel=<SettingsPanel open={open} onOpenChange={setOpen} mobile={mobile} settingsTab={tab} onSettingsTabChange={setTab}
    onReplayOnboarding={()=>{calls.push("general-replay");setOpen(false);}}
 memories={[]} soundCuesEnabled={false} onSoundCuesEnabledChange={noop}
 voiceInputEnabled={false} voiceMaxDurationSeconds={60} voiceProvider="browser" voiceModelId="" voiceRealtime={false} voiceEndpoint="" onVoiceApiKeySave={done} onVoiceInputSettingsChange={noop}
 browserEnabled={false} browserRealtime={false} browserFps={1} browserViewportWidth={960} browserViewportHeight={720} onBrowserSettingsChange={noop}
 compressionEnabled={false} compressionMode="standard" compressionToolResults={false} compressionChatHistory={false} onCompressionSettingsChange={noop}
 models={[]} favoriteModelKeys={[]} onToggleFavoriteModel={noop} subagentModelEnabled={false} onSubagentModelEnabledChange={noop} subagentModelId="" onSubagentModelIdChange={noop} subagentModelParams={[]} onSubagentModelParamsChange={noop}
 finishSound={null} onFinishSoundChange={noop} onTestFinishSound={noop} onMemoriesChanged={noop} onMemoryDeleted={noop} onChatsChanged={noop} usageSnapshot={null} onRefreshUsage={done} isHostAdmin={false}

  />;
  return <AppearanceProvider><TooltipProvider>
    <main className="flex min-h-dvh items-end bg-background p-2 text-foreground">
      <div className="w-60"><AccountMenu profile={null} username="Fixture" mobile={mobile} updateAvailable={false}
        onSettings={()=>setOpen(true)} onProfile={noop} onUsage={noop} onLogout={noop}
        onReplayOnboarding={()=>{calls.push(dialog() ? "early-replay" : "app-replay");}} /></div>
    </main>
    {open && (mobile
      ? <div data-fixture-mobile-settings className="fixed inset-0 flex bg-background">{panel}<button className="absolute right-2 top-2" onClick={()=>setOpen(false)}>Close fixture</button></div>
      : <SettingsDialog open={open} onOpenChange={setOpen}>{panel}</SettingsDialog>)}
  </TooltipProvider></AppearanceProvider>;
}
createRoot(document.getElementById("root")!).render(<App/>);

const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
const query=<T extends HTMLElement = HTMLElement>(selector:string, scope:ParentNode=document)=>scope.querySelector<T>(selector);
const dialog=()=>query('[role="dialog"][data-state="open"]');
const button=(label:string,scope:ParentNode=document)=>Array.from(scope.querySelectorAll<HTMLElement>('button,[role="menuitem"]')).find(item=>item.textContent?.trim()===label);
const profile=()=>query('[aria-label="Open account menu"]');
function key(target:HTMLElement,key:string) {
  target.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));
}
async function until<T>(read:()=>T | null | undefined | false,label="fixture state") {
  for(let i=0;i<85;i++){const result=read();if(result)return result;await pause();}
  throw Error("Timed out: "+label);
}
async function openMenu(target:HTMLElement) {
  target.focus();
  key(target,"Enter");
  return until(()=>query('[role="menu"][data-state="open"]'),"menu");
}
async function openSettings(label:string) {
  (await until(()=>Array.from(document.querySelectorAll<HTMLElement>('[role="menu"][data-state="open"] [role="menuitem"]')).find(item=>item.textContent?.trim()===label),label)).click();
}
const results:string[]=[];
function check(ok:unknown,label:string) { results.push((ok?"PASS ":"FAIL ")+label); }
const mobile=innerWidth<768, sidebar=innerWidth>=1024;
const nav=()=>query('[aria-label="App settings categories"]',dialog()!);
async function openCategory(label:string) {
  if(mobile) {
    const back=button("Back to App settings");
    if(back){back.click();await until(()=>nav());}
    const tile=Array.from(nav()!.querySelectorAll<HTMLElement>("button")).find(item=>item.firstElementChild?.nextElementSibling?.firstElementChild?.textContent===label);
    if(!tile)throw Error("Missing mobile category: "+label);
    tile.click();
    await until(()=>document.activeElement?.textContent?.includes("Back to App settings"));
  } else if(sidebar) {
    const tab = await until(()=>button(label,nav()!),label);
    tab.focus();
    key(tab,"Enter");
  } else {
    await openMenu(query('[aria-label="App settings section"]',dialog()!)!);
    await openSettings(label);
  }
  await until(()=>query('[role="tabpanel"]',dialog()!)?.querySelector("h3")?.textContent===label,label+" panel");
}
async function run() {
  const trigger=await until(profile);
  await openMenu(trigger);
  if(params.has("web")) {
    check(!button("App settings") && !trigger.querySelector('[aria-label="App update available"]'),"plain web account menu omits native settings and dot");
    return;
  }
  const item=await until(()=>button("App settings"),"app entry");
  if(params.has("verify")) {
    check(!!trigger.querySelector('[aria-label="App update available"]') && !!item.querySelector('[aria-label="App update available"]'),"profile and app entry keep the update dots");
  }
  item.focus();
  // Radix's menu keyboard handler maps Enter to selection, not a direct dialog call.
  key(item,"Enter");
  const app=await until(dialog,"standalone modal");
  await pause(220);
  if(!params.has("verify")) {
    const view=params.get("view");
    if(view==="assistant")await openCategory("Assistant");
    if(view==="connection")await openCategory("Connection");
    if(view==="general" && mobile)await openCategory("General");
    return;
  }
  check(query('[data-slot="dialog-title"]',app)?.textContent==="App settings" && !query('section[aria-label="Settings"]'),"account menu opens an independently named dialog with no regular Settings mounted");
  check(app.contains(document.activeElement),"keyboard selection moves focus into the modal");
  check(!!query("footer",app)?.textContent?.includes("Replay onboarding"),"Replay stays at the bottom of the app modal");
  check(document.documentElement.scrollWidth<=innerWidth && app.scrollWidth<=app.offsetWidth,"modal fits without horizontal overflow");
  const size=[app.offsetWidth,app.offsetHeight];
  if(mobile) {
    check(nav()?.tagName==="NAV","mobile opens the category overview");
    await openCategory("General");
    button("Back to App settings")!.click();
    await until(()=>nav()?.contains(document.activeElement));
    check(document.activeElement?.textContent?.startsWith("General"),"mobile Back restores focus to the selected category");
  } else if(sidebar) {
    check(nav()?.getAttribute("aria-orientation")==="vertical","desktop exposes a vertical category sidebar");
    const first=button("General",nav()!)!;
    first.focus();key(first,"ArrowDown");
    await until(()=>query('[role="tab"][aria-selected="true"]',nav()!)?.textContent?.trim()==="Assistant","arrow navigation");
    check(true,"ArrowDown selects Assistant");
  } else {
    check(!!query('[aria-label="App settings section"]',app)?.offsetWidth,"tablet exposes compact category picker");
  }
  await openCategory("General");
  check(app.textContent?.includes("File dropsReady") && app.textContent.includes("1.7.26-fixture"),"version and file-drop state are visible");
  const update=await until(()=>button("Check for updates",app)); update.click();
  await pause();
  await until(()=>calls.includes("update")&&!update.hasAttribute("disabled"),"update call completes");
  const capture=query<HTMLButtonElement>("#client-streams",app)!; capture.click();
  await until(()=>query("#client-streams",app)?.getAttribute("aria-checked")==="true"&&!query<HTMLButtonElement>("#client-streams",app)?.disabled,"capture toggle: "+calls.join(","));
  const autostart=query<HTMLButtonElement>("#client-autostart",app)!; autostart.click();
  await until(()=>query("#client-autostart",app)?.getAttribute("aria-checked")==="false"&&!query<HTMLButtonElement>("#client-autostart",app)?.disabled,"autostart toggle: "+calls.join(","));
  check(calls.join(",")==="update,capture:false,autostart:false","update check and both toggles call the original bridge once with the correct values");
  await openCategory("Assistant");
  check(!!query('[aria-label="Desktop shortcuts"]',app)&&!!button("Save shortcuts",app),"Assistant contains the unchanged shortcut editor");
  button("Open Desktop Assistant",app)!.click();
  await pause();
  await until(()=>calls.includes("assistant"));
  await openCategory("Connection");
  for(const [label,action] of [["Review system permissions","permissions"],["Change server address","server"],["Open Remote Client Device Settings","device"]]) {
    const control=await until(()=>button(label,app),label);
    await until(()=>!control.hasAttribute("disabled"));
    control.click();await pause();await until(()=>calls.includes(action));
  }
  check(calls.slice(3).join(",")==="assistant,permissions,server,device","assistant, permissions, server and pairing open only on explicit actions");
  key(document.activeElement as HTMLElement,"Escape");
  await until(()=>!dialog() && document.activeElement===trigger,"close and return focus");
  check(true,"Escape closes the modal and restores profile focus");
  await openMenu(trigger);
  await openSettings("Settings");
  const regular=await until(()=>query('section[aria-label="Settings"]'),"regular Settings");
  const regularFrame=mobile?query('[data-fixture-mobile-settings]')!:dialog()!;
  await pause(180);
  check(size[0]===regularFrame.offsetWidth && size[1]===regularFrame.offsetHeight,"App settings matches regular Settings dimensions");
  const search=query<HTMLInputElement>('[aria-label="Search settings"]',regular)!;
  search.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"app settings");
  search.dispatchEvent(new Event("input",{bubbles:true}));
  await pause(150);
  check(!Array.from(document.querySelectorAll('[role="option"]')).some(option=>option.textContent?.includes("App settings")),"regular Settings search excludes desktop App settings");
  key(search,"Escape");
  if(mobile)query('[data-settings-tile="settings-category-devices"]',regular)?.click();
  else if(sidebar)button("Devices",regular)?.click();
  else {await openMenu(query('[aria-label="Settings section"]',regular)!);await openSettings("Devices");}
  await until(()=>query('#settings-remote-clients',regular),"regular Devices tile");
  check(!query('#settings-app',regular),"Devices has no desktop-only tile");
  if(mobile) {button("Back to Settings",regular)!.click();(await until(()=>query('[data-settings-tile="settings-category-general"]',regular))).click();}
  else if(sidebar)button("General",regular)?.click();
  else {await openMenu(query('[aria-label="Settings section"]',regular)!);await openSettings("General");}
  (await until(()=>query("#settings-replay-onboarding",regular),"General Replay")).click();
  await until(()=>!query('section[aria-label="Settings"]') && calls.includes("general-replay"));
  check(true,"regular General Replay still works");
  await until(()=>!document.querySelector('[role="dialog"]'));
  await openMenu(trigger);
  await openSettings("App settings");
  const reopened=await until(dialog);
  button("Replay onboarding",reopened)!.click();
  await until(()=>calls.includes("app-replay") || calls.includes("early-replay"),"App Replay");
  check(calls.filter(call=>call.endsWith("replay")).join(",")==="general-replay,app-replay"&&!dialog(),"app Replay closes the dialog before requesting onboarding exactly once");
}
void run().catch(error=>results.push("FAIL "+String(error)+"; bridge calls: "+calls.join(","))).finally(async()=>{
  if(!params.has("verify"))return;
  document.body.dataset.done="true";
  await originalFetch("/report"+(params.has("web")?"?web":""),{method:"POST",body:JSON.stringify({width:innerWidth,results})});
});
