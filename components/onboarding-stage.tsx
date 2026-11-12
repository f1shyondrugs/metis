"use client";
import {useEffect,useRef,type ReactNode} from "react";
import {mountOnboardingMotion} from "@/public/metis-onboarding-motion.js";
import "./onboarding.css";
export function OnboardingMotion(){const host=useRef<HTMLDivElement>(null);useEffect(()=>{if(host.current)return mountOnboardingMotion(host.current);},[]);return <div className="onboarding-motion" ref={host} aria-hidden="true"/>;}
export function OnboardingStage({children,title,description,eyebrow="Welcome to Metis",progress,footer}:{children:ReactNode;title:string;description:string;eyebrow?:string;progress?:ReactNode;footer?:ReactNode}){
 return <section className="onboarding-stage" aria-label="Metis onboarding"><OnboardingMotion/><div className="onboarding-shell">
  <header className="onboarding-intro"><span className="metis-wordmark" role="img" aria-label="Metis"/><p className="onboarding-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="onboarding-description">{description}</p></header>
  <div className="onboarding-body">{children}</div>
  <footer className="onboarding-footer">{progress}<div className="onboarding-actions">{footer}</div></footer>
 </div></section>;
}
export function OnboardingProgress({steps,index}:{steps:readonly {id:string;label:string}[];index:number}){
 return <ol className="onboarding-progress" aria-label={`Step ${index+1} of ${steps.length}`}>{steps.map((step,n)=><li key={step.id} aria-current={n===index?"step":undefined}><span className={n<=index?"is-reached":""}/><span className="sr-only">{step.label}{n===index?", current step":""}</span></li>)}</ol>;
}
