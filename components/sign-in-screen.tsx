"use client";
import {useCallback,useRef,useState} from "react";
import {KeyRound,Eye,EyeOff,LoaderCircle} from "lucide-react";
import {startAuthentication} from "@simplewebauthn/browser";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {OnboardingMotion,OnboardingTransition} from "@/components/onboarding-stage";
import {loginErrorMessage} from "@/lib/login-error";
import "./onboarding.css";
export function SignInScreen({initialUsername="",onSignedIn}:{initialUsername?:string;onSignedIn:()=>Promise<void>|void}){
 const [ready,setReady]=useState(false),show=useCallback(()=>setReady(true),[]);
 const [username,setUsername]=useState(initialUsername),[password,setPassword]=useState(""),[visible,setVisible]=useState(false);
 const [busy,setBusy]=useState<"password"|"passkey"|null>(null),[error,setError]=useState(""),lock=useRef(false);
 async function submit(kind:"password"|"passkey"){
  if(lock.current)return;lock.current=true;setBusy(kind);setError("");
  try{
   let response:Response;
   if(kind==="password")response=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
   else{
    if(!window.isSecureContext||!window.PublicKeyCredential)throw new Error("Passkeys are not available here. Use a supported browser over HTTPS, or sign in with your password.");
    const options=await fetch("/api/passkeys/authenticate/options",{method:"POST"});
    const body=await options.json();if(!options.ok)throw new Error(body.error||"Could not start passkey sign-in.");
    const credential=await startAuthentication({optionsJSON:body});
    response=await fetch("/api/passkeys/authenticate/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential})});
   }
   const body=await response.json();if(!response.ok)throw new Error(kind==="password"?loginErrorMessage(response.status,body.error):body.error||"Could not sign in.");
   setPassword("");window.dispatchEvent(new Event("metis:auth-changed"));await onSignedIn();
  }catch(cause){setError(cause instanceof Error&&cause.name==="NotAllowedError"?"Passkey sign-in was cancelled or timed out. Try again or use your password.":cause instanceof Error?cause.message:"Could not sign in. Try again.");}
  finally{lock.current=false;setBusy(null);}
 }
 return <main className="onboarding-stage metis-sign-in"><OnboardingMotion onReady={show}/><OnboardingTransition step="sign-in" ready={ready} className="metis-sign-in-form"><section aria-label="Sign in">
  <span role="img" aria-label="Metis" className="metis-wordmark"/>
  <form onSubmit={event=>{event.preventDefault();void submit("password");}} className="grid gap-5">
   <label className="grid gap-2 text-sm font-medium" htmlFor="metis-username">Username<Input id="metis-username" autoComplete="username webauthn" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={128} autoFocus/></label>
   <label className="grid gap-2 text-sm font-medium" htmlFor="metis-password">Password<div className="relative"><Input id="metis-password" type={visible?"text":"password"} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={4096} className="pr-12"/><button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground" aria-label={visible?"Hide password":"Show password"} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff className="size-4"/>:<Eye className="size-4"/>}</button></div></label>
   {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
   <Button type="submit" disabled={!!busy} className="min-h-11 w-full">{busy==="password"?<LoaderCircle aria-hidden className="size-4 animate-spin"/>:null}Login</Button>
  </form>
  <Button type="button" variant="outline" disabled={!!busy} className="min-h-11 w-full" onClick={()=>void submit("passkey")}>{busy==="passkey"?<LoaderCircle aria-hidden className="size-4 animate-spin"/>:<KeyRound aria-hidden className="size-4"/>}Sign in with Passkey</Button>
 </section></OnboardingTransition></main>;
}
