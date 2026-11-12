"use client";
import {useEffect,useState} from "react";
import {useReducedMotion} from "@/components/use-chart-motion";
import type {TourTarget} from "@/lib/client-onboarding";

import type {TourRect as TargetRect} from "@/lib/tour-placement";
/** Presentation only: the real target keeps its own pointer, keyboard and permission behavior. */
export function OnboardingTarget({target,enabled,onPlacement}:{target:TourTarget;enabled:boolean;onPlacement:(rect:TargetRect|null)=>void}){
 const reduced=useReducedMotion();
 const [rect,setRect]=useState<TargetRect|null>(null),[engaged,setEngaged]=useState(false);
 useEffect(()=>{
  if(!enabled){setRect(null);setEngaged(false);onPlacement(null);return;}
  let frame=0,selected:HTMLElement|undefined,detach=()=>{},hovered=false,focused=false;
  const updateInteraction=()=>setEngaged(hovered||focused);
  const measure=()=>{
   frame=0;
   const elements=Array.from(document.querySelectorAll<HTMLElement>('[data-onboarding-target="'+target+'"]'));
   const element=elements.find(el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    return !el.closest('[hidden],[inert],[aria-hidden="true"]')&&style.visibility!=="hidden"&&style.visibility!=="collapse"&&
     r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
   });
   if(element!==selected){
    detach();selected=element;hovered=false;focused=!!element?.contains(document.activeElement);updateInteraction();
    if(element){
     const enter=()=>{hovered=true;updateInteraction();},leave=()=>{hovered=false;updateInteraction();};
     const focus=()=>{focused=true;updateInteraction();};
     const blur=(event:FocusEvent)=>{focused=event.relatedTarget instanceof Node&&element.contains(event.relatedTarget);updateInteraction();};
     element.addEventListener("pointerenter",enter);element.addEventListener("pointerleave",leave);
     element.addEventListener("focusin",focus);element.addEventListener("focusout",blur);
     detach=()=>{element.removeEventListener("pointerenter",enter);element.removeEventListener("pointerleave",leave);element.removeEventListener("focusin",focus);element.removeEventListener("focusout",blur);};
    }else detach=()=>{};
   }
   if(!element){setRect(null);onPlacement(null);return;}
   const r=element.getBoundingClientRect(),left=Math.max(2,r.left-4),top=Math.max(2,r.top-4);
   const next={left,top,width:Math.max(0,Math.min(innerWidth-2,r.right+4)-left),height:Math.max(0,Math.min(innerHeight-2,r.bottom+4)-top)};
   onPlacement(next);
   setRect(old=>old&&Object.keys(next).every(key=>old[key as keyof TargetRect]===next[key as keyof TargetRect])?old:next);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);
  const observe=()=>{observer.disconnect();document.querySelectorAll('[data-onboarding-target="'+target+'"]').forEach(el=>observer.observe(el));schedule();};
  const mutations=new MutationObserver(records=>{
   if(records.some(record=>!(record.target instanceof Element&&record.target.closest(".onboarding-tour,.onboarding-tour-highlight"))))observe();
  });
  mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["data-onboarding-target","class","style","hidden","inert","aria-hidden"]});
  observe();addEventListener("resize",schedule);addEventListener("scroll",schedule,true);
  return()=>{cancelAnimationFrame(frame);detach();observer.disconnect();mutations.disconnect();};
 },[target,enabled,onPlacement]);
 return <div key={target} className="onboarding-tour-highlight" data-target={target} data-engaged={engaged} data-reduced-motion={reduced} aria-hidden="true" style={enabled&&rect?rect:{display:"none"}}/>;
}
