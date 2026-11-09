"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Plus,RefreshCw,Loader2,Globe,Terminal,Eye,EyeOff} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "@/components/ui/dialog";

type SavedLogin={origin:string;kind?:"browser"|"console";label?:string};
const entryKey=(site:SavedLogin)=>(site.kind||"browser")+":"+site.origin;
export function SavedWebsiteLogins(){
  const [sites,setSites]=useState<SavedLogin[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [selected,setSelected]=useState<SavedLogin|null>(null),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[formError,setFormError]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [origin,setOrigin]=useState(""),[password,setPassword]=useState(""),[username,setUsername]=useState(""),[email,setEmail]=useState("");
  const request=useRef<AbortController|null>(null);
  const clear=()=>{setOrigin("");setPassword("");setUsername("");setEmail("");setFormError("");setShowPassword(false);};
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
  useEffect(()=>{void refresh();return()=>request.current?.abort();},[refresh]);
  const close=()=>{if(busy)return;setAdding(false);setSelected(null);clear();};
  async function mutate(action:"create"|"update"|"delete",site?:SavedLogin){
    setBusy(true);setFormError("");setError("");
    try{
      const payload={action,origin:site?.origin||origin.trim(),kind:site?.kind||"browser",
        ...(action!=="delete"?{...(password?{password}:{}),...(username?{username}:{}),...(email?{email}:{})}:{})};
      const response=await fetch("/api/browser/saved-logins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const body=await response.json();
      if(!response.ok)throw Error(body.error||"Could not save this login.");
      setAdding(false);setSelected(null);clear();await refresh();
    }catch(cause){const message=cause instanceof Error?cause.message:"Could not save this login.";if(action==="delete")setError(message);else setFormError(message);}
    finally{setBusy(false);}
  }
  const open=adding||Boolean(selected),consoleEntry=selected?.kind==="console";
  return <section className="space-y-4" aria-label="Saved logins">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Saved logins</h2>
      <Button variant="outline" size="icon" className="size-11 shrink-0" aria-label="Add login" title="Add login" disabled={busy} onClick={()=>{clear();setSelected(null);setAdding(true);}}><Plus className="size-4" aria-hidden="true"/></Button>
    </div>
    <p className="text-sm text-muted-foreground">Add a login here or save it during sign-in. Your saved logins are encrypted.</p>
    {error&&<div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={()=>void refresh()}><RefreshCw className="size-4"/>Retry</Button></div>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Loading saved logins…</p>:!sites.length&&!error?<p className="text-sm text-muted-foreground">No saved logins yet. Use the + button to add one.</p>:null}
    {sites.map(site=><article key={entryKey(site)} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
      {site.kind==="console"?<Terminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>:<Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
      <p className="min-w-0 flex-1 break-all font-medium">{site.label||site.origin}</p>
      <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto"><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>{clear();setAdding(false);setSelected(site);}}>Edit login</Button><Button variant="destructive" className="min-h-11" disabled={busy} onClick={()=>void mutate("delete",site)}>Delete</Button></div>
    </article>)}
    <Dialog open={open} onOpenChange={value=>{if(!value)close();}}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{adding?"Add login":"Edit login"}</DialogTitle><DialogDescription>{adding?"Enter the website that shows the login form. Passwords stay encrypted and hidden from chat.":selected?.label||selected?.origin}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event=>{event.preventDefault();void mutate(adding?"create":"update",selected||undefined);}}>
          {adding&&<label className="block space-y-1.5 text-sm"><span>Login website</span><Input autoFocus type="url" required placeholder="https://example.com/login" value={origin} maxLength={2048} autoComplete="url" disabled={busy} onChange={event=>setOrigin(event.target.value)}/><span className="block text-xs text-muted-foreground">Subpages share this login. A different website needs its own entry.</span></label>}
          {!consoleEntry&&<><label className="block space-y-1.5 text-sm"><span>{adding?"Username (optional)":"New username (optional)"}</span><Input value={username} maxLength={512} autoComplete="off" data-metis-sensitive="true" disabled={busy} onChange={event=>setUsername(event.target.value)}/></label><label className="block space-y-1.5 text-sm"><span>{adding?"Email (optional)":"New email (optional)"}</span><Input type="email" value={email} maxLength={320} autoComplete="off" data-metis-sensitive="true" disabled={busy} onChange={event=>setEmail(event.target.value)}/></label></>}
          <label className="block space-y-1.5 text-sm"><span>{adding?"Password":"New password"}</span><div className="relative"><Input type={showPassword?"text":"password"} className="pr-12" autoComplete="new-password" required={adding||consoleEntry} value={password} maxLength={4096} disabled={busy} onChange={event=>setPassword(event.target.value)}/><button type="button" className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" disabled={busy} aria-label={showPassword?"Hide password":"Show password"} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff className="size-4" aria-hidden="true"/>:<Eye className="size-4" aria-hidden="true"/>}</button></div></label>
          {!adding&&<p className="text-xs text-muted-foreground">Blank fields keep their current values. Changing the username or email stops automatic reuse of the old password unless you enter a new one.</p>}
          {formError&&<p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>Cancel</Button><Button className="min-h-11" disabled={busy||(adding?!password||!origin:!password&&!username&&!email)}>{busy&&<Loader2 className="size-4 animate-spin" aria-hidden="true"/>}{adding?"Save login":"Save changes"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
