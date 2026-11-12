"use client";
import { useState } from "react";
import {Shield,Link,Server} from "lucide-react";
import { desktopBridge } from "@/lib/desktop-bridge";
import { refreshDesktopState, useDesktopState } from "@/lib/use-desktop-state";
import { DesktopShortcutSettings } from "@/components/desktop-shortcut-settings";
import { DesktopDeviceSettings } from "@/components/desktop-device-settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function DesktopClientSettings({compact=false}:{compact?:boolean}={}) {
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
      {!compact?<><dt className="text-muted-foreground">App version</dt><dd>{state.version||"Unknown"}</dd></>:null}
      {!compact&&state.fileDrop?<><dt className="text-muted-foreground">File drops</dt><dd>{state.fileDrop.available?"Ready":state.fileDrop.error?"Unavailable":"Starting…"}{state.fileDrop.error?<p className="mt-1 text-xs text-destructive" role="alert">{state.fileDrop.error}</p>:null}</dd></>:null}
    </dl>
    {!compact?<section className="border-t border-border pt-4" aria-label="App updates">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-medium">App updates</h3>
        <Button variant="outline" size="action" disabled={Boolean(busy)||!bridge?.checkUpdates} onClick={()=>void save("updates",()=>bridge!.checkUpdates!())}>{busy==="updates"?"Checking…":"Check for updates"}</Button></div>
      <p role="status" className="mt-2 text-xs text-muted-foreground">{state.appUpdate?.available?<span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-hidden="true"/>:null}{message||state.appUpdate?.message||"No update check yet."}{state.appUpdate?.available&&state.appUpdate.version?" · "+state.appUpdate.version:""}</p>
      {state.appUpdate?.phase==="ready"?<p className="mt-1 text-xs text-muted-foreground">The update installs when you fully quit and restart Metis. Closing the window keeps Metis running.</p>:null}
    </section>:null}
    <section className="border-t border-border pt-4" aria-label="Local preferences">
      <div className="flex min-h-11 items-center justify-between gap-6 py-2">
        <div><label htmlFor="client-streams" className="text-sm font-medium">Show overlays in streams and recordings</label><p id="client-streams-help" className="mt-1 max-w-md text-xs text-muted-foreground">{compact?"Share your entire screen to include overlays.":"Applies to the assistant, voice border and computer-use overlay. Share your entire screen to include them; a single-app stream may omit other windows."}</p></div>
        <Switch className="after:-inset-y-3.5" id="client-streams" aria-describedby="client-streams-help" checked={state.hideOverlayFromCapture===false} disabled={Boolean(busy)||!bridge?.setOverlayCaptureHidden||typeof state.hideOverlayFromCapture!=="boolean"} onCheckedChange={visible=>void save("capture",()=>bridge!.setOverlayCaptureHidden!(!visible))}/>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-6 py-3">
        <div><label htmlFor="client-autostart" className="text-sm font-medium">Start at login</label><p className="mt-1 text-xs text-muted-foreground">Keep your device connected and receive notifications.</p></div>
        <Switch className="after:-inset-y-3.5" id="client-autostart" checked={state.autostartEnabled===true} disabled={Boolean(busy)||!bridge?.setAutostart||typeof state.autostartEnabled!=="boolean"} onCheckedChange={enabled=>void save("autostart",()=>bridge!.setAutostart!(enabled))}/>
      </div>
      {!bridge?.setOverlayCaptureHidden?<p className="mt-2 text-xs text-muted-foreground">Update the desktop app to edit these preferences here.</p>:null}
    </section></>:null}
    {!compact&&state?.assistant?.shortcuts&&state.assistant.defaults?<DesktopShortcutSettings value={state.assistant.shortcuts} defaults={state.assistant.defaults} platform={state.platform} onSaved={()=>void refreshDesktopState()}/>:null}
    {state?.assistant?<div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">Desktop Assistant</h3>
      <p className="my-2 max-w-lg text-xs text-muted-foreground">{compact?"Talk to record. Focus text to type.":"Press Talk once to record and again to stop. Use Focus text to type. Voice uses your Voice & dictionary settings."}</p>
      {state.assistant.error?<p role="alert" className="my-2 text-xs text-destructive">{state.assistant.error}</p>:null}
      <Button variant="outline" disabled={Boolean(busy)} onClick={()=>void save("assistant",()=>bridge!.openAssistant!())}>Open Desktop Assistant</Button>
    </div>:null}
    {bridge?.requestDesktopPermissions?<div className="border-t border-border pt-4"><h3 className="flex items-center gap-2 text-sm font-medium"><Shield aria-hidden="true" className="size-4"/>Computer-control permissions</h3><p className="my-2 text-xs text-muted-foreground">{state?.desktopAvailable?"Available on this device.":state?.desktopReason||"Review the system permissions needed for desktop control. Chat works without them."}</p><Button variant="outline" disabled={Boolean(busy)} onClick={()=>void save("permissions",()=>bridge.requestDesktopPermissions!())}>Review system permissions</Button></div>:null}
    {bridge?.openServerSettings?<div className="border-t border-border pt-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Server aria-hidden="true" className="size-4"/>Server connection</h3><Button variant="outline" onClick={()=>void save("server",()=>bridge.openServerSettings!())}>Change server address</Button>{!compact?<p className="mt-2 text-xs text-muted-foreground">Sign in to that server with your Metis account. A new server opens its first-time setup automatically.</p>:null}</div>:null}
    <div className="border-t border-border pt-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Link aria-hidden="true" className="size-4"/>Pairing and device history</h3><p className="mb-3 text-xs text-muted-foreground">{compact?"Enter your pairing code in local device settings. Sign-in alone does not grant access.":"To allow device tools, create a pairing code in Settings → Devices → Remote Clients and enter it in the local device settings. Web sign-in alone does not grant computer access."}</p><DesktopDeviceSettings /></div>
  </section>;
}
