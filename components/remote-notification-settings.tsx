"use client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NotificationSettingsState } from "@/hooks/use-notification-settings";
export function NotificationSettingsFeedback({settings}:{settings:NotificationSettingsState}) {
  return <>{!settings.prefs&&!settings.error?<p role="status" className="text-xs text-muted-foreground">Loading notification settings…</p>:null}
    {settings.error?<div className="flex flex-wrap items-center gap-2"><p role="alert" className="min-w-0 flex-1 text-xs text-destructive">{settings.error}</p><Button size="sm" variant="outline" onClick={()=>void settings.reload()}>Retry</Button></div>:null}
    {settings.notice?<p role="status" aria-live="polite" className="text-xs text-muted-foreground">{settings.notice}</p>:null}</>;
}
export function RemoteNotificationSettings({settings,showFeedback=true}:{settings:NotificationSettingsState;showFeedback?:boolean}) {
  const {prefs,busy,save}=settings;
  return <section aria-labelledby="remote-notifications-heading" className="space-y-3">
    <div className="flex items-start justify-between gap-4"><div className="min-w-0">
      <h4 id="remote-notifications-heading" className="text-sm font-medium">Metis app notifications</h4>
      <p id="remote-notifications-description" className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">Native alerts for completed tasks and messages from your agent. Requires the Metis desktop app running on a selected device.</p>
    </div><Switch id="remote-notifications-global" aria-label="Metis app notifications" aria-describedby="remote-notifications-description" className="mt-1 shrink-0" checked={prefs?.remoteEnabled??false} disabled={!prefs||busy} onCheckedChange={remoteEnabled=>void save({remoteEnabled})}/></div>
    {prefs?<p className="text-xs text-muted-foreground">{prefs.remoteEnabled ? prefs.remoteClientIds.length ? "Choose below which devices receive alerts. Offline devices receive pending alerts when they reconnect." : "Select a device below to receive notifications." : "All Metis app notifications are off. Your device selection is kept."}</p>:null}
    {showFeedback?<NotificationSettingsFeedback settings={settings}/>:null}
  </section>;
}
export function RemoteDeviceNotificationSwitch({settings,clientId,clientName}:{settings:NotificationSettingsState;clientId:string;clientName:string}) {
  const client=settings.clients.find(item=>item.id===clientId),selected=settings.prefs?.remoteClientIds.includes(clientId)??false;
  const unavailable=client?.status==="revoked"||!client;
  const unsupported=client?.status==="online"&&client.nativeNotifications!==true;
  const note=unavailable?"Notification availability is unknown."
    :unsupported?"Connect an updated Metis desktop app to receive native alerts."
    :!settings.prefs?.remoteEnabled?"Paused by the global notification switch."
    :client.status==="offline"?"Offline · pending alerts arrive after reconnecting."
    :selected?"Native notifications enabled on this device.":"Notifications are off on this device.";
  return <div className="mt-3 flex items-center justify-between gap-4 border-t border-border/60 pt-3">
    <div className="min-w-0"><label htmlFor={"notify-device-"+clientId} className="cursor-pointer text-xs font-medium">Notifications</label><p id={"notify-device-help-"+clientId} className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p></div>
    <Switch id={"notify-device-"+clientId} aria-label={"Notifications on "+clientName} aria-describedby={"notify-device-help-"+clientId} checked={selected} className="shrink-0" disabled={!settings.prefs||settings.busy||unavailable||(unsupported&&!selected)} onCheckedChange={enabled=>void settings.save({remoteClient:{id:clientId,enabled}})}/>
  </div>;
}
