"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {startRegistration} from "@simplewebauthn/browser";
import {KeyRound,LoaderCircle,Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
type Passkey={id:string;name:string;createdAt:string;lastUsedAt:string|null};
async function request(action:string,body?:unknown){
 const response=await fetch("/api/passkeys/"+action,{method:"POST",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok)throw new Error(result.error||"Passkey request failed.");return result;
}
export function PasskeySettings(){
 const [keys,setKeys]=useState<Passkey[]|null>(null),[name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[supported,setSupported]=useState(false);
 const live=useRef(true),lock=useRef(false);
 const load=useCallback(async()=>{try{const result=await request("list");if(live.current){setKeys(result.passkeys);setError("");}}catch(e){if(live.current)setError(e instanceof Error?e.message:"Could not load passkeys.");}},[]);
 useEffect(()=>{live.current=true;setSupported(window.isSecureContext&&!!window.PublicKeyCredential);void load();return()=>{live.current=false;};},[load]);
 async function act(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await action();await load();}catch(e){if(live.current)setError(e instanceof Error&&e.name==="NotAllowedError"?"Passkey setup was cancelled or timed out.":e instanceof Error?e.message:"Could not update passkeys.");}finally{lock.current=false;if(live.current)setBusy(false);}}
 return <section className="grid gap-4 rounded-xl border border-border p-5" aria-labelledby="passkey-settings-title">
  <div><h3 id="passkey-settings-title" className="flex items-center gap-2 font-medium"><KeyRound aria-hidden className="size-4"/>Passkeys</h3><p className="mt-1 text-sm text-muted-foreground">Sign in with your device PIN, fingerprint or security key. Your password stays available.</p></div>
  {error?<div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void load()}>Retry</Button></div>:null}
  {keys===null&&!error?<p role="status" className="text-sm text-muted-foreground">Loading passkeys…</p>:keys?.length?<ul className="grid gap-3">{keys.map(key=><li key={key.id} className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{key.name}</p><p className="text-xs text-muted-foreground">Added {new Date(key.createdAt).toLocaleDateString("en-US")}{key.lastUsedAt?" · Last used "+new Date(key.lastUsedAt).toLocaleDateString("en-US"):""}</p></div><Button aria-label={"Remove "+key.name} variant="ghost" size="icon" disabled={busy} onClick={()=>{if(window.confirm("Remove this passkey? You can still sign in with your password."))void act(async()=>{await request("remove",{id:key.id});});}}><Trash2 aria-hidden className="size-4"/></Button></li>)}</ul>:keys?<p className="text-sm text-muted-foreground">No passkeys yet.</p>:null}
  <label className="grid gap-2 text-sm">Passkey name<Input value={name} onChange={e=>setName(e.target.value)} maxLength={80} placeholder="This device" disabled={busy}/></label>
  <Button className="min-h-11 justify-self-start" disabled={busy||!supported} onClick={()=>void act(async()=>{const options=await request("register/options");const credential=await startRegistration({optionsJSON:options});if(!live.current)return;await request("register/verify",{credential,name});if(live.current)setName("");})}>{busy?<LoaderCircle aria-hidden className="size-4 animate-spin"/>:<KeyRound aria-hidden className="size-4"/>}Add passkey</Button>
  {!supported?<p className="text-xs text-muted-foreground">Passkeys require HTTPS and a supported browser or desktop app.</p>:null}
 </section>;
}
