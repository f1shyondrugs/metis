"use client";
import { useEffect, useState } from "react";
import { desktopBridge, type LocalDeviceState } from "@/lib/desktop-bridge";
import { DesktopDeviceSettings } from "@/components/desktop-device-settings";
import { Button } from "@/components/ui/button";

export function DesktopClientSettings() {
  const [state,setState]=useState<LocalDeviceState|null>(null);
  const [error,setError]=useState("");
  const [revision,retry]=useState(0);
  useEffect(()=>{
    let live=true;
    const read=async()=>{
      try {
        const bridge=desktopBridge();
        if(!bridge?.deviceState) throw new Error("Update the desktop app to view its local settings.");
        const value=await bridge.deviceState();
        if(live){setState(value);setError("");}
      }catch(cause){if(live)setError(cause instanceof Error?cause.message:"Could not load local settings.");}
    };
    void read(); const timer=setInterval(()=>void read(),5000);
    return ()=>{live=false;clearInterval(timer);};
  },[revision]);
  return <section className="flex flex-col gap-5 p-4 sm:p-8" aria-label="Remote Client">
    <div><h2 className="text-sm font-medium">Remote Client</h2><p className="mt-1 text-xs text-muted-foreground">This desktop app’s device connection and assistant.</p></div>
    {error?<div role="alert" className="text-sm">{error}<Button variant="outline" className="ml-3" onClick={()=>retry(value=>value+1)}>Retry</Button></div>:null}
    {!state&&!error?<p role="status" className="text-sm">Loading local settings…</p>:null}
    {state?<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Connection</dt><dd>{state.paired?state.connection||"Unknown":"Not paired"}</dd>
      <dt className="text-muted-foreground">Access</dt><dd>{state.permissionMode||"Not paired"}</dd>
      <dt className="text-muted-foreground">App version</dt><dd>{state.version||"Unknown"}</dd>
      <dt className="text-muted-foreground">Assistant</dt><dd>{state.assistant?.hotkey||"Update the desktop app"}{state.assistant?.error?<p className="mt-1 text-xs" role="alert">{state.assistant.error}</p>:null}</dd>
    </dl>:null}
    <DesktopDeviceSettings />
    {state?.assistant?<div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">Desktop Assistant</h3>
      <p className="my-2 max-w-lg text-xs text-muted-foreground">Hold Ctrl+Shift+Space to speak. Release to finish, or hold for three seconds to lock recording. Press Escape to dismiss. Voice uses your Voice & dictionary settings. Each message includes fresh screenshots of all monitors and this device’s identity.</p>
      <Button variant="outline" onClick={()=>void desktopBridge()?.openAssistant?.().catch(()=>setError("Could not open the assistant. Try again."))}>Open Desktop Assistant</Button>
    </div>:null}
  </section>;
}
