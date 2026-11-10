"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Plus,RefreshCw,Loader2,Globe,Terminal,Server,Eye,EyeOff} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {consoleConnectionSchema,consoleTargetInfo,type SavedLogin} from "@/lib/credential-vault";

type LoginType="website"|"ssh"|"local";
type Inspection={target:string;label:string};
const entryKey=(site:SavedLogin)=>(site.kind||"browser")+":"+site.origin;
const types=[{id:"website" as const,label:"Website",icon:Globe},{id:"ssh" as const,label:"SSH",icon:Server},{id:"local" as const,label:"Local terminal",icon:Terminal}];
export function SavedWebsiteLogins(){
  const [sites,setSites]=useState<SavedLogin[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [selected,setSelected]=useState<SavedLogin|null>(null),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[formError,setFormError]=useState("");
  const [showPassword,setShowPassword]=useState(false),[type,setType]=useState<LoginType>("website");
  const [origin,setOrigin]=useState(""),[password,setPassword]=useState(""),[username,setUsername]=useState(""),[email,setEmail]=useState("");
  const [host,setHost]=useState(""),[port,setPort]=useState("22"),[user,setUser]=useState(""),[method,setMethod]=useState<"su"|"sudo">("su");
  const [inspection,setInspection]=useState<Inspection|null>(null),[hostConfirmed,setHostConfirmed]=useState(false),[checking,setChecking]=useState(false);
  const request=useRef<AbortController|null>(null),mutation=useRef<AbortController|null>(null);
  const clear=()=>{setOrigin("");setPassword("");setUsername("");setEmail("");setFormError("");setShowPassword(false);setType("website");setHost("");setPort("22");setUser("");setMethod("su");setInspection(null);setHostConfirmed(false);};
  const invalidate=()=>{setInspection(null);setHostConfirmed(false);setPassword("");setFormError("");};
  const refresh=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/browser/saved-logins",{cache:"no-store",signal:controller.signal});
      const body=await response.json();
      if(!response.ok)throw Error(body.error||"The credential service is unavailable.");
      if(!controller.signal.aborted)setSites(body.credentials||[]);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Could not load saved logins.");}
    finally{if(!controller.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{request.current?.abort();mutation.current?.abort();};},[refresh]);
  const close=()=>{if(busy)return;setAdding(false);setSelected(null);clear();};
  const connection=()=>consoleConnectionSchema.parse(type==="ssh"?{method:"ssh",host,port:Number(port),user}:{method,user});
  async function post(payload:unknown){
    mutation.current?.abort();const controller=new AbortController();mutation.current=controller;
    const response=await fetch("/api/browser/saved-logins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal});
    const body=await response.json();
    if(!response.ok)throw Error(body.error||"Could not save this login.");
    return body;
  }
  async function inspect(){
    setBusy(true);setChecking(true);setFormError("");
    try{
      const body=await post({action:"inspect",connection:connection()});
      if(typeof body.target!=="string"||typeof body.label!=="string"||!consoleTargetInfo(body.target))throw Error("Could not check this console target.");
      setInspection({target:body.target,label:body.label});setHostConfirmed(false);
    }catch(cause){setFormError(cause instanceof Error&&cause.name!=="ZodError"?cause.message:"Enter a valid account, host and port.");}
    finally{setBusy(false);setChecking(false);}
  }
  async function mutate(action:"create"|"update"|"delete",site?:SavedLogin){
    setBusy(true);setFormError("");setError("");
    try{
      const payload=action==="create"&&type!=="website"
        ?{action,kind:"console",connection:connection(),target:inspection?.target,password}
        :{action,origin:site?.origin||origin.trim(),kind:site?.kind||"browser",...(action!=="delete"?{...(password?{password}:{}),...(username?{username}:{}),...(email?{email}:{})}:{})};
      await post(payload);
      setAdding(false);setSelected(null);clear();await refresh();
    }catch(cause){const message=cause instanceof Error?cause.message:"Could not save this login.";if(action==="delete")setError(message);else setFormError(message);}
    finally{setBusy(false);}
  }
  const open=adding||Boolean(selected),consoleEntry=selected?.kind==="console",consoleAdding=adding&&type!=="website";
  const inspected=inspection?consoleTargetInfo(inspection.target):null;
  const editableTarget=selected?.kind==="console"?consoleTargetInfo(selected.origin):null;
  const usage=type==="website"?"Available to the agent for sign-in on this website.":type==="ssh"?"Available to the agent for SSH connections to this exact account and host.":"Available to the agent for local su or sudo authentication on this Metis server.";
  return <section className="space-y-4" aria-label="Saved logins">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Saved logins</h2>
      <Button variant="outline" size="icon" className="size-11 shrink-0" aria-label="Add login" title="Add login" disabled={busy} onClick={()=>{clear();setSelected(null);setAdding(true);}}><Plus className="size-4" aria-hidden="true"/></Button>
    </div>
    <p className="text-sm text-muted-foreground">Save website, SSH and local terminal logins for the agent. Passwords stay encrypted.</p>
    {error&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={()=>void refresh()}><RefreshCw className="size-4"/>Retry</Button></div>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Loading saved logins…</p>:!sites.length&&!error?<p className="text-sm text-muted-foreground">No saved logins yet. Use the + button to add one.</p>:null}
    {sites.map(site=>{
      const info=site.kind==="console"?consoleTargetInfo(site.origin):null;
      const label=info?.type==="ssh"?"SSH":site.kind==="console"?"Local terminal":"Website";
      const Icon=info?.type==="ssh"?Server:site.kind==="console"?Terminal:Globe;
      return <article key={entryKey(site)} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{label}</p><p className="break-all font-medium">{site.label||site.origin}</p></div>
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>{clear();setAdding(false);setSelected(site);}}>Edit login</Button><Button variant="destructive" className="min-h-11" disabled={busy} onClick={()=>void mutate("delete",site)}>Delete</Button></div>
      </article>;
    })}
    <Dialog open={open} onOpenChange={value=>{if(!value)close();}}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{adding?"Add login":"Edit login"}</DialogTitle><DialogDescription>{adding?"Choose where the agent can use this login.":selected?.label||selected?.origin}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event=>{event.preventDefault();void mutate(adding?"create":"update",selected||undefined);}}>
          {adding&&<>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Login type">
              {types.map(item=><Button key={item.id} type="button" data-vault-kind={item.id} aria-pressed={type===item.id} disabled={busy} variant={type===item.id?"secondary":"outline"} className="min-h-11 h-auto min-w-0 flex-col gap-1 px-1 py-2 text-xs sm:flex-row sm:gap-2 sm:text-sm" onClick={()=>{invalidate();setType(item.id);}}><item.icon className="size-4 shrink-0" aria-hidden="true"/>{item.label}</Button>)}
            </div>
            <p className="text-xs text-muted-foreground">{usage}</p>
          </>}
          {adding&&type==="website"&&<label className="block space-y-1.5 text-sm"><span>Login website</span><Input autoFocus type="url" required placeholder="https://example.com/login" value={origin} maxLength={2048} autoComplete="url" disabled={busy} onChange={event=>setOrigin(event.target.value)}/><span className="block text-xs text-muted-foreground">Subpages share this login. A different website needs its own entry.</span></label>}
          {consoleAdding&&<>
            {type==="ssh"&&<div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
              <label className="block min-w-0 space-y-1.5 text-sm"><span>Host</span><Input required placeholder="server.example.com" value={host} maxLength={253} autoComplete="off" disabled={busy} onChange={event=>{invalidate();setHost(event.target.value);}}/></label>
              <label className="block space-y-1.5 text-sm"><span>Port</span><Input required type="number" min={1} max={65535} value={port} disabled={busy} onChange={event=>{invalidate();setPort(event.target.value);}}/></label>
            </div>}
            {type==="local"&&<label className="block space-y-1.5 text-sm"><span>Authentication method</span><select value={method} disabled={busy} className="h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event=>{invalidate();setMethod(event.target.value as "su"|"sudo");}}><option value="su">su — target account password</option><option value="sudo">sudo — console service account password</option></select></label>}
            <label className="block space-y-1.5 text-sm"><span>{type==="ssh"?"SSH account":"Target account"}</span><Input required value={user} maxLength={64} autoComplete="off" data-metis-sensitive="true" disabled={busy} onChange={event=>{invalidate();setUser(event.target.value);}}/></label>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy||!user||type==="ssh"&&!host} onClick={()=>void inspect()}>{checking&&<Loader2 className="size-4 animate-spin" aria-hidden="true"/>}{checking?"Checking…":type==="ssh"?"Check host key":"Check local target"}</Button>
            {inspection&&inspected&&<div className="space-y-2 text-sm" role="status">
              {inspected.type==="ssh"?<>
                <p className="text-xs text-muted-foreground">SSH host key fingerprint</p><p className="break-all font-mono text-xs">{inspected.fingerprint}</p>
                <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={hostConfirmed} disabled={busy} onChange={event=>setHostConfirmed(event.target.checked)}/><span>I verified this host key using a trusted source.</span></label>
              </>:<p>Enter the password for <strong>{inspected.authUser}</strong> on <span className="break-all">{inspected.host}</span>.</p>}
            </div>}
          </>}
          {editableTarget&&<p className="text-sm text-muted-foreground">Password for <strong>{editableTarget.authUser}</strong> on <span className="break-all">{editableTarget.host}</span>. Create a new login to change its target.</p>}
          {!consoleEntry&&(!adding||type==="website")&&<>
            <label className="block space-y-1.5 text-sm"><span>{adding?"Username (optional)":"New username (optional)"}</span><Input value={username} maxLength={512} autoComplete="off" data-metis-sensitive="true" disabled={busy} onChange={event=>setUsername(event.target.value)}/></label>
            <label className="block space-y-1.5 text-sm"><span>{adding?"Email (optional)":"New email (optional)"}</span><Input type="email" value={email} maxLength={320} autoComplete="off" data-metis-sensitive="true" disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
          </>}
          {(!consoleAdding||inspection)&&<label className="block space-y-1.5 text-sm"><span>{adding?"Password":"New password"}</span><div className="relative"><Input type={showPassword?"text":"password"} className="pr-12" data-metis-sensitive="true" autoComplete="new-password" required={adding||consoleEntry} value={password} maxLength={4096} disabled={busy} onChange={event=>setPassword(event.target.value)}/><button type="button" className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" disabled={busy} aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff className="size-4" aria-hidden="true"/>:<Eye className="size-4" aria-hidden="true"/>}</button></div></label>}
          {!adding&&<p className="text-xs text-muted-foreground">{consoleEntry?"The password is replaced for this exact console target.":"Blank fields keep their current values. Changing the username or email stops automatic reuse of the old password unless you enter a new one."}</p>}
          {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>Cancel</Button><Button className="min-h-11" disabled={busy||(adding?!password||(type==="website"?!origin:!inspection||type==="ssh"&&!hostConfirmed):!password&&!username&&!email)}>{busy&&!checking&&<Loader2 className="size-4 animate-spin" aria-hidden="true"/>}{busy&&!checking?"Saving…":adding?"Save login":"Save changes"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
