/** Synthetic account/IPC/HTTP fixture using actual onboarding components. No owner data or OS changes. */
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {AppearanceSettings} from "../components/appearance-settings";
import {AppearanceProvider} from "../components/appearance-provider";
import {applyAppearanceTheme,getSelectedTheme,createDefaultAppearanceState,APPEARANCE_STORAGE_KEY} from "../lib/appearance-storage";
import {ClientOnboarding} from "../components/client-onboarding";
import {SetupWizard} from "../components/setup-wizard";
import {PublicBaseUrlProvider} from "../components/public-base-url";
import {Toaster} from "../components/ui/sonner";
import {resolvePublicBaseUrl, type PublicBaseCheck} from "../lib/public-base-url";
import {ProviderSetupDialog} from "../components/provider-setup-dialog";
import {ProviderSetupPrompt} from "../components/provider-setup-prompt";
import {getThemePreset} from "../lib/appearance-theme";
import {onboardingStorageKey,PRODUCT_TOUR,suggestedAppPlatform,type TourTarget} from "../lib/client-onboarding";
const params=new URLSearchParams(location.search),view=params.get("view")||"install";
const originalFetch=window.fetch.bind(window);
const originalMatchMedia=window.matchMedia.bind(window),motionMedia=new EventTarget();let reducedMotion=false;
Object.defineProperties(motionMedia,{matches:{get:()=>reducedMotion},media:{value:"(prefers-reduced-motion: reduce)"}});
window.matchMedia=query=>query==="(prefers-reduced-motion: reduce)"?motionMedia as MediaQueryList:originalMatchMedia(query);
async function reduceMotion(value:boolean){reducedMotion=value;motionMedia.dispatchEvent(new Event("change"));await pause(40);}
let failures=0,permissionCalls=0,deviceCalls=0,serverCalls=0,providerCalls=0,pairingNavigationCalls=0,setupFinished=0,setupCompleteRequests=0;
let nativeId="",downloadFail=false,bootstrapCalls=0,providerRequests=0,adminRequests=0,osRequests=0,bootstrapFailureStatus=0,setupCompleteFailures=0,tokenCheckCalls=0;
let urlCheck: PublicBaseCheck = { state: "other_instance" };
let urlCheckRequests = 0, testAdminSession = false;
const nav:TourTarget[]=[]; // No navigation callback is passed by onboarding.
const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>boolean,label:string){for(let i=0;i<150;i++){if(test())return;await pause(20);}throw Error("Timed out: "+label);}
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
 if(url==="/api/setup"){const body=init?.body?JSON.parse(String(init.body)):{};if(body.action==="check-public-url"){
   if (!testAdminSession || "setupToken" in body || typeof body.publicUrl!=="string") return Response.json({error:"Invalid fixture request"},{status:403});
   urlCheckRequests++;await pause(300);return Response.json({check:urlCheck,...(urlCheck.state==="verified"?{base:resolvePublicBaseUrl(body.publicUrl)}:{})});
  }if(body.action==="check-token"){tokenCheckCalls++;await pause(60);
    if(Object.keys(body).length!==2||!["synthetic-token","fixture-only-token"].includes(body.setupToken))return Response.json({error:"A valid operator setup token is required."},{status:403});
    return Response.json({ok:true});
  }if(body.action==="bootstrap"){bootstrapCalls++;if(body.osUsername!=="root")return Response.json({error:"Missing fixture OS account"},{status:400});await pause(60);if(bootstrapFailureStatus){const status=bootstrapFailureStatus;bootstrapFailureStatus=0;return Response.json({error:"Synthetic bootstrap error"},{status});}testAdminSession=true;return Response.json({user:{id:"fixture-admin",username:"Demo",isAdmin:true}});}if(body.action==="complete"){setupCompleteRequests++;if(setupCompleteFailures>0){setupCompleteFailures--;return Response.json({error:"Synthetic completion error"},{status:503});}return Response.json({ok:true});}if(body.action==="os-users")osRequests++;return Response.json({platform:"linux",osUsers:[],osUsersAvailable:false});}
 if(url==="/api/providers"){providerRequests++;return Response.json({providers:[{key:"synthetic-provider",name:"Fixture provider",description:"Isolated UI test only",authTypes:["api_key"],capabilities:[]}]});}
 if(url==="/api/admin/users"){adminRequests++;return Response.json({users:[{id:"fixture-admin",username:"Demo",isAdmin:true}]});}
 return originalFetch(input,init);
};
const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
const report=document.createElement("pre");report.hidden=params.has("clean");report.id="onboarding-results";report.style.cssText="position:fixed;left:8px;bottom:6px;max-width:calc(100vw - 16px);max-height:85px;overflow:auto;background:#111;color:#d1fae5;padding:6px;font:10px monospace;z-index:200;pointer-events:none";document.body.append(report);
document.documentElement.classList.add("dark");
const results:string[]=[];const check=(ok:unknown,label:string)=>{results.push((ok?"PASS ":"FAIL ")+label);if(!ok)failures++;report.textContent=results.join("\n");};
function Harness({owner,hasProvider=true}:{owner:string;hasProvider?:boolean}){
 const [providerOpen,setProviderOpen]=useState(false);
 const [replay,setReplay]=useState(false);
 return <AppearanceProvider><main style={{padding:30}}><h1>Synthetic Metis workspace</h1><div style={{position:"fixed",bottom:24,left:30,width:Math.min(600,innerWidth-60)}}>{hasProvider?<input data-onboarding-target="chat" aria-label="Existing draft" defaultValue="Keep this draft" style={{width:"100%",height:44}}/>:<ProviderSetupPrompt onClick={()=>{providerCalls++;setProviderOpen(true);}}/>}</div>
 <button onClick={()=>setReplay(true)}>Replay onboarding</button>
 {PRODUCT_TOUR.map(item=><button key={item.id} data-onboarding-target={item.id==="chat"?undefined:item.id} style={{margin:8,padding:16}}>{item.action}</button>)}
 </main>
 <ClientOnboarding userId={owner} username={owner} hasProvider={hasProvider} onPairDevice={()=>{pairingNavigationCalls++;}} replay={replay} onReplayClose={()=>setReplay(false)}/>
 <ProviderSetupDialog open={providerOpen} onOpenChange={setProviderOpen} onConnected={()=>setProviderOpen(false)} onSkip={()=>setProviderOpen(false)}/></AppearanceProvider>;
}
let nonce=0;
async function mount(owner="alice",hasProvider=true){root.render(<Harness key={++nonce} owner={owner} hasProvider={hasProvider}/>);await pause(250);}
function button(text:string){const scope=document.querySelector(".onboarding-tour")||document;return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(button=>button.textContent?.trim()===text||button.getAttribute("aria-label")?.split(",")[0]===text);}
function linearNavigation(){const scope=document.querySelector(".onboarding-tour")||document.querySelector(".onboarding-stage");const buttons=Array.from(scope?.querySelectorAll("button")||[]);return buttons.length>=1&&buttons.length<=2&&buttons.every(el=>["Back","Continue","Finish"].includes(el.textContent?.trim()||""));}
async function selectPlatform(value:string){const select=document.querySelector<HTMLSelectElement>('select[aria-label="App platform"]')!;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));await pause(150);}
async function click(text:string){const target=button(text);if(!target)throw Error("Missing button "+text);
 if((text==="Continue"||text==="Create admin"||text==="Finish"||text==="Enter Metis")&&document.querySelector(".onboarding-stage,.onboarding-tour")){const footer=target.closest(".onboarding-footer"),dots=footer?.querySelector(".onboarding-progress"),actions=target.closest(".onboarding-actions");const b=target.getBoundingClientRect(),p=dots?.getBoundingClientRect(),f=footer?.getBoundingClientRect();check(!!footer&&!!actions&&!!p&&!!f&&Math.abs(p.top+p.height/2-b.top-b.height/2)<2&&Math.abs(f.right-b.right)<2&&p.right<b.left,"Continue stays bottom-right on the dots row: "+(document.querySelector(".onboarding-tour h2")?.textContent||document.querySelector(".onboarding-stage h1")?.textContent));}
 target.click();await pause(150);for(let i=0;i<60&&document.querySelector('.onboarding-transition[data-phase="out"]');i++)await pause(20);}
