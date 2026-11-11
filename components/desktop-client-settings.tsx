"use client";
import { useState } from "react";
import { desktopBridge } from "@/lib/desktop-bridge";
import { refreshDesktopState, useDesktopState } from "@/lib/use-desktop-state";
import { DesktopShortcutSettings } from "@/components/desktop-shortcut-settings";
import { DesktopDeviceSettings } from "@/components/desktop-device-settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function DesktopClientSettings() {
  const {state,error:loadError}=useDesktopState();
  const [error,setError]=useState(""),[busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  async function save(key:string,action:()=>Promise<unknown>) {
    if(busy)return;
    setBusy(key);setError("");setMessage("");
    try { const result=await action();if(typeof result==="string")setMessage(result);await refreshDesktopState(true); }
    catch(cause){setError(cause instanceof Error?cause.message:"Could not save app settings.");}
    finally{setBusy("");}
  }
  const bridge=desktopBridge();
  return <section className="flex min-w-0 flex-col gap-5 p-4 sm:p-6" aria-label="Client settings">
    {loadError||error?<div role="alert" className="text-sm text-destructive">{error||loadError}<Button variant="outline" className="ml-3" onClick={()=>void refreshDesktopState()}>Retry</Button></div>:null}
    {!state&&!loadError?<p role="status" className="text-sm">Loading app settings…</p>:null}
    {state?<><dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Connection</dt><dd className="min-w-0 break-words">{state.paired?state.connection||"Unknown":"Not paired"}</dd>
      <dt className="text-muted-foreground">Access</dt><dd>{state.permissionMode||"Not paired"}</dd>
      <dt className="text-muted-foreground">App version</dt><dd>{state.version||"Unknown"}</dd>
    </dl>
    <section className="border-t border-border pt-4" aria-label="App updates">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">App updates</h3>
        <Button variant="outline" size="action" disabled={Boolean(busy)||!bridge?.checkUpdates} onClick={()=>void save("updates",()=>bridge!.checkUpdates!())}>{busy==="updates"?"Checking…":"Check for updates"}</Button></div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">{state.appUpdate?.available?<span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-hidden="true"/>:null}{message||state.appUpdate?.message||"No update check yet."}{state.appUpdate?.available&&state.appUpdate.version?" · "+state.appUpdate.version:""}</p>
      {state.appUpdate?.phase==="ready"?<p className="mt-1 text-xs text-muted-foreground">The update installs when you fully quit and restart Metis. Closing the window keeps Metis running.</p>:null}
    </section>
    <section className="border-t border-border pt-4" aria-label="Local preferences">
      <div className="flex min-h-11 items-center justify-between gap-6 py-2">
        <div><label htmlFor="client-streams" className="text-sm font-medium">Show overlays in streams and recordings</label><p id="client-streams-help" className="mt-1 max-w-md text-xs text-muted-foreground">Applies to the assistant, voice border and computer-use overlay. Share your entire screen to include them; a single-app stream may omit other windows.</p></div>
        <Switch className="after:-inset-y-3.5" id="client-streams" aria-describedby="client-streams-help" checked={state.hideOverlayFromCapture===false} disabled={Boolean(busy)||!bridge?.setOverlayCaptureHidden||typeof state.hideOverlayFromCapture!=="boolean"} onCheckedChange={visible=>void save("capture",()=>bridge!.setOverlayCaptureHidden!(!visible))}/>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-6 py-3">
        <div><label htmlFor="client-autostart" className="text-sm font-medium">Start at login</label><p className="mt-1 text-xs text-muted-foreground">Keep your device connected and receive notifications.</p></div>
        <Switch className="after:-inset-y-3.5" id="client-autostart" checked={state.autostartEnabled===true} disabled={Boolean(busy)||!bridge?.setAutostart||typeof state.autostartEnabled!=="boolean"} onCheckedChange={enabled=>void save("autostart",()=>bridge!.setAutostart!(enabled))}/>
      </div>
      {!bridge?.setOverlayCaptureHidden?<p className="mt-2 text-xs text-muted-foreground">Update the desktop app to edit these preferences here.</p>:null}
    </section></>:null}
    {state?.assistant?.shortcuts&&state.assistant.defaults?<DesktopShortcutSettings value={state.assistant.shortcuts} defaults={state.assistant.defaults} platform={state.platform} onSaved={()=>void refreshDesktopState()}/>:null}
    {state?.assistant?<div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">Desktop Assistant</h3>
      <p className="my-2 max-w-lg text-xs text-muted-foreground">Press Talk once to record and again to stop. Use Focus text to type. Voice uses your Voice & dictionary settings.</p>
      {state.assistant.error?<p role="alert" className="my-2 text-xs text-destructive">{state.assistant.error}</p>:null}
      <Button variant="outline" disabled={Boolean(busy)} onClick={()=>void save("assistant",()=>bridge!.openAssistant!())}>Open Desktop Assistant</Button>
    </div>:null}
    <div className="border-t border-border pt-4"><h3 className="mb-2 text-sm font-medium">Pairing and device history</h3><DesktopDeviceSettings /></div>
  </section>;
}
