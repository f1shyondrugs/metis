"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,Check,MessageSquare,Folder,NotebookPen,Monitor,Settings,Puzzle,Shield} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {OnboardingStage,OnboardingMotion,OnboardingProgress,OnboardingTransition} from "@/components/onboarding-stage";
import {AppInstallOffer} from "@/components/app-install-offer";
import {desktopBridge} from "@/lib/desktop-bridge";
import {onboardingStorageKey,parseOnboardingState,PRODUCT_TOUR,type ClientOnboardingState,type TourTarget} from "@/lib/client-onboarding";
const sessionProgress=new Map<string,ClientOnboardingState>();
const tourIcons=[MessageSquare,Folder,NotebookPen,Monitor,Puzzle,Settings];
export function ClientOnboarding({userId,username,onNavigate,hasProvider,onPairDevice}:{userId:string;username:string;onNavigate:(target:TourTarget)=>void;onConnectProvider:()=>void;hasProvider:boolean;onPairDevice?:()=>void}){
 const [scope,setScope]=useState<{key:string;native:boolean;userId:string}|null>(null),[state,setState]=useState<ClientOnboardingState|null>(null);
 const [setupDevice,setSetupDevice]=useState(false);
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
  const open=()=>{setPaused(false);if(scene.current?.phase==="done")save({version:1,phase:"welcome",tourIndex:0});};
  const storage=(event:StorageEvent)=>{if(event.key===scope.key)setState(parseOnboardingState(event.newValue));};
  addEventListener("metis:onboarding-open",open);addEventListener("storage",storage);
  return ()=>{removeEventListener("metis:onboarding-open",open);removeEventListener("storage",storage);};
 },[scope,save]);
 const finish=()=>save({version:1,phase:"done",tourIndex:0});
 if(!scope||scope.userId!==userId||!state||state.phase==="done"||paused)return null;
 if(state.phase==="tour")return <ProductTour index={state.tourIndex} onNavigate={onNavigate} onPause={()=>setPaused(true)} onIndex={index=>save({...state,tourIndex:index})} onBack={()=>save({...state,phase:scope.native?"device":"app",tourIndex:0})} onFinish={finish}/>;
 const native=scope.native;
 const steps=native?[{id:"welcome",label:"Welcome"},{id:"device",label:"This device"}]:[{id:"welcome",label:"Welcome"},{id:"app",label:"Get the app"}];
 const index=state.phase==="welcome"?0:1;
 const next=()=>save({...state,phase:native?"device":"app"});
 const beginTour=()=>{onNavigate("chat");save({...state,phase:"tour",tourIndex:0});};
 const advance=()=>{if(state.phase==="welcome")next();else if(native&&setupDevice&&onPairDevice){setSetupDevice(false);setPaused(true);onPairDevice();}else beginTour();};
 return <Dialog open onOpenChange={open=>{if(!open)setPaused(true);}}><DialogContent className="max-h-[100dvh] w-screen max-w-none gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none data-open:animate-none data-closed:animate-none" showCloseButton={false}>
  <DialogTitle className="sr-only">Getting started with Metis</DialogTitle><DialogDescription className="sr-only">A guide for this account on this browser or desktop. You can continue later.</DialogDescription>
  <OnboardingStage key={scope.key} transitionKey={state.phase} eyebrow={native?"Metis · This desktop":"Metis · This browser"} title={state.phase==="welcome"?"Welcome, "+username:state.phase==="device"?"Set up this desktop":"Get the app"} description={state.phase==="welcome"?"Your workspace. Your way.":state.phase==="device"?"Device access is optional. Chat works without it.":"Desktop Assistant, notifications and device access."}
   progress={<OnboardingProgress steps={steps} index={index}/>} footer={<>
    {index>0?<Button variant="ghost" onClick={()=>save({...state,phase:"welcome"})}><ArrowLeft aria-hidden="true" className="size-4"/>Back</Button>:null}
    <Button onClick={advance}>Continue<ArrowRight aria-hidden="true" className="size-4"/></Button>
   </>}>
    {storageUnavailable?<p role="status" className="mb-4 text-xs text-muted-foreground">Browser storage is unavailable. Progress is kept for this session only.</p>:null}
    {state.phase==="welcome"?<div>
     <ul className="onboarding-feature-list">
      <li><MessageSquare aria-hidden="true"/><div><strong>Chat</strong><p>Models, files and voice.</p></div></li>
      <li><Folder aria-hidden="true"/><div><strong>Projects</strong><p>Your work and context, together.</p></div></li>
      <li><Check aria-hidden="true"/><div><strong>Your choice</strong><p>Enable only what you need.</p></div></li>
     </ul>
     {!hasProvider?<p className="mt-6 text-sm text-muted-foreground">Add a provider in Settings to start chatting.</p>:null}
    </div>:state.phase==="device"&&native?<div className="grid gap-5"><Shield className="size-8" aria-hidden="true"/><p className="text-sm text-muted-foreground">Pair this device in Settings → Devices. Permissions stay under your control.</p>{onPairDevice?<label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={setupDevice} onChange={event=>setSetupDevice(event.target.checked)} className="size-4 accent-current"/>Set up computer access now</label>:null}</div>:<AppInstallOffer/>}
  </OnboardingStage>
 </DialogContent></Dialog>;
}
export function ProductTour({index,onIndex,onNavigate,onPause,onBack,onFinish}:{index:number;onIndex:(index:number)=>void;onNavigate:(target:TourTarget)=>void;onPause:()=>void;onBack:()=>void;onFinish:()=>void}){
 const item=PRODUCT_TOUR[index]||PRODUCT_TOUR[0],Icon=tourIcons[index]||MessageSquare;
 const [rect,setRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const [topAligned,setTopAligned]=useState(false);
 const [ready,setReady]=useState(false),show=useCallback(()=>setReady(true),[]);
 useEffect(()=>{
  let frame=0,observer:ResizeObserver|undefined;
  const measure=()=>{
   frame=0;const elements=Array.from(document.querySelectorAll<HTMLElement>('[data-onboarding-target="'+item.id+'"]'));
   const element=elements.find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
   if(!element){setRect(null);setTopAligned(false);return;}
   const r=element.getBoundingClientRect();setTopAligned(r.top+r.height/2>innerHeight/2);setRect({left:Math.max(2,r.left-4),top:Math.max(2,r.top-4),width:Math.min(innerWidth-4,r.width+8),height:Math.min(innerHeight-4,r.height+8)});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observe=()=>{observer?.disconnect();observer=new ResizeObserver(schedule);document.querySelectorAll('[data-onboarding-target="'+item.id+'"]').forEach(el=>observer!.observe(el));schedule();};
  const mutations=new MutationObserver(observe);mutations.observe(document.body,{childList:true,subtree:true});
  observe();addEventListener("resize",schedule);addEventListener("scroll",schedule,true);
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onPause();}};
  addEventListener("keydown",escape,true);
  return ()=>{cancelAnimationFrame(frame);observer?.disconnect();mutations.disconnect();removeEventListener("resize",schedule);removeEventListener("scroll",schedule,true);removeEventListener("keydown",escape,true);};
 },[item.id,onPause]);
 return <><div className="onboarding-tour-highlight" aria-hidden="true" style={rect?rect:{display:"none"}}/>
  <section className="onboarding-tour" style={topAligned?{top:16,bottom:"auto"}:undefined} role="region" aria-label="Metis product tour"><OnboardingMotion onReady={show}/><OnboardingTransition step={item.id} ready={ready}>
   <p className="onboarding-eyebrow">Getting started · {index+1} of {PRODUCT_TOUR.length}</p><Icon className="mb-3 size-5 text-primary"/>
   <h2 aria-live="polite" tabIndex={-1} data-onboarding-heading>{item.label}</h2><p>{item.description}</p>
   <div className="mt-5 flex items-center justify-between gap-3">
    <Button variant="ghost" onClick={()=>{if(index===0)onBack();else{onNavigate(PRODUCT_TOUR[index-1].id);onIndex(index-1);}}}><ArrowLeft className="size-4" aria-hidden="true"/>Back</Button>
    <Button onClick={()=>{if(index===PRODUCT_TOUR.length-1)onFinish();else{onNavigate(PRODUCT_TOUR[index+1].id);onIndex(index+1);}}}>Continue<ArrowRight className="size-4" aria-hidden="true"/></Button>
   </div>
  </OnboardingTransition></section></>;
}
