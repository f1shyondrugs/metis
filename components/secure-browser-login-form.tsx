"use client";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { QuestionFormFrame } from "@/components/question-form-frame";
import type { PendingChatQuestion, QuestionAnswers } from "@/lib/question-contract";

export function SecureBrowserLoginForm({form,disabled,error,onSubmit,onCancel}:{form:PendingChatQuestion;disabled?:boolean;error?:string|null;onSubmit:(result:QuestionAnswers)=>void;onCancel:()=>void}) {
  const [password,setPassword]=useState(""),[busy,setBusy]=useState(false),[filled,setFilled]=useState(false),[failure,setFailure]=useState("");
  const [persist,setPersist]=useState(false);
  const [username,setUsername]=useState(""),[email,setEmail]=useState("");
  const consoleInput=form.secureBrowserInput?.kind==="console";
  const fields=consoleInput?["password"]:form.secureBrowserInput?.fields??["password"];
  const passwordRequired=fields.includes("password");
  const showUsername=!consoleInput&&(passwordRequired||fields.includes("username"));
  const showEmail=!consoleInput&&(passwordRequired||fields.includes("email"));
  const clear=()=>{setPassword("");setUsername("");setEmail("");};
  async function submit(event:FormEvent) {
    event.preventDefault();if(disabled||busy)return;
    if(!filled&&fields.some(key=>!({password,username,email} as Record<string,string>)[key])){setFailure("Enter the requested credentials.");return;}
    setBusy(true);setFailure("");
    try {
      if(!filled){
        const response=await fetch("/api/browser/secure-input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({questionId:form.questionId,...(password?{password}:{}),...(username?{username}:{}),...(email?{email}:{}),persist})});
        if(!response.ok)throw Error("Credentials could not be entered. Request a new login form.");
        setFilled(true);
      }
      clear();onSubmit({answers:["Credentials entered securely."],values:{secure_login:"Credentials entered securely."}});
    }catch(e){setFailure(e instanceof Error?e.message:"Login failed");}finally{clear();setBusy(false);}
  }
  return <QuestionFormFrame title={form.title||"Enter credentials securely"} description={`${consoleInput?"Console":"Website"}: ${form.secureBrowserInput?.origin}\nMetis enters credentials directly. The AI receives status only.`} submitLabel={filled?"Continue agent":passwordRequired?"Enter password":"Enter credentials"} disabled={disabled||busy} error={failure||error} onSubmit={submit} onCancel={()=>{clear();onCancel();}}>
    {!filled&&showUsername&&<div className="min-w-0 space-y-2"><label htmlFor={`username-${form.questionId}`} className="text-sm font-medium">Username{!fields.includes("username")&&" (optional)"}</label><Input id={`username-${form.questionId}`} type="text" autoComplete="username" required={fields.includes("username")} maxLength={512} value={username} disabled={disabled||busy} onChange={e=>setUsername(e.target.value)} className="min-h-11 text-sm"/></div>}
    {!filled&&showEmail&&<div className="mt-3 min-w-0 space-y-2"><label htmlFor={`email-${form.questionId}`} className="text-sm font-medium">Email{!fields.includes("email")&&" (optional)"}</label><Input id={`email-${form.questionId}`} type="email" autoComplete="email" required={fields.includes("email")} maxLength={320} value={email} disabled={disabled||busy} onChange={e=>setEmail(e.target.value)} className="min-h-11 text-sm"/></div>}
    {!filled&&passwordRequired&&<div className="mt-3 min-w-0 space-y-2"><label htmlFor={`password-${form.questionId}`} className="flex items-center gap-2 text-sm font-medium leading-5">Password</label><Input id={`password-${form.questionId}`} autoFocus type="password" autoComplete="current-password" required maxLength={4096} value={password} disabled={disabled||busy} onChange={event=>setPassword(event.target.value)} className="min-h-11 text-sm"/></div>}
    {!filled&&<label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={persist} disabled={disabled||busy} onChange={event=>setPersist(event.target.checked)} className="size-4 accent-primary"/>Save permanently</label>}
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Unchecked: saved only for this chat, for up to 24 hours, until service restart or chat deletion. Manage permanent entries in Settings → Security.</p>
    {form.secureBrowserInput?.kind==="console"&&<p className="mt-2 text-xs leading-relaxed text-muted-foreground">Check the target, account and SSH host-key fingerprint. Root access on the Metis host can bypass its local protections.</p>}
  </QuestionFormFrame>;
}