function read(owner:string,client="browser"){return JSON.parse(localStorage.getItem(onboardingStorageKey(owner,client))||"null");}
async function fill(label:string,value:string){
 const el=Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(el=>el.getAttribute("aria-label")===label||Array.from(el.labels || []).some(item=>item.textContent?.includes(label)));
 if(!el)throw Error("Missing input "+label);
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));await pause(30);
}
async function waitForSetupStep(label:string){
 await until(()=>document.querySelector(".onboarding-stage h1")?.textContent===label
  && !document.querySelector('.onboarding-transition[data-phase="out"]'),"setup step: "+label);
}
async function fillAdminSteps(token="synthetic-token") {
 await fill("Operator setup token",token);await click("Continue");await waitForSetupStep("Admin username");
 await fill("Admin username","demo-admin");await click("Continue");await waitForSetupStep("Password");
 await fill("Password","synthetic-password");await click("Continue");await waitForSetupStep("Run agents as");
}
async function reportResults() {
 document.body.dataset.complete="true";report.textContent=failures?results.filter(x=>x.startsWith("FAIL")).join("\n"):"PASS "+results.length+" onboarding assertions · "+innerWidth+"px";
 await originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,height:innerHeight,view,results,nativeId,permissionCalls,deviceCalls,serverCalls})});
}
async function runPublicUrlCheck() {
 await reduceMotion(true);
 const mountUrl = (value: string | undefined, hasUsers: boolean) => root.render(<AppearanceProvider><PublicBaseUrlProvider base={resolvePublicBaseUrl(value)}><SetupWizard key={value || "unset"} open hasUsers={hasUsers} onFinished={()=>{setupFinished++;}}/><Toaster duration={20000}/></PublicBaseUrlProvider></AppearanceProvider>);
 const heading = () => document.querySelector(".onboarding-stage h1")?.textContent;
 const progress = () => document.querySelector(".onboarding-progress")?.getAttribute("aria-label");
 const disclosureWorks = (label: string) => {
  const toggle = button(label);
  const content = document.getElementById(toggle?.getAttribute("aria-controls") || "");
  if (!toggle || !content || !content.hidden || !toggle.querySelector("svg.lucide-chevron-right")) return false;
  toggle.focus(); toggle.click();
  return toggle;
 };
 const feedback = () => document.querySelector('[role="alert"]')?.textContent;
 const address = () => document.querySelector<HTMLInputElement>('input[type="url"]');
 const marker = () => document.querySelector<HTMLElement>('[data-url-verified]');
 mountUrl(undefined,true);await until(()=>heading()==="What's your public URL?","resumed URL step");
 check(address()?.value===""&&button("Check URL")?.disabled&&!button("Finish")?.disabled,"missing URL does not block Finish");
 mountUrl("https://metis.example/",false);await until(()=>heading()==="Operator setup token","fresh token step");
 check(progress()==="Step 1 of 5"&&!button("Check URL"),"fresh setup starts on admin, not the URL check");
 const tokenDisclosure=disclosureWorks("Where to find the setup token");
 await until(()=>!!tokenDisclosure&&tokenDisclosure.getAttribute("aria-expanded")==="true","operator token help expands");
 check(tokenDisclosure&&document.activeElement===tokenDisclosure&&!document.getElementById(tokenDisclosure.getAttribute("aria-controls")!)?.hidden,"token help uses the focusable chevron disclosure");
 await fillAdminSteps("fixture-only-token");await fill("Run agents as","root");
 await click("Create admin");await until(()=>heading()==="What's your public URL?","URL step after creating admin");
 check(progress()==="Step 5 of 5"&&address()?.value==="https://metis.example"&&!document.querySelector('input[type="password"]')&&setupCompleteRequests===0,"public address has its own editable field and credentials are cleared");
 const urlDisclosure=disclosureWorks("How do I change this?");
 await until(()=>!!urlDisclosure&&urlDisclosure.getAttribute("aria-expanded")==="true","URL configuration help expands");
 check(urlDisclosure&&!document.getElementById(urlDisclosure.getAttribute("aria-controls")!)?.hidden,"URL help uses the same disclosure");
 button("Check URL")!.click();await until(()=>!!button("Checking…"),"loading state");
 check(button("Checking…")?.disabled&&button("Finish")?.disabled,"loading prevents a duplicate probe or early Finish");
 await until(()=>feedback()?.includes("a different Metis server")===true,"mismatch message");
 check(bootstrapCalls===1&&setupCompleteRequests===0&&urlCheckRequests===1&&marker()?.dataset.urlVerified==="false","mismatch stays inline and is never marked verified");
 await fill("Server address","https://corrected.example/");
 urlCheck={state:"verified"};
 await click("Check URL");
 await until(()=>marker()?.dataset.urlVerified==="true"&&!!document.querySelector('[data-sonner-toast][data-type="success"]'),"verified toast and checkmark");
 check(urlCheckRequests===2&&!button("Finish")?.disabled&&address()?.value==="https://corrected.example","corrected address is normalized and saved without blocking Finish");
 check(marker()?.getAttribute("aria-label")==="URL verified"&&document.querySelector('[data-sonner-toast]')?.textContent?.includes("Public URL verified"),"success uses an accessible checkmark and the canonical toast");
 check(!!marker()?.className.includes("motion-reduce:transition-none"),"checkmark respects reduced motion");
 await fill("Server address","https://changed.example");
 check(marker()?.dataset.urlVerified==="false","editing a verified address clears its checkmark");
 await fill("Server address","https://corrected.example");
 await click("Check URL");
 await until(()=>marker()?.dataset.urlVerified==="true","restored success for visual inspection");
 check(document.documentElement.scrollWidth<=innerWidth+1,"expanded URL help fits viewport");
 await reportResults();
}
async function run(){
 if (view === "url-check") return runPublicUrlCheck();
 if (view === "server-only") {
  root.render(<AppearanceProvider><PublicBaseUrlProvider base={resolvePublicBaseUrl(undefined)}><SetupWizard open hasUsers={false} onFinished={()=>{}}/></PublicBaseUrlProvider></AppearanceProvider>);
  return;
 }
 for(const key of Object.keys(localStorage))if(key.startsWith("metis:onboarding:"))localStorage.removeItem(key);
 localStorage.removeItem(APPEARANCE_STORAGE_KEY);browser();await mount();
 check(document.documentElement.dataset.surface==="midnight"&&getComputedStyle(document.documentElement).getPropertyValue("--background").trim()===getThemePreset("midnight")!.variables["--background"],"fresh theme is Midnight");
 const intro=document.querySelector<HTMLElement>(".onboarding-motion")!,introSvg=intro.querySelector("svg")!;
 check(intro.dataset.onboardingReady==="true"&&intro.dataset.onboardingEntrance==="running"&&Number(getComputedStyle(introSvg).opacity)<1,"loaded page starts a real coordinated edge fade instead of popping in");
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
 check(!document.querySelector('input[name="color-theme"][value="metis"]')&&document.querySelectorAll('input[name="color-theme"]').length===7,"retired Metis preset is absent while all six presets and custom theme remain");
 const midnight=document.querySelector<HTMLInputElement>('input[name="color-theme"][value="midnight"]')!;midnight.click();await pause();await mount();
 check(document.documentElement.dataset.surface==="midnight","appearance picker restores Midnight");
 check(linearNavigation(),"welcome has one Continue action and no appearance or dismissal controls");
 check(document.body.textContent?.includes("Welcome, alice"),"fresh browser opens account-specific introduction");
 const wave=document.querySelector(".onboarding-motion mask path")!,before=wave.getAttribute("d");await pause(160);
 check(before!==wave.getAttribute("d"),"real dot/wave contour animates");
 check(document.querySelectorAll(".onboarding-motion svg").length===1,"one wave controller is mounted");
 for(let i=0;i<80&&document.querySelector<HTMLElement>(".onboarding-motion")?.dataset.onboardingEntrance!=="done";i++)await pause(20);
 const motion=document.querySelector<SVGSVGElement>(".onboarding-motion svg")!;
 check(document.querySelector<HTMLElement>(".onboarding-motion")?.dataset.onboardingEntrance==="done","edge entrance reaches its exact final state after page readiness");
 check(getComputedStyle(motion).color==="rgb(255, 255, 255)"&&getComputedStyle(motion).opacity==="1","onboarding dots use white at full opacity");
 const glow=motion.querySelector<SVGGElement>("[data-onboarding-glow]")!;
 check(!!glow&&getComputedStyle(glow).filter!=="none"&&Number(getComputedStyle(glow).opacity)>0&&motion.querySelector("feGaussianBlur")?.getAttribute("stdDeviation")==="8","soft white edge glow remains behind sharp dots");
 check(motion.querySelector('[data-onboarding-geometry]')?.getAttribute("stroke")==="none"&&motion.querySelectorAll(":scope > g > rect").length===1&&motion.querySelector(":scope > g > rect")?.getAttribute("fill")?.startsWith("url("),"dot layer has no perimeter stroke or hard solid border band");
 const stableEdge=document.querySelector(".onboarding-motion svg");
 button("Continue")!.click();await pause(25);
 check(document.querySelector(".onboarding-shell")?.getAttribute("data-phase")==="out"&&document.querySelector(".onboarding-shell")?.hasAttribute("inert"),"Continue fades the previous step and blocks repeated actions");
 await pause(120);
 for(let i=0;i<100&&document.querySelector(".onboarding-shell")?.getAttribute("data-phase")==="out";i++)await pause(10);
 check(document.querySelector(".onboarding-motion svg")===stableEdge,"step navigation keeps the same glow and dot controller");
 check(document.querySelector(".onboarding-shell")?.getAttribute("data-phase")==="in","the next step fades in after the previous step leaves");
 check(!!document.querySelector('[aria-label="Get the Metis app"]'),"web onboarding offers the desktop app");
 check(document.querySelectorAll(".onboarding-platforms option:not([disabled])").length===5,"Windows macOS Linux iOS Android can all be selected");
 for(let i=0;i<60&&!document.querySelector<HTMLSelectElement>('.onboarding-platforms select')?.value;i++)await pause(20);
 const expected=suggestedAppPlatform(navigator);
 check(document.querySelector<HTMLSelectElement>('.onboarding-platforms select')?.value===expected,"actual browser OS is suggested");
 await selectPlatform("windows");await selectPlatform("macos");await pause(400);
 check(document.querySelector(".onboarding-downloads a")?.textContent?.includes("Apple Silicon")&&!document.querySelector(".onboarding-downloads a")?.textContent?.includes("Windows"),"late download response cannot replace a newer OS selection");
 await selectPlatform("ios");check(document.body.textContent?.includes("iOS · In development")&&!document.querySelector(".onboarding-downloads a"),"iOS is explicitly in development without a download");
 await selectPlatform("android");check(document.body.textContent?.includes("Android · In development")&&!document.querySelector(".onboarding-downloads a"),"Android is explicitly in development without a download");
 downloadFail=true;await selectPlatform("linux");await pause(100);
 check(document.querySelector('[role="alert"]')?.textContent?.includes("Synthetic download error"),"download lookup failure is visible");
 await click("Retry");await pause(100);check(!!document.querySelector(".onboarding-downloads a"),"download lookup can retry successfully");
 check(linearNavigation(),"app offer has only Back and Finish navigation");await click("Finish");
 check(!document.querySelector(".onboarding-tour,.onboarding-tour-highlight")&&read("alice")?.phase==="done","Finish enters workspace directly without cards or target rings");
 check(nav.length===0,"completion never navigates away from the current workspace");
 await mount();check(!document.querySelector(".onboarding-stage"),"completed introduction stays closed after remount");
 const savedWeb=localStorage.getItem(onboardingStorageKey("alice"));
 const savedAppearance=localStorage.getItem(APPEARANCE_STORAGE_KEY);
 await fill("Existing draft","Unsent draft from before replay");
 await click("Replay onboarding");check(!!document.querySelector(".onboarding-stage h1")?.textContent?.includes("Welcome, alice"),"Replay onboarding opens at Welcome despite completed progress");
 await click("Continue");
 check(!!document.querySelector('[aria-label="Get the Metis app"]')&&localStorage.getItem(onboardingStorageKey("alice"))===savedWeb,"Replay can show the app step without writing progress");
 await click("Close");check(!document.querySelector(".onboarding-stage"),"the Close button dismisses replay without finishing");
 await click("Replay onboarding");check(!!document.querySelector(".onboarding-stage h1")?.textContent?.includes("Welcome, alice"),"replay starts fresh after dismissal");
 await click("Continue");await click("Back");
 check(!!document.querySelector(".onboarding-stage h1")?.textContent?.includes("Welcome, alice"),"Back works within the replay");
 await click("Continue");await click("Finish");
 check(!document.querySelector(".onboarding-stage")&&localStorage.getItem(onboardingStorageKey("alice"))===savedWeb&&localStorage.getItem(APPEARANCE_STORAGE_KEY)===savedAppearance&&document.querySelector<HTMLInputElement>('[aria-label="Existing draft"]')?.value==="Unsent draft from before replay","finishing replay preserves completion, appearance and the existing draft");
 await mount("bob");check(document.body.textContent?.includes("Welcome, bob"),"another account on same browser receives its own onboarding");
 await click("Continue");await click("Finish");
 check(read("bob")?.phase==="done"&&document.querySelector<HTMLInputElement>('[aria-label="Existing draft"]')?.value==="Keep this draft","completion preserves the existing workspace draft");
 for(let tourIndex=0;tourIndex<6;tourIndex++){
  const owner="legacy-tour-"+tourIndex;
  localStorage.setItem(onboardingStorageKey(owner),JSON.stringify({version:1,phase:"tour",tourIndex}));
  await mount(owner);
  check(!document.querySelector(".onboarding-stage,.onboarding-tour,.onboarding-tour-highlight"),"saved tour step "+tourIndex+" opens directly in workspace");
 }
 dispatchEvent(new Event("metis:onboarding-open"));await pause();check(!!document.querySelector(".onboarding-stage"),"account menu event can restart a completed guide");
 native("one");await mount("alice");
 check(!document.body.textContent?.includes("Metis · This desktop")&&document.body.textContent?.includes("Welcome, alice")&&read("alice")?.phase==="done","native client is separate from web completion without desktop eyebrow");
 await click("Continue");
 check(!document.querySelector('[aria-label="Get the Metis app"]')&&!!document.querySelector('input[type="checkbox"]'),"native onboarding offers one optional device choice instead of another settings panel");
 check(linearNavigation(),"native device step has only Back and Finish buttons");
 check(permissionCalls===0,"OS permission prompts are never automatic");
 document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();await pause();await click("Finish");check(pairingNavigationCalls===1&&!document.querySelector(".onboarding-stage")&&read("alice","desktop:one")?.phase==="device","opt-in Continue opens real pairing settings without completing or losing the device step");dispatchEvent(new Event("metis:onboarding-open"));await pause();
 await click("Finish");check(!document.querySelector(".onboarding-stage,.onboarding-tour,.onboarding-tour-highlight"),"desktop webview finishes directly without tour cards");check(read("alice","desktop:one")?.phase==="done","native completion is stored for this user/installation");
 check(permissionCalls===0&&deviceCalls===0&&serverCalls===0,"Continue never prompts or changes system access");
 const savedDesktop=localStorage.getItem(onboardingStorageKey("alice","desktop:one"));
 await click("Replay onboarding");
 await click("Continue");
 check(!!document.querySelector(".onboarding-stage h1")?.textContent?.includes("Set up this desktop")&&!document.querySelector('.onboarding-stage input[type="checkbox"]'),"desktop webview replay explains device setup without offering a pairing action");
 await click("Finish");
 check(!document.querySelector(".onboarding-stage")&&localStorage.getItem(onboardingStorageKey("alice","desktop:one"))===savedDesktop&&pairingNavigationCalls===1&&permissionCalls===0&&deviceCalls===0&&serverCalls===0,"desktop webview replay leaves install progress, pairing and permissions unchanged");
 native("two");await mount("alice");check(!!document.querySelector(".onboarding-stage"),"another desktop gets an independent guide");
 await mount("bob");check(document.body.textContent?.includes("Welcome, bob"),"another user on this desktop gets their own guide");
 native("late",300);root.render(<Harness key={++nonce} owner="late-owner"/>);await pause(20);browser();await mount("other-owner");await pause(400);
 check(document.body.textContent?.includes("Welcome, other-owner")&&!document.body.textContent?.includes("Welcome, late-owner"),"late native-context reply cannot switch another user's onboarding");
 localStorage.setItem(onboardingStorageKey("broken"),"{bad");await mount("broken");check(!!document.querySelector(".onboarding-stage"),"corrupt client progress recovers to welcome");
 await mount("provider-owner",false);check(providerCalls===0&&linearNavigation(),"missing provider does not add another welcome action");
 await click("Continue");await click("Finish");
 const providerTarget=document.querySelector<HTMLButtonElement>('[data-onboarding-target="chat"]')!;
 check(!!providerTarget&&!document.querySelector(".onboarding-tour,.onboarding-tour-highlight")&&providerCalls===0,"missing provider does not trigger cards, rings or an automatic connection");
 providerTarget.click();await pause();check(providerCalls===1&&!!document.querySelector('[role="dialog"]'),"the ordinary provider action remains available");
 root.render(<div/>);await pause();
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
 browser();await mount("live-motion");button("Continue")!.click();await pause(25);await reduceMotion(true);
 check(!!document.querySelector('[aria-label="Get the Metis app"]')&&document.querySelector(".onboarding-shell")?.getAttribute("data-phase")==="idle","live Reduce Motion cancels an in-flight step fade and shows the exact target");
 check(document.querySelector<HTMLElement>(".onboarding-motion")?.dataset.onboardingEntrance==="done"&&document.querySelector("svg")?.getAnimations().length===0,"live Reduce Motion finishes the edge entrance immediately");
 const reducedWave=document.querySelector(".onboarding-motion mask path")!.getAttribute("d");await pause(140);check(document.querySelector(".onboarding-motion mask path")!.getAttribute("d")===reducedWave,"Reduce Motion freezes wave geometry");
 await click("Back");check(document.body.textContent?.includes("Welcome, live-motion"),"reduced-motion Back swaps immediately without a fade delay");await reduceMotion(false);
 // Controlled asset readiness on this isolated fixture, never production browser settings.
 const fontDescriptor=Object.getOwnPropertyDescriptor(document,"fonts");let finishFonts:()=>void=()=>{};
 try{
  Object.defineProperty(document,"fonts",{configurable:true,value:{ready:new Promise<void>(resolve=>{finishFonts=resolve;})}});
  await mount("waiting-assets");
  const waitingHost=document.querySelector<HTMLElement>(".onboarding-motion")!,waitingSvg=waitingHost.querySelector("svg")!;
  check(waitingHost.dataset.onboardingEntrance==="pending"&&getComputedStyle(waitingSvg).opacity==="0"&&getComputedStyle(document.querySelector(".onboarding-shell")!).opacity==="0","initial scene and edge wait together for assets without flashing");
  finishFonts();await pause(50);
  check(waitingHost.dataset.onboardingReady==="true"&&waitingHost.dataset.onboardingEntrance==="running","settled assets release the coordinated content and edge entrance");
  root.render(<div/>);await pause(750);
  check(!document.querySelector(".onboarding-motion")&&waitingHost.dataset.onboardingEntrance===undefined,"leaving during entrance cancels animation and stale readiness callbacks");
 }finally{if(fontDescriptor)Object.defineProperty(document,"fonts",fontDescriptor);else Reflect.deleteProperty(document,"fonts");}
 // Actual minimal setup UI, with fake HTTP only: no owner account changes.
 const providerBeforeSetup=providerRequests,adminBeforeSetup=adminRequests,osBeforeSetup=osRequests;
 const mountSetup=async(hasUsers=false)=>{root.render(<SetupWizard key={"setup-"+ ++nonce} open hasUsers={hasUsers} onFinished={()=>{setupFinished++;}}/>);await pause(220);};
 const activeInput=()=>document.querySelector<HTMLInputElement>(".onboarding-stage form input");
 const stepIs=(label:string,index:number)=>document.querySelector(".onboarding-stage h1")?.textContent===label&&
   document.querySelector(".onboarding-progress")?.getAttribute("aria-label")===`Step ${index} of 5`&&
   document.querySelectorAll(".onboarding-stage input").length===1&&activeInput()?.labels?.[0]?.textContent===label;
 const alert=()=>document.querySelector('[role="alert"]')?.textContent;
 const fillAdmin=async()=>{await fillAdminSteps();await fill("Run agents as"," root ");};
 sessionStorage.setItem("metis-setup-step","provider");await mountSetup();
 check(stepIs("Operator setup token",1)&&activeInput()?.type==="password","fresh and legacy setup start with only the masked token");
 check(document.activeElement===activeInput()&&!button("Back"),"token receives initial focus and there is no Back on the first step");
 check(button("Where to find the setup token")?.getAttribute("aria-expanded")==="false","operator-token help is collapsed by default");
 await click("Continue");check(tokenCheckCalls===0&&activeInput()?.validity.valueMissing,"required token blocks the first step");
 await fill("Operator setup token","invalid-token");await click("Continue");
 await until(()=>alert()?.includes("valid operator setup token")===true,"wrong-token feedback");
 check(stepIs("Operator setup token",1)&&alert()?.includes("valid operator setup token")&&bootstrapCalls===0,"wrong token is rejected before asking for credentials");
 await fill("Operator setup token","synthetic-token");await click("Continue");await waitForSetupStep("Admin username");
 check(stepIs("Admin username",2)&&document.activeElement===activeInput()&&activeInput()?.autocomplete==="username","username appears and receives focus after token validation");
 await fill("Admin username","bad name");await click("Continue");
 check(stepIs("Admin username",2)&&alert()?.includes("3–64"),"invalid admin username stays on its own step");
 await fill("Admin username","demo-admin");await click("Continue");
 check(stepIs("Password",3)&&activeInput()?.type==="password"&&activeInput()?.autocomplete==="new-password","password is masked and follows username");
 await fill("Password","short");await click("Continue");
 check(stepIs("Password",3)&&bootstrapCalls===0,"short password does not advance");
 await fill("Password","synthetic-password");await click("Back");
 check(stepIs("Admin username",2)&&activeInput()?.value==="demo-admin","Back preserves the previously entered username");
 await click("Continue");
 check(stepIs("Password",3)&&activeInput()?.value==="synthetic-password","returning to password keeps the unsaved draft");
 await click("Continue");
 check(stepIs("Run agents as",4)&&document.activeElement===activeInput()&&bootstrapCalls===0,"OS username is last and nothing is created before submission");
 await click("Create admin");
 check(bootstrapCalls===0&&activeInput()?.validity.valueMissing,"missing OS user blocks account creation");
 await fill("Run agents as","   ");await click("Create admin");
 check(bootstrapCalls===0&&alert()?.includes("Enter the OS username"),"whitespace OS user blocks account creation");
 await fill("Run agents as"," root ");bootstrapFailureStatus=400;await click("Create admin");
 await until(()=>alert()?.includes("Synthetic bootstrap error")===true,"OS account feedback");
 check(bootstrapCalls===1&&stepIs("Run agents as",4)&&!!alert(),"an OS validation error stays on the last input");
 bootstrapFailureStatus=403;await click("Create admin");await waitForSetupStep("Operator setup token");
 check(bootstrapCalls===2&&setupCompleteRequests===0&&stepIs("Operator setup token",1)&&activeInput()?.value===""&&!!alert(),"an expired token returns to the first step without creating an admin");
 await fill("Operator setup token","synthetic-token");await click("Continue");await waitForSetupStep("Admin username");
 await click("Continue");await waitForSetupStep("Password");
 await click("Continue");await waitForSetupStep("Run agents as");
 button("Create admin")!.click();button("Create admin")!.click();await pause(260);
 await until(()=>!!button("Finish"),"URL step after account submission");
 check(bootstrapCalls===3&&setupCompleteRequests===0&&document.body.textContent?.includes("What's your public URL?"),"one valid submit creates one admin and reaches the URL step before finishing");
 await click("Finish");await until(()=>setupFinished===1,"URL step finish callback");
 check(!document.querySelector('input[type="password"]'),"acknowledged creation clears credential fields");
 check(providerRequests===providerBeforeSetup&&adminRequests===adminBeforeSetup&&osRequests===osBeforeSetup,"setup never fetches providers, lists extra users or discovers OS users");
 await mountSetup();await fillAdmin();setupCompleteFailures=1;await click("Create admin");await until(()=>!!button("Finish"),"first URL step");
 await click("Finish");await until(()=>!!document.querySelector('[role="alert"]')?.textContent?.includes("Synthetic completion error")&&!document.querySelector('input[type="password"]'),"completion error after committed account scene");
 const createsBeforeRetry=bootstrapCalls,completesBeforeRetry=setupCompleteRequests;
 check(!document.querySelector('input[type="password"]')&&document.querySelector('[role="alert"]')?.textContent?.includes("Synthetic completion error"),"completion failure keeps the acknowledged admin instead of asking for credentials again");
 await click("Finish");await until(()=>setupFinished===2,"completion retry callback");check(bootstrapCalls===createsBeforeRetry&&setupCompleteRequests===completesBeforeRetry+1&&setupFinished===2,"completion retry never recreates an admin or resubmits secrets");
 sessionStorage.setItem("metis-setup-step","people");await mountSetup(true);
 check(!!document.querySelector('input[type="url"]')&&document.body.textContent?.includes("What's your public URL?"),"existing incomplete installs resume directly at the URL step");
 const beforeResume=bootstrapCalls;await click("Finish");await until(()=>setupFinished===3,"resume completion callback");check(bootstrapCalls===beforeResume&&setupFinished===3,"resuming existing setup cannot create another account");
 await mountSetup();await fillAdmin();bootstrapFailureStatus=409;await click("Create admin");await waitForSetupStep("Sign in to continue");
 check(document.querySelectorAll("input").length===0&&document.body.textContent?.includes("Sign in to continue"),"an already-created account switches to sign-in recovery without another bootstrap");
 check(![...Object.keys(localStorage)].some(k=>(localStorage.getItem(k)||"").includes("synthetic-password")||(localStorage.getItem(k)||"").includes("synthetic-token")),"setup secrets never enter client onboarding storage");
 root.render(<ProviderSetupDialog open onOpenChange={()=>{}} onConnected={()=>{}}/>);await pause(180);
 check(providerRequests===providerBeforeSetup+1&&!document.querySelector(".onboarding-stage")&&!!button("Continue"),"provider connection remains available only when explicitly opened inside the ordinary UI");
 await click("Continue");check(!!document.querySelector('input[type="password"]'),"ordinary provider connection still reaches its existing credential form");
 root.render(<div/>);await pause(100);check(!document.querySelector(".onboarding-motion svg"),"leaving onboarding disposes its animation controller");
 applyAppearanceTheme(document.documentElement,getSelectedTheme(createDefaultAppearanceState()),"metis");
 const noOverflow=()=>document.documentElement.scrollWidth<=innerWidth+1;
 browser();await mount("Demo");
 if(view==="appearance"){root.render(<AppearanceProvider><AppearanceSettings/></AppearanceProvider>);await pause(200);}
 else if(view==="replay"){localStorage.setItem(onboardingStorageKey("Demo"),JSON.stringify({version:1,phase:"done",tourIndex:0}));await mount("Demo");await click("Replay onboarding");}
 else if(view==="install")await click("Continue");
 else if(view==="server"){sessionStorage.removeItem("metis-setup-step");root.render(<SetupWizard open hasUsers={false} onFinished={()=>{}}/>);await pause(200);}
 else if(view==="native"){native("visual");await mount("Demo");await click("Continue");}
 else if(view==="tour"||view==="finish"||view==="tour-empty"){if(view==="tour-empty")await mount("Demo-empty",false);await click("Continue");await click("Finish");}
 check(noOverflow(),"layout has no horizontal page overflow at "+innerWidth);
 await reportResults();
}
void run().catch(error=>{check(false,String(error));document.body.dataset.complete="error";void originalFetch("/report",{method:"POST",body:JSON.stringify({width:innerWidth,height:innerHeight,view,results,error:String(error)})});});
