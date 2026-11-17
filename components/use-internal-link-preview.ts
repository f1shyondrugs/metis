"use client";
import {useCallback,useEffect,useState} from "react";
import {deviceCalendarTimeZone} from "@/lib/calendar/time-zone";
import type {InternalLinkTarget,InternalLinkPreview} from "@/lib/internal-link";
export function useInternalLinkPreview(target:InternalLinkTarget,chatId:string|null,enabled=true){
 const key=JSON.stringify([target.kind,target.id,chatId]);
 const[state,setState]=useState<{key:string;preview:InternalLinkPreview|null;status:"loading"|"ready"|"error"}|null>(null);
 const[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  const params=new URLSearchParams({kind:target.kind,id:target.id});
  if(chatId)params.set("chatId",chatId);
  if(target.kind==="calendar-event")params.set("timeZone",deviceCalendarTimeZone().zone);
  let current=true;
  setState({key,preview:null,status:"loading"});
  fetch("/api/internal-link-preview?"+params,{signal:controller.signal,cache:"no-store"})
   .then(async r=>{if(!r.ok)throw Error("Preview unavailable");return r.json() as Promise<InternalLinkPreview>;})
   .then(preview=>{if(current)setState({key,preview,status:"ready"});})
   .catch(()=>{if(current)setState({key,preview:null,status:"error"});}).finally(()=>clearTimeout(timer));
  return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[key,target.kind,target.id,chatId,enabled,revision]);
 const retry=useCallback(()=>setRevision(v=>v+1),[]);
 return{preview:enabled&&state?.key===key?state.preview:null,state:enabled&&state?.key===key?state.status:"loading" as const,retry};
}
