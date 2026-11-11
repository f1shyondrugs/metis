"use client";
import { useSyncExternalStore } from "react";
import { desktopBridge, type LocalDeviceState } from "@/lib/desktop-bridge";

type Snapshot = { state: LocalDeviceState | null; error: string };
const empty:Snapshot = {state:null,error:""};
let snapshot = empty, timer:ReturnType<typeof setInterval>|undefined;
let pending:Promise<void>|undefined, epoch=0;
const listeners=new Set<()=>void>();
const publish=(next:Snapshot)=>{snapshot=next;for(const listener of listeners)listener();};
export function refreshDesktopState(force=false):Promise<void> {
  if(pending)return force?pending.then(()=>refreshDesktopState()):pending;
  const generation=epoch;
  pending=(async()=>{
    try {
      const bridge=desktopBridge();
      if(!bridge?.deviceState)throw Error("Update the desktop app to view its local settings.");
      const state=await bridge.deviceState();
      if(generation===epoch)publish({state,error:""});
    }catch(cause){if(generation===epoch)publish({state:snapshot.state,error:cause instanceof Error?cause.message:"Could not load local settings."});}
  })().finally(()=>{pending=undefined;});
  return pending;
}
function subscribe(listener:()=>void) {
  listeners.add(listener);
  if(listeners.size===1&&desktopBridge()){
    void refreshDesktopState();
    timer=setInterval(()=>void refreshDesktopState(),5000);
  }
  return ()=>{
    listeners.delete(listener);
    if(!listeners.size){clearInterval(timer);timer=undefined;epoch++;}
  };
}
export function useDesktopState() {
  return useSyncExternalStore(subscribe,()=>snapshot,()=>empty);
}
