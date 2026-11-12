"use client";
import {Fragment,useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {mountOnboardingMotion,ONBOARDING_TIMING} from "@/public/metis-onboarding-motion.js";
import {useReducedMotion} from "@/components/use-chart-motion";
import "./onboarding.css";
export function OnboardingMotion({onReady}:{onReady?:()=>void}={}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=host.current;if(!node)return;const ready=()=>onReady?.();node.addEventListener("metis:onboarding-ready",ready);const dispose=mountOnboardingMotion(node);return()=>{node.removeEventListener("metis:onboarding-ready",ready);dispose();};},[onReady]);
 return <div className="onboarding-motion" ref={host} aria-hidden="true"/>;
}
/** Painting state only; progress, forms, authentication and navigation remain with their owners. */
export function OnboardingTransition({step,ready=true,className="",children}:{step:string;ready?:boolean;className?:string;children:ReactNode}){
 const reduced=useReducedMotion(),node=useRef<HTMLDivElement>(null),latest=useRef({step,children}),last=useRef(children),focusAfter=useRef(false),wasReady=useRef(ready);
 latest.current={step,children};
 const [shown,setShown]=useState(step),[phase,setPhase]=useState<"in"|"out"|"idle">(ready?"in":"idle");
 useLayoutEffect(()=>{if(shown===step)last.current=children;},[shown,step,children]);
 useLayoutEffect(()=>{
  if(reduced||!ready){setShown(step);setPhase("idle");return;}
  if(shown===step)return;
  focusAfter.current=!!node.current?.contains(document.activeElement);setPhase("out");
  const timer=setTimeout(()=>{setShown(latest.current.step);setPhase("in");},ONBOARDING_TIMING.sceneExit);
  return()=>clearTimeout(timer);
 },[step,shown,reduced,ready]);
 useLayoutEffect(()=>{if(ready&&!wasReady.current&&!reduced)setPhase("in");wasReady.current=ready;},[ready,reduced]);
 useEffect(()=>{if(phase!=="in"||reduced)return;const timer=setTimeout(()=>setPhase("idle"),ONBOARDING_TIMING.sceneEnter);return()=>clearTimeout(timer);},[phase,reduced,shown]);
 useLayoutEffect(()=>{if(phase==="in"&&focusAfter.current){focusAfter.current=false;if(document.activeElement===document.body)node.current?.querySelector<HTMLElement>("[data-onboarding-heading]")?.focus({preventScroll:true});}},[shown,phase]);
 const blocked=phase==="out";
 return <div ref={node} className={"onboarding-transition "+className} data-phase={reduced?"idle":phase} data-step={shown} data-ready={ready} inert={blocked} aria-busy={blocked}
  onClickCapture={event=>{if(blocked){event.preventDefault();event.stopPropagation();}}}
  onSubmitCapture={event=>{if(blocked){event.preventDefault();event.stopPropagation();}}}>
  <Fragment key={shown}>{shown===step?children:last.current}</Fragment>
 </div>;
}
export function OnboardingStage({children,title,description,eyebrow="Welcome to Metis",progress,footer,transitionKey}:{children:ReactNode;title:string;description:string;eyebrow?:string;progress?:ReactNode;footer?:ReactNode;transitionKey?:string}){
 const [ready,setReady]=useState(false),show=useCallback(()=>setReady(true),[]);
 return <section className="onboarding-stage" aria-label="Metis onboarding"><OnboardingMotion onReady={show}/><OnboardingTransition step={transitionKey||title} ready={ready} className="onboarding-shell">
  <header className="onboarding-intro"><span className="metis-wordmark" role="img" aria-label="Metis"/><p className="onboarding-eyebrow">{eyebrow}</p><h1 tabIndex={-1} data-onboarding-heading>{title}</h1><p className="onboarding-description">{description}</p></header>
  <div className="onboarding-body">{children}</div>
  <footer className="onboarding-footer">{progress}<div className="onboarding-actions">{footer}</div></footer>
 </OnboardingTransition></section>;
}
export function OnboardingProgress({steps,index}:{steps:readonly {id:string;label:string}[];index:number}){
 return <ol className="onboarding-progress" aria-label={`Step ${index+1} of ${steps.length}`}>{steps.map((step,n)=><li key={step.id} aria-current={n===index?"step":undefined}><span className={n<=index?"is-reached":""}/><span className="sr-only">{step.label}{n===index?", current step":""}</span></li>)}</ol>;
}
