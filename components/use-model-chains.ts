"use client";
import {useCallback,useEffect,useState} from "react";
import type {ModelChain} from "@/lib/model-chain-types";
export const MODEL_CHAINS_CHANGED="ai-chat:model-chains-changed";
export function notifyModelChainsChanged(){window.dispatchEvent(new Event(MODEL_CHAINS_CHANGED));}
export function useModelChains(enabled=true){
 const [chains,setChains]=useState<ModelChain[]>([]),[loading,setLoading]=useState(enabled),[error,setError]=useState("");
 const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{window.addEventListener(MODEL_CHAINS_CHANGED,refresh);return()=>window.removeEventListener(MODEL_CHAINS_CHANGED,refresh);},[refresh]);
 useEffect(()=>{
  if(!enabled){setChains([]);setLoading(false);return;}
  const controller=new AbortController();setLoading(true);setError("");
  void fetch("/api/model-chains",{cache:"no-store",signal:controller.signal}).then(async r=>{
   const data=await r.json();if(!r.ok)throw Error(data.error||"Could not load model chains.");
   if(!controller.signal.aborted)setChains(data.chains||[]);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[enabled,revision]);
 return {chains,loading,error,refresh};
}
export function useChatModelChain(enabled:boolean,chatId:string|null,modelId:string){
 const [saved,setSaved]=useState<{chatId:string;chain:ModelChain|null}|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState("");
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{window.addEventListener(MODEL_CHAINS_CHANGED,refresh);return()=>window.removeEventListener(MODEL_CHAINS_CHANGED,refresh);},[refresh]);
 useEffect(()=>{
  if(!enabled||!chatId){setSaved(null);setError("");return;}
  const controller=new AbortController();setError("");
  void fetch("/api/chats/"+encodeURIComponent(chatId)+"/model-chain",{cache:"no-store",signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error("Could not load chain selection.");return r.json();})
   .then(data=>{if(!controller.signal.aborted)setSaved({chatId,chain:data.chain||null});})
   .catch(()=>{if(!controller.signal.aborted)setError("Could not load the selected model chain.");});
  return()=>controller.abort();
 },[enabled,chatId,modelId,revision]);
 return {chain:saved?.chatId===chatId?saved.chain:null,error,refresh};
}
