"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {createAssistantSessionWriter,type AssistantSession,type AssistantSessionPatch} from "@/lib/desktop-assistant-session";
async function read(response:Response){
 const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not save the assistant.");
 return body.session as AssistantSession;
}
export function useAssistantSession(deviceId:string){
 const [session,setSession]=useState<AssistantSession|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const writer=useRef<ReturnType<typeof createAssistantSessionWriter>|null>(null),alive=useRef(false);
 const pending=useRef<AssistantSessionPatch>({}),sequence=useRef(0),requests=useRef(0);
 const load=useCallback(async()=>{
  const next=await read(await fetch("/api/desktop-assistant/session?deviceId="+encodeURIComponent(deviceId),{cache:"no-store"}));
  if(!alive.current)return next;
  const request=async(version:number,patch:AssistantSessionPatch,editQueueId?:string)=>read(await fetch("/api/desktop-assistant/session",{
   method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({deviceId,version,patch,editQueueId}),
   ...(new TextEncoder().encode(JSON.stringify(patch)).byteLength<60_000?{keepalive:true}:{}),
  }));
  if(writer.current)writer.current.reset(next);else writer.current=createAssistantSessionWriter(next,request);
  setSession(next);setError("");return next;
 },[deviceId]);
 useEffect(()=>{
  if(!deviceId)return;alive.current=true;writer.current=null;setSession(null);
  void load().catch(cause=>{if(alive.current)setError(cause.message);});
  return ()=>{alive.current=false;};
 },[deviceId,load]);
 const save=useCallback(async(patch:AssistantSessionPatch,editQueueId?:string)=>{
  if(!writer.current)throw new Error("Assistant session is still loading.");
  pending.current={...pending.current,...patch};const at=++sequence.current;requests.current++;setSaving(true);
  try{
   const next=await writer.current.save(patch,editQueueId);
   if(alive.current){setSession(next);setError("");}
   if(at===sequence.current)pending.current={};
   return next;
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"Could not save the assistant.");throw cause;}
  finally{requests.current--;if(alive.current)setSaving(requests.current>0);}
 },[]);
 const retry=useCallback(async()=>{
  try{
   await writer.current?.settle().catch(()=>{});
   await load();
   if(Object.keys(pending.current).length)await save(pending.current);
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"Could not restore the assistant.");}
 },[load,save]);
 return {session,error,saving,save,retry};
}
