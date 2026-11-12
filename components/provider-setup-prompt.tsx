"use client";
import {KeyRound} from "lucide-react";

/** The ordinary chat empty state is also the first tour target before a provider exists. */
export function ProviderSetupPrompt({onClick}:{onClick:()=>void}){
 return <button type="button" data-onboarding-target="chat"
  className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/70 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/35"
  onClick={onClick}>
  <span className="min-w-0">
   <span className="block text-sm font-medium">First add your provider</span>
   <span className="mt-1 block text-xs text-muted-foreground">Choose a provider and connect an API key or OAuth account to start chatting.</span>
  </span>
  <KeyRound className="size-5 shrink-0 text-muted-foreground"/>
 </button>;
}
