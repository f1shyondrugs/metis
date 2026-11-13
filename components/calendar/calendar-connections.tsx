"use client";
import {useEffect,useRef,useState} from "react";
import {Link,RefreshCw,Check,TriangleAlert} from "lucide-react";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ConfirmDialog} from "@/components/confirm-dialog";
import type {CalendarConnection} from "@/lib/calendar/types";
export async function calendarAction(body:unknown){
 const response=await fetch("/api/calendar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||"Calendar request failed.");return data;
}
export function CalendarConnections({connections,googleOAuth,onClose,onChanged}:{connections:CalendarConnection[];googleOAuth:{configured:boolean;redirectUri:string};onClose:()=>void;onChanged:()=>void}){
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[icloud,setIcloud]=useState(false),[advanced,setAdvanced]=useState(false),[disconnect,setDisconnect]=useState<CalendarConnection|null>(null);
 const pending=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function act(key:string,body:unknown){if(pending.current)return;pending.current=true;setBusy(key);setError("");try{const r=await calendarAction(body);if(!mounted.current)return;onChanged();if(r.url){const u=new URL(r.url);if(u.protocol!=="https:"||u.hostname!=="accounts.google.com")throw Error("Invalid authorization destination.");window.location.assign(u.href);}return r;}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Could not connect.");}finally{pending.current=false;if(mounted.current)setBusy("");}}
 return <><Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" closeButtonDisabled={!!busy}>
  <DialogHeader><DialogTitle>Calendar connections</DialogTitle><DialogDescription>Same calendar names stay in sync. Missing writable counterparts are created automatically. Read-only calendars are displayed separately.</DialogDescription></DialogHeader>
  <div className="space-y-4">
   {(["icloud","google"] as const).map(provider=>{const c=connections.find(v=>v.provider===provider),name=provider==="icloud"?"iCloud":"Google";return <section key={provider} className="space-y-2 border-b border-border pb-4 last:border-0">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{name}</h3>{c?.enabled?<Button variant="ghost" size="action" disabled={!!busy} onClick={()=>setDisconnect(c)}>Disconnect</Button>:null}</div>
    <p className="flex items-center gap-2 text-xs text-muted-foreground">{c?.enabled&&c.status==="ready"?<Check className="size-3.5"/>:c?.error?<TriangleAlert className="size-3.5"/>:<Link className="size-3.5"/>}{c?.enabled?c.error||c.status==="ready"&&"Connected"||"Waiting for first sync":"Not connected"}</p>
    {c?.lastAttempt?<p className="text-xs text-muted-foreground">Last attempt: {new Date(c.lastAttempt).toLocaleString("en-GB")}</p>:null}
    <div className="flex flex-wrap gap-2">
     {provider==="icloud"?<><Button variant="outline" size="action" disabled={!!busy} onClick={()=>setIcloud(v=>!v)}>Connect iCloud</Button><Button variant="ghost" size="action" disabled={!!busy} onClick={()=>void act("import",{action:"import",provider})}>Use existing connection</Button></>:<Button variant="outline" size="action" disabled={!!busy} onClick={()=>void act("google",{action:"connect_google"})}>Connect Google</Button>}
    </div>
   </section>;})}
   {icloud?<form className="space-y-3 rounded-md bg-muted/30 p-3" data-metis-sensitive onSubmit={e=>{e.preventDefault();const form=e.currentTarget,values=new FormData(form);void act("icloud",{action:"connect_icloud",credentials:{username:values.get("username"),password:values.get("password")}}).then(r=>{if(r&&mounted.current){form.reset();setIcloud(false);}});}}>
    <p className="text-xs text-muted-foreground">Protected connection settings. Use an app-specific password, not your Apple Account password. Credentials are encrypted and never shown to the agent.</p>
    <label className="block text-sm">Apple Account<Input name="username" type="email" autoComplete="username" required data-metis-sensitive/></label>
    <label className="block text-sm">App-specific password<Input name="password" type="password" autoComplete="new-password" required data-metis-sensitive/></label>
    <Button type="submit" size="action" disabled={!!busy}>Save iCloud connection</Button>
   </form>:null}
   <details open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}><summary className="cursor-pointer text-xs text-muted-foreground">Google setup for this Metis server</summary>
    {advanced?<><p className="my-3 text-xs text-muted-foreground">A Google web OAuth client is required. Enable Calendar and CalDAV APIs and register this exact redirect URI:</p><code className="block break-all rounded-md bg-muted p-2 text-xs">{googleOAuth.redirectUri}</code>
    <form className="mt-3 space-y-3" data-metis-sensitive onSubmit={e=>{e.preventDefault();const form=e.currentTarget,values=new FormData(form);void act("setup",{action:"configure_google",credentials:{clientId:values.get("clientId"),clientSecret:values.get("clientSecret")}}).then(r=>{if(r&&mounted.current){form.reset();setAdvanced(false);}});}}>
     <label className="block text-sm">OAuth client ID<Input name="clientId" autoComplete="off" required data-metis-sensitive/></label>
     <label className="block text-sm">OAuth client secret<Input name="clientSecret" type="password" autoComplete="new-password" required data-metis-sensitive/></label>
     <Button size="action" variant="outline" disabled={!!busy} type="submit">{googleOAuth.configured?"Replace protected configuration":"Save protected configuration"}</Button>
    </form></>:null}
   </details>
   {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
  </div>
  <DialogFooter><Button size="action" disabled={!!busy} onClick={()=>void act("sync",{action:"sync"})}><RefreshCw className={busy?"size-4 animate-spin motion-reduce:animate-none":"size-4"}/>{busy?"Working…":"Sync now"}</Button></DialogFooter>
 </DialogContent></Dialog>
 <ConfirmDialog open={!!disconnect} onOpenChange={open=>{if(!open)setDisconnect(null);}} title="Disconnect calendar?" description="Background sync stops and saved credentials are removed. Imported events and remote calendars are kept." confirmLabel="Disconnect" onConfirm={async()=>{if(disconnect){await calendarAction({action:"disconnect",id:disconnect.id});if(mounted.current)onChanged();}}}/>
 </>;
}
