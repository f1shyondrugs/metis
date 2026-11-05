"use client";

import React, { useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicNoteShare } from "@/lib/note-share-types";

export function SharedNotePasswordGate({token,onUnlocked}:{token:string;onUnlocked?:(share:PublicNoteShare)=>void}) {
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function unlock(event:React.FormEvent) {
    event.preventDefault();
    if(busy||!password)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/shared-notes/"+encodeURIComponent(token),{
        method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({password})
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Could not open this shared note.");
      setPassword("");
      if(onUnlocked)onUnlocked(body as PublicNoteShare);
      else window.location.reload();
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not open this shared note.");}
    finally{setBusy(false);}
  }
  return <main className="flex min-h-dvh items-center justify-center bg-background p-5 text-foreground">
    <form onSubmit={event=>void unlock(event)} className="w-full max-w-sm space-y-4 rounded-xl border border-border/60 p-6">
      <LockKeyhole className="size-6 text-muted-foreground"/>
      <div><h1 className="text-lg font-semibold">Password required</h1><p className="mt-1 text-sm text-muted-foreground">Enter the password to view these shared notes.</p></div>
      <Input type="password" autoComplete="current-password" aria-label="Share password" placeholder="Password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)} autoFocus/>
      {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
      <Button type="submit" disabled={busy||!password} className="w-full">{busy?<Loader2 className="size-4 animate-spin"/>:null}View shared notes</Button>
    </form>
  </main>;
}
