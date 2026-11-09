"use client";
import {AlertCircle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

/** A failed read is never presented as an empty data set. */
export function LoadError({message,onRetry,busy=false,className}:{message:string;onRetry:()=>void;busy?:boolean;className?:string}){
  return <div role="alert" className={cn("flex flex-wrap items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm",className)}>
    <AlertCircle className="mt-1 size-4 shrink-0 text-destructive" aria-hidden="true"/>
    <p className="min-w-0 flex-1 self-center text-destructive [overflow-wrap:anywhere]">{message}</p>
    <Button type="button" variant="outline" size="action" disabled={busy} onClick={onRetry}>Retry</Button>
  </div>;
}
