"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,Shield} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {OnboardingStage,OnboardingProgress} from "@/components/onboarding-stage";
import {AppInstallOffer} from "@/components/app-install-offer";
import {desktopBridge} from "@/lib/desktop-bridge";
import {onboardingStorageKey,parseOnboardingState,type ClientOnboardingState} from "@/lib/client-onboarding";
const sessionProgress=new Map<string,ClientOnboardingState>();
type ClientOnboardingProps = {
 userId:string;
 username:string;
 hasProvider:boolean;
 onPairDevice?:()=>void;
 replay?:boolean;
 onReplayClose?:()=>void;
};
export function ClientOnboarding({userId,username,hasProvider,onPairDevice,replay=false,onReplayClose}:ClientOnboardingProps){
 const [scope,setScope]=useState<{key:string;native:boolean;userId:string}|null>(null),[state,setState]=useState<ClientOnboardingState|null>(null);
 const [setupDevice,setSetupDevice]=useState(false);
 const [replayPhase,setReplayPhase]=useState<"welcome"|"app"|"device">("welcome");
 const [paused,setPaused]=useState(false),[storageUnavailable,setStorageUnavailable]=useState(false);
 const scene=useRef(state);scene.current=state;
 useEffect(()=>{
  let live=true;setScope(null);setState(null);setPaused(false);
  const bridge=desktopBridge();
  void (async()=>{
   let id=bridge?"desktop":"browser";
   try{const context=await bridge?.onboardingContext?.();if(context?.installationId)id="desktop:"+context.installationId;}catch{/* Old clients still have isolated local browser storage. */}
   if(!live)return;
   const key=onboardingStorageKey(userId,id);let saved:ClientOnboardingState;
   try{saved=parseOnboardingState(localStorage.getItem(key));setStorageUnavailable(false);}catch{saved=sessionProgress.get(key)||parseOnboardingState(null);setStorageUnavailable(true);}
   setScope({key,native:!!bridge,userId});setState(saved);
  })();
  return ()=>{live=false;};
 },[userId]);
 const save=useCallback((next:ClientOnboardingState)=>{
  if(!scope||scope.userId!==userId)return;
  sessionProgress.set(scope.key,next);setState(next);
  try{localStorage.setItem(scope.key,JSON.stringify(next));}catch{setStorageUnavailable(true);}
 },[scope,userId]);
 useEffect(()=>{
  if(!scope)return;
  const open=()=>{if(replay)return;setPaused(false);if(scene.current?.phase==="done")save({version:1,phase:"welcome",tourIndex:0});};
  const storage=(event:StorageEvent)=>{if(event.key===scope.key)setState(parseOnboardingState(event.newValue));};
  addEventListener("metis:onboarding-open",open);addEventListener("storage",storage);
  return ()=>{removeEventListener("metis:onboarding-open",open);removeEventListener("storage",storage);};
 },[scope,save,replay]);
 if(!scope||scope.userId!==userId||!state||(!replay&&(state.phase==="done"||paused)))return null;
 const native=scope.native;
 const phase=replay?replayPhase:state.phase;
 const steps=native?[{id:"welcome",label:"Welcome"},{id:"device",label:"This device"}]:[{id:"welcome",label:"Welcome"},{id:"app",label:"Get the app"}];
 const index=phase==="welcome"?0:1;
 const goTo=(next:"welcome"|"app"|"device")=>replay?setReplayPhase(next):save({...state,phase:next});
 const closeReplay=()=>{setReplayPhase("welcome");onReplayClose?.();};
 const advance=()=>{
  if(phase==="welcome")goTo(native?"device":"app");
  else if(replay)closeReplay();
  else if(native&&setupDevice&&onPairDevice){setSetupDevice(false);setPaused(true);onPairDevice();}
  else save({version:1,phase:"done",tourIndex:0});
 };
 return <Dialog open onOpenChange={open=>{if(!open){if(replay)closeReplay();else setPaused(true);}}}><DialogContent className="max-h-[100dvh] w-screen max-w-none gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none data-open:animate-none data-closed:animate-none" showCloseButton={replay}>
  <DialogTitle className="sr-only">Getting started with Metis</DialogTitle><DialogDescription className="sr-only">A guide for this account on this browser or desktop. You can continue later.</DialogDescription>
  <OnboardingStage key={scope.key+(replay?":replay":"")} transitionKey={phase} eyebrow="" title={phase==="welcome"?"Welcome, "+username:phase==="device"?"Set up this desktop":"Get the app"} description={phase==="welcome"?"Your workspace. Your way.":phase==="device"?"Device access is optional. Chat works without it.":"Desktop Assistant, notifications and device access."}
   progress={<OnboardingProgress steps={steps} index={index}/>} footer={<>
    {index>0?<Button variant="ghost" onClick={()=>goTo("welcome")}><ArrowLeft aria-hidden="true" className="size-4"/>Back</Button>:null}
    <Button onClick={advance}>{index===0?"Continue":"Finish"}<ArrowRight aria-hidden="true" className="size-4"/></Button>
   </>}>
    {!replay&&storageUnavailable?<p role="status" className="mb-4 text-xs text-muted-foreground">Browser storage is unavailable. Progress is kept for this session only.</p>:null}
    {phase==="welcome"?<div>
     {!hasProvider?<p className="mt-6 text-sm text-muted-foreground">Add a provider in Settings to start chatting.</p>:null}
    </div>:phase==="device"&&native?<div className="grid gap-5"><Shield className="size-8" aria-hidden="true"/><p className="text-sm text-muted-foreground">Pair this device in Settings → Devices. Permissions stay under your control.</p>{!replay&&onPairDevice?<label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={setupDevice} onChange={event=>setSetupDevice(event.target.checked)} className="size-4 accent-current"/>Set up computer access now</label>:null}</div>:<AppInstallOffer/>}
  </OnboardingStage>
 </DialogContent></Dialog>;
}
