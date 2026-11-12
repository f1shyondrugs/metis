/** Synthetic account/IPC/HTTP fixture using actual onboarding components. No owner data or OS changes. */
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {AppearanceSettings} from "../components/appearance-settings";
import {AppearanceProvider} from "../components/appearance-provider";
import {applyAppearanceTheme,getSelectedTheme,createDefaultAppearanceState,APPEARANCE_STORAGE_KEY} from "../lib/appearance-storage";
import {ClientOnboarding} from "../components/client-onboarding";
import {SetupWizard} from "../components/setup-wizard";
import {ProviderSetupDialog} from "../components/provider-setup-dialog";
import {onboardingStorageKey,PRODUCT_TOUR,suggestedAppPlatform,type TourTarget} from "../lib/client-onboarding";
const params=new URLSearchParams(location.search),view=params.get("view")||"install";
const originalFetch=window.fetch.bind(window);
let failures=0,permissionCalls=0,deviceCalls=0,serverCalls=0,providerCalls=0,pairingNavigationCalls=0,setupFinished=0,setupCompleteRequests=0;
let nativeId="",downloadFail=false,bootstrapCalls=0;
const nav:TourTarget[]=[];
const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
const state={paired:false,clientId:"",connection:"offline",version:"Fixture",platform:"darwin",desktopAvailable:false,desktopReason:"Screen Recording and Accessibility are not enabled.",autostartEnabled:false,hideOverlayFromCapture:true};
function native(id:string,delay=0){
 nativeId=id;
 Object.assign(window,{metisApp:{openDeviceSettings:async()=>{deviceCalls++;},onboardingContext:async()=>{await pause(delay);return {installationId:id,server:location.origin};},
 deviceState:async()=>({...state}),requestDesktopPermissions:async()=>{permissionCalls++;},openServerSettings:async()=>{serverCalls++;},
 setAutostart:async(value:boolean)=>{state.autostartEnabled=value;return value;},setOverlayCaptureHidden:async(value:boolean)=>{state.hideOverlayFromCapture=value;return value;}}});
}
function browser(){nativeId="";delete (window as Window&{metisApp?:unknown}).metisApp;}
window.fetch=async(input,init)=>{
 const url=String(input);
 if(url.startsWith("/api/onboarding/downloads")){
  const platform=new URL(url,location.origin).searchParams.get("platform");await pause(platform==="windows"?300:40);
  if(downloadFail){downloadFail=false;return Response.json({error:"Synthetic download error"},{status:503});}
  return Response.json({downloads:[{label:platform==="macos"?"macOS · Apple Silicon":platform==="linux"?"Linux · Intel / AMD":"Windows installer",url:"https://github.com/f1shyondrugs/Metis-Apps/releases/download/v-fixture/"+platform+".bin"}]});
 }
 if(url==="/api/setup"){const body=init?.body?JSON.parse(String(init.body)):{};if(body.action==="bootstrap"){bootstrapCalls++;return Response.json({user:{id:"fixture-admin",username:"Demo",isAdmin:true}});}if(body.action==="complete"){setupCompleteRequests++;return Response.json({ok:true});}return Response.json({platform:"linux",osUsers:[],osUsersAvailable:false});}
 if(url==="/api/providers")return Response.json({providers:[]});
 if(url==="/api/admin/users")return Response.json({users:[{id:"fixture-admin",username:"Demo",isAdmin:true}]});
 return originalFetch(input,init);
};
const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
const report=document.createElement("pre");report.hidden=params.has("clean");report.id="onboarding-results";report.style.cssText="position:fixed;left:8px;bottom:6px;max-width:calc(100vw - 16px);max-height:85px;overflow:auto;background:#111;color:#d1fae5;padding:6px;font:10px monospace;z-index:200;pointer-events:none";document.body.append(report);
document.documentElement.classList.add("dark");
const results:string[]=[];const check=(ok:unknown,label:string)=>{results.push((ok?"PASS ":"FAIL ")+label);if(!ok)failures++;report.textContent=results.join("\n");};
function Harness({owner,hasProvider=true}:{owner:string;hasProvider?:boolean}){
 const [providerOpen,setProviderOpen]=useState(false);
 return <AppearanceProvider><main style={{padding:30}}><h1>Synthetic Metis workspace</h1><input data-onboarding-target="chat" aria-label="Existing draft" defaultValue="Keep this draft" style={{position:"fixed",bottom:24,left:30,width:Math.min(600,innerWidth-60),height:44}}/>
 {PRODUCT_TOUR.map(item=><button key={item.id} data-onboarding-target={item.id==="chat"?undefined:item.id} style={{margin:8,padding:16}}>{item.action}</button>)}
 </main><ClientOnboarding userId={owner} username={owner} hasProvider={hasProvider} onPairDevice={()=>{pairingNavigationCalls++;}} onNavigate={target=>{nav.push(target);}} onConnectProvider={()=>{providerCalls++;setProviderOpen(true);}}/>
 <ProviderSetupDialog open={providerOpen} onOpenChange={setProviderOpen} onConnected={()=>setProviderOpen(false)} onSkip={()=>setProviderOpen(false)}/></AppearanceProvider>;
}
let nonce=0;
async function mount(owner="alice",hasProvider=true){root.render(<Harness key={++nonce} owner={owner} hasProvider={hasProvider}/>);await pause(250);}
function button(text:string){const scope=document.querySelector(".onboarding-tour")||document;return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent?.trim()===text||button.getAttribute("aria-label")?.split(",")[0]===text);}
function linearNavigation(){const scope=document.querySelector(".onboarding-tour")||document.querySelector(".onboarding-stage");const buttons=Array.from(scope?.querySelectorAll("button")||[]);return buttons.length>=1&&buttons.length<=2&&buttons.every(el=>["Back","Continue"].includes(el.textContent?.trim()||""));}
async function selectPlatform(value:string){const select=document.querySelector<HTMLSelectElement>('select[aria-label="App platform"]')!;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));await pause(150);}
async function click(text:string){const target=button(text);if(!target)throw Error("Missing button "+text);target.click();await pause(150);}
function read(owner:string,client="browser"){return JSON.parse(localStorage.getItem(onboardingStorageKey(owner,client))||"null");}
async function fill(label:string,value:string){
 const el=Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(el=>el.getAttribute("aria-label")===label||el.closest("label")?.textContent?.includes(label));
 if(!el)throw Error("Missing input "+label);
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));await pause(30);
}
async function run(){
 for(const key of Object.keys(localStorage))if(key.startsWith("metis:onboarding:"))localStorage.removeItem(key);
 localStorage.removeItem(APPEARANCE_STORAGE_KEY);browser();await mount();
 check(getComputedStyle(document.documentElement).getPropertyValue("--background").trim()==="#000000","fresh theme is pure black");
 root.render(<AppearanceProvider><AppearanceSettings/></AppearanceProvider>);await pause(180);
 const paper=document.querySelector<HTMLInputElement>('input[name="color-theme"][value="paper"]')!;paper.click();await pause();
 check(document.documentElement.dataset.surface==="paper","appearance picker applies a light preset");
 const customButton=Array.from(document.querySelectorAll("button")).find(el=>el.textContent?.includes("Create from current"))!;
 check(!!customButton,"canonical custom theme editor remains available");
 customButton.click();await pause();
 const editor=document.querySelector<HTMLTextAreaElement>('textarea')!,custom=JSON.parse(editor.value);
 custom.name="Fixture custom";custom.variables["--background"]="#123456";
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(editor,JSON.stringify(custom));editor.dispatchEvent(new Event("input",{bubbles:true}));await pause();
 await click("Save and apply");
 check(getComputedStyle(document.documentElement).getPropertyValue("--background").trim()==="#123456","custom colors apply to the actual onboarding");
 const savedCustom=document.documentElement.dataset.surface;await mount();
 check(document.documentElement.dataset.surface===savedCustom,"custom theme survives remount without being reset");
 root.render(<AppearanceProvider><AppearanceSettings/></AppearanceProvider>);await pause(180);
 const metis=document.querySelector<HTMLInputElement>('input[name="color-theme"][value="metis"]')!;metis.click();await pause();await mount();
 check(document.documentElement.dataset.surface==="metis","appearance picker restores black and white");
 check(linearNavigation(),"welcome has one Continue action and no appearance or dismissal controls");
 check(document.body.textContent?.includes("Welcome, alice"),"fresh browser opens account-specific introduction");
 const wave=document.querySelector(".onboarding-motion mask path")!,before=wave.getAttribute("d");await pause(160);
 check(before!==wave.getAttribute("d"),"real dot/wave contour animates");
 check(document.querySelectorAll(".onboarding-motion svg").length===1,"one wave controller is mounted");
 await click("Continue");
 check(!!document.querySelector('[aria-label="Get the Metis app"]'),"web onboarding offers the desktop app");
 check(document.querySelectorAll(".onboarding-platforms option:not([disabled])").length===5,"Windows macOS Linux iOS Android can all be selected");
 const expected=suggestedAppPlatform(navigator);
 check(document.querySelector<HTMLSelectElement>('.onboarding-platforms select')?.value===expected,"actual browser OS is suggested");
 await selectPlatform("windows");await selectPlatform("macos");await pause(400);
 check(document.querySelector(".onboarding-downloads a")?.textContent?.includes("Apple Silicon")&&!document.querySelector(".onboarding-downloads a")?.textContent?.includes("Windows"),"late download response cannot replace a newer OS selection");
 await selectPlatform("ios");check(document.body.textContent?.includes("iOS · In development")&&!document.querySelector(".onboarding-downloads a"),"iOS is explicitly in development without a download");
 await selectPlatform("android");check(document.body.textContent?.includes("Android · In development")&&!document.querySelector(".onboarding-downloads a"),"Android is explicitly in development without a download");
 downloadFail=true;await selectPlatform("linux");await pause(100);
 check(document.querySelector('[role="alert"]')?.textContent?.includes("Synthetic download error"),"download lookup failure is visible");
 await click("Retry");await pause(100);check(!!document.querySelector(".onboarding-downloads a"),"download lookup can retry successfully");
 check(linearNavigation(),"app offer has only Back and Continue navigation");await click("Continue");
 for(let i=0;i<PRODUCT_TOUR.length;i++){check(linearNavigation(),"tour navigation stays linear at "+i);await click("Continue");}
 check(read("alice")?.phase==="done","Continue completes only this client/account");
 await mount();check(!document.querySelector(".onboarding-stage"),"completed introduction stays closed after remount");
 await mount("bob");check(document.body.textContent?.includes("Welcome, bob"),"another account on same browser receives its own onboarding");
 await click("Continue");await click("Continue");
 check(!!document.querySelector('[aria-label="Metis product tour"]'),"product tour opens on the real workspace");
 check(nav.at(-1)==="chat","explicit Continue opens the ordinary chat view");
 const draft=document.querySelector<HTMLInputElement>('[aria-label="Existing draft"]')!,draftRect=draft.getBoundingClientRect(),tourRect=document.querySelector(".onboarding-tour")!.getBoundingClientRect();
 check(tourRect.bottom<draftRect.top&&document.elementFromPoint(draftRect.left+10,draftRect.top+10)===draft,"tour card leaves the real chat input reachable");
 await click("Back");check(!!document.querySelector('[aria-label="Get the Metis app"]'),"first tour Back returns to the preceding setup page");await click("Continue");
 await click("Continue");check(read("bob")?.tourIndex===1,"tour position is saved for this account");
 dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await pause();
 check(!document.querySelector(".onboarding-tour"),"Escape pauses the tour without blocking the workspace");
 await mount("bob");check(document.querySelector(".onboarding-tour h2")?.textContent==="Projects","tour resumes at the saved step");
 for(let i=1;i<PRODUCT_TOUR.length;i++){check(document.querySelector(".onboarding-tour h2")?.textContent===PRODUCT_TOUR[i].label,"feature tour includes "+PRODUCT_TOUR[i].id);await click("Continue");}
 check(read("bob")?.phase==="done"&&document.querySelector<HTMLInputElement>('[aria-label="Existing draft"]')?.value==="Keep this draft","finishing tour preserves the existing workspace draft");
 dispatchEvent(new Event("metis:onboarding-open"));await pause();check(!!document.querySelector(".onboarding-stage"),"account menu event can restart a completed guide");
 native("one");await mount("alice");
 check(document.body.textContent?.includes("This desktop")&&read("alice")?.phase==="done","native client is separate from web completion");
 await click("Continue");
 check(!document.querySelector('[aria-label="Get the Metis app"]')&&!!document.querySelector('input[type="checkbox"]'),"native onboarding offers one optional device choice instead of another settings panel");
 check(linearNavigation(),"native device step has only Back and Continue buttons");
 check(permissionCalls===0,"OS permission prompts are never automatic");
 document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();await pause();await click("Continue");check(pairingNavigationCalls===1&&!document.querySelector(".onboarding-stage")&&read("alice","desktop:one")?.phase==="device","opt-in Continue opens real pairing settings without completing or losing the device step");dispatchEvent(new Event("metis:onboarding-open"));await pause();
 await click("Continue");for(let i=0;i<PRODUCT_TOUR.length;i++)await click("Continue");check(read("alice","desktop:one")?.phase==="done","native completion is stored for this user/installation");
 check(permissionCalls===0&&deviceCalls===0&&serverCalls===0,"Continue never prompts or changes system access");
 native("two");await mount("alice");check(!!document.querySelector(".onboarding-stage"),"another desktop gets an independent guide");
 await mount("bob");check(document.body.textContent?.includes("Welcome, bob"),"another user on this desktop gets their own guide");
 native("late",300);root.render(<Harness key={++nonce} owner="late-owner"/>);await pause(20);browser();await mount("other-owner");await pause(400);
 check(document.body.textContent?.includes("Welcome, other-owner")&&!document.body.textContent?.includes("Welcome, late-owner"),"late native-context reply cannot switch another user's onboarding");
 localStorage.setItem(onboardingStorageKey("broken"),"{bad");await mount("broken");check(!!document.querySelector(".onboarding-stage"),"corrupt client progress recovers to welcome");
 await mount("provider-owner",false);check(providerCalls===0&&linearNavigation(),"missing provider does not add another welcome action");
 const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;
 try{
  Storage.prototype.getItem=function(key){if(key.startsWith("metis:onboarding:"))throw new DOMException("Blocked","SecurityError");return originalGet.call(this,key);};
  Storage.prototype.setItem=function(key,value){if(key.startsWith("metis:onboarding:"))throw new DOMException("Blocked","SecurityError");return originalSet.call(this,key,value);};
  await mount("session-only");
  check(document.body.textContent?.includes("this session only"),"blocked storage has an explicit session-only fallback");
  await click("Continue");await mount("session-only");check(!!document.querySelector('[aria-label="Get the Metis app"]'),"session fallback keeps progress without writing credentials");
 }finally{Storage.prototype.getItem=originalGet;Storage.prototype.setItem=originalSet;}
 browser();await mount("cross-tab");
 dispatchEvent(new StorageEvent("storage",{key:onboardingStorageKey("cross-tab"),newValue:JSON.stringify({version:1,phase:"done",tourIndex:0})}));await pause();
 check(!document.querySelector(".onboarding-stage"),"same-account client progress synchronizes across tabs");
 // Server first-run, with fake HTTP only: no account or real credential operation.
 sessionStorage.removeItem("metis-setup-step");
 root.render(<SetupWizard open hasUsers={false} onFinished={()=>{setupFinished++;}}/>);await pause(200);
 check(document.body.textContent?.includes("fresh Metis installation"),"fresh server is explicitly recognised in shared guided setup");
 await click("Continue");
 check(!!document.querySelector('input[aria-describedby="setup-token-help"]')&&document.querySelectorAll('input[type="password"]').length===2,"operator token and account password remain protected inputs");
 await fill("Operator setup token","synthetic-token");await fill("Admin username","demo-admin");await fill("Password","synthetic-password");await click("Create admin");await pause(200);
 check(bootstrapCalls===1&&document.body.textContent?.includes("Admin"),"first admin setup uses the existing bootstrap action");
 await click("Continue");await pause(150);
 check(!!document.querySelector('[aria-label="Setup progress"]')||document.body.textContent?.includes("Connect a provider"),"provider setup follows the first account");
 await click("Skip for now");await click("Enter Metis");check(setupCompleteRequests===1&&setupFinished===1,"server completion reuses the authenticated setup completion action");
 check(![...Object.keys(localStorage)].some(k=>(localStorage.getItem(k)||"").includes("synthetic-password")||(localStorage.getItem(k)||"").includes("synthetic-token")),"setup secrets never enter client onboarding storage");
 root.render(<div/>);await pause(100);check(!document.querySelector(".onboarding-motion svg"),"leaving onboarding disposes its animation controller");
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"metis");
 const noOverflow=()=>document.documentElement.scrollWidth<=innerWidth+1;
 browser();await mount("Demo");
 if(view==="install")await click("Continue");
 else if(view==="server"){sessionStorage.removeItem("metis-setup-step");root.render(<SetupWizard open hasUsers={false} onFinished={()=>{}}/>);await pause(200);}
 else if(view==="native"){native("visual");await mount("Demo");await click("Continue");}
 else if(view==="tour"){await click("Continue");await click("Continue");}
 check(noOverflow(),"layout has no horizontal page overflow at "+innerWidth);
 document.body.dataset.complete="true";report.textContent=failures?results.filter(x=>x.startsWith("FAIL")).join("\n"):"PASS "+results.length+" onboarding assertions · "+innerWidth+"px";
 await originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,height:innerHeight,view,results,nativeId,permissionCalls,deviceCalls,serverCalls})});
}
void run().catch(error=>{check(false,String(error));document.body.dataset.complete="error";void originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,height:innerHeight,view,results,error:String(error)})});});
