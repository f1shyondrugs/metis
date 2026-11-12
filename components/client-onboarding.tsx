"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,Check,MessageSquare,Folder,NotebookPen,Monitor,Settings,Puzzle,Play} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {OnboardingStage,OnboardingMotion,OnboardingProgress} from "@/components/onboarding-stage";
import {AppInstallOffer} from "@/components/app-install-offer";
import {DesktopClientSettings} from "@/components/desktop-client-settings";
import {desktopBridge} from "@/lib/desktop-bridge";
import {onboardingStorageKey,parseOnboardingState,PRODUCT_TOUR,type ClientOnboardingState,type TourTarget} from "@/lib/client-onboarding";
const sessionProgress=new Map<string,ClientOnboardingState>();
const tourIcons=[MessageSquare,Folder,NotebookPen,Monitor,Puzzle,Settings];
export function ClientOnboarding({userId,username,onNavigate,onConnectProvider,hasProvider}:{userId:string;username:string;onNavigate:(target:TourTarget)=>void;onConnectProvider:()=>void;hasProvider:boolean}){
 const [scope,setScope]=useState<{key:string;native:boolean;userId:string}|null>(null),[state,setState]=useState<ClientOnboardingState|null>(null);
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
 if(state.phase==="tour")return <ProductTour index={state.tourIndex} onNavigate={onNavigate} onPause={()=>setPaused(true)} onIndex={index=>save({...state,tourIndex:index})} onFinish={finish}/>;
 const native=scope.native;
 const steps=native?[{id:"welcome",label:"Welcome"},{id:"device",label:"This device"}]:[{id:"welcome",label:"Welcome"},{id:"app",label:"Get the app"}];
 const index=state.phase==="welcome"?0:1;
 const next=()=>save({...state,phase:native?"device":"app"});
 const beginTour=()=>save({...state,phase:"tour",tourIndex:0});
 return <Dialog open onOpenChange={open=>{if(!open)setPaused(true);}}><DialogContent className="max-h-[100dvh] w-screen max-w-none gap-0 overflow-y-auto rounded-none border-0 p-0 sm:max-w-none data-open:animate-none data-closed:animate-none" showCloseButton={false}>
  <DialogTitle className="sr-only">Getting started with Metis</DialogTitle><DialogDescription className="sr-only">A guide for this account on this browser or desktop. You can continue later.</DialogDescription>
  <OnboardingStage key={scope.key+state.phase} eyebrow={native?"Metis · This desktop":"Metis · This browser"} title={state.phase==="welcome"?"Welcome, "+username:state.phase==="device"?"Make this desktop yours":"Take Metis with you"} description={state.phase==="welcome"?"A few steps to get started, then a short look around your workspace. You can pause at any time.":state.phase==="device"?"You are signed in. Device pairing and system access are separate choices: configure them if you want Metis to work on this computer, or continue with chat only.":"Add local device access, notifications and the Desktop Assistant — or keep using the full workspace in your browser."}
   progress={<OnboardingProgress steps={steps} index={index}/>} footer={<>
    {index>0?<Button variant="ghost" onClick={()=>save({...state,phase:"welcome"})}><ArrowLeft className="size-4"/>Back</Button>:null}
    <Button variant="ghost" onClick={()=>setPaused(true)}>Continue later</Button>
    {state.phase==="welcome"?<Button onClick={next}>Continue<ArrowRight className="size-4"/></Button>:<><Button variant="outline" onClick={finish}>{native?"Use Metis":"Skip tour"}</Button><Button onClick={beginTour}><Play className="size-4"/>Show me around</Button></>}
   </>}>
    {storageUnavailable?<p role="status" className="mb-4 text-xs text-muted-foreground">Browser storage is unavailable. Progress is kept for this session only.</p>:null}
    {state.phase==="welcome"?<div>
     <ul className="onboarding-feature-list">
      <li><MessageSquare/><div><strong>Start with a conversation</strong><p>Models, files, voice and tools in one place. You decide what Metis can do.</p></div></li>
      <li><Folder/><div><strong>Keep context with your work</strong><p>Projects, memories and Notebooks keep related work together.</p></div></li>
      <li><Check/><div><strong>Only configure what you need</strong><p>Chat does not require screen recording or computer-control permissions.</p></div></li>
     </ul>
     {!hasProvider?<div className="mt-6 border-t border-border pt-4"><p className="mb-3 text-sm text-muted-foreground">No enabled provider is connected yet. Connect one to run your first conversation.</p><Button variant="outline" onClick={onConnectProvider}>Connect a model provider</Button></div>:<p className="mt-6 text-sm text-muted-foreground">A provider is configured. Available models appear in the chat model picker.</p>}
    </div>:state.phase==="device"&&native?<DesktopClientSettings/>:<AppInstallOffer/>}
  </OnboardingStage>
 </DialogContent></Dialog>;
}
export function ProductTour({index,onIndex,onNavigate,onPause,onFinish}:{index:number;onIndex:(index:number)=>void;onNavigate:(target:TourTarget)=>void;onPause:()=>void;onFinish:()=>void}){
 const item=PRODUCT_TOUR[index]||PRODUCT_TOUR[0],Icon=tourIcons[index]||MessageSquare;
 const [rect,setRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 useEffect(()=>{
  let frame=0,observer:ResizeObserver|undefined;
  const measure=()=>{
   frame=0;const elements=Array.from(document.querySelectorAll<HTMLElement>('[data-onboarding-target="'+item.id+'"]'));
   const element=elements.find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
   if(!element){setRect(null);return;}
   const r=element.getBoundingClientRect();setRect({left:Math.max(2,r.left-4),top:Math.max(2,r.top-4),width:Math.min(innerWidth-4,r.width+8),height:Math.min(innerHeight-4,r.height+8)});
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
  <section className="onboarding-tour" role="region" aria-label="Metis product tour"><OnboardingMotion/>
   <p className="onboarding-eyebrow">Getting started · {index+1} of {PRODUCT_TOUR.length}</p><Icon className="mb-3 size-5 text-primary"/>
   <h2 aria-live="polite" tabIndex={-1}>{item.label}</h2><p>{item.description}</p>
   <Button className="mt-4" variant="outline" onClick={()=>onNavigate(item.id)}>{item.action}<ArrowRight className="size-4"/></Button>
   <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
    <Button variant="ghost" onClick={onPause}>Continue later</Button><div className="flex gap-2">{index>0?<Button variant="ghost" onClick={()=>onIndex(index-1)} aria-label="Previous tour step"><ArrowLeft className="size-4"/></Button>:null}<Button onClick={()=>index===PRODUCT_TOUR.length-1?onFinish():onIndex(index+1)}>{index===PRODUCT_TOUR.length-1?"Finish":"Next"}<ArrowRight className="size-4"/></Button></div>
   </div><p className="mt-3 text-xs">You can restart this guide from your account menu.</p>
  </section></>;
}
