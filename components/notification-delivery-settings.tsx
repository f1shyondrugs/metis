"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NotificationSettingsFeedback } from "@/components/remote-notification-settings";
import type { NotificationSettingsState } from "@/hooks/use-notification-settings";
export function NotificationDeliverySettings({settings,onOpenDevices}:{settings:NotificationSettingsState;onOpenDevices:()=>void}) {
  const {prefs,busy,save}=settings;
  const [sending,setSending]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [title,setTitle]=useState("Metis"),[body,setBody]=useState("This is a test notification from Metis.");
  async function send(){
    if(sending||busy||!title.trim())return;setSending(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body})});const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error||"Could not send notification. Try again.");
      if(!data?.notification)throw new Error("Could not confirm the notification. Check your delivery devices below before sending again.");
      const status=data.delivery?.status;
      setNotice(status==="disabled"?"App notifications are off. Enable them above.":status==="no_devices"?"Select a delivery device below first.":status==="delivered"?"Notification delivered.":status==="queued"?"Notification queued for your selected devices.":"Notification saved. Check your delivery devices below.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not send notification.")}
    finally{setSending(false)}
  }
  return <div className="space-y-4" aria-label="Notification delivery">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0">
      <label htmlFor="notification-agent-finished" className="cursor-pointer text-sm font-medium">Notifications when agent finishes</label>
      <p id="notification-agent-finished-help" className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">Requires a connected Metis desktop app. Receive a native alert when a task is complete, even with your browser closed.</p>
    </div><Switch id="notification-agent-finished" aria-label="Notifications when agent finishes" aria-describedby="notification-agent-finished-help" className="mt-1 shrink-0" checked={Boolean(prefs?.remoteEnabled&&prefs.agentFinishedEnabled)} disabled={!prefs||busy} onCheckedChange={enabled=>void save(enabled?{agentFinishedEnabled:true,remoteEnabled:true}:{agentFinishedEnabled:false})}/></div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 text-xs text-muted-foreground">{!prefs?"Choose which devices receive alerts.":!prefs.remoteEnabled?"App notifications are off.":!prefs.remoteClientIds.length?"No device selected.":prefs.remoteClientIds.length+" device"+(prefs.remoteClientIds.length===1?"":"s")+" selected."}</p>
      <Button type="button" size="sm" variant="outline" onClick={onOpenDevices}>Manage Remote Devices</Button>
    </div>
    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3"><div className="min-w-0"><label htmlFor="notification-toast" className="cursor-pointer text-sm">In-app toasts</label><p className="mt-1 text-xs text-muted-foreground">Messages inside the Metis workspace.</p></div><Switch id="notification-toast" aria-label="In-app toasts" className="shrink-0" checked={prefs?.toastEnabled??false} disabled={!prefs||busy} onCheckedChange={toastEnabled=>void save({toastEnabled})}/></div>
    <NotificationSettingsFeedback settings={settings}/>
    <details className="border-t border-border/60 pt-3"><summary className="min-h-9 cursor-pointer text-xs">Send a custom notification</summary><div className="mt-2 space-y-2">
      <label htmlFor="custom-notification-title" className="block text-xs">Title</label><Input id="custom-notification-title" maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/>
      <label htmlFor="custom-notification-body" className="block text-xs">Message</label><Input id="custom-notification-body" maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/>
      <Button disabled={sending||busy||!title.trim()} onClick={()=>void send()}>{sending?"Sending…":"Send notification"}</Button>
      {error?<p role="alert" className="text-xs text-destructive">{error}</p>:null}{notice?<p role="status" className="text-xs text-muted-foreground">{notice}</p>:null}
    </div></details>
  </div>;
}
