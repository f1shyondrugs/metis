"use client";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuestionFormFrame({title,description,submitLabel,disabled,error,onSubmit,onCancel,children}:{title?:string;description?:string;submitLabel?:string;disabled?:boolean;error?:string|null;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;onCancel:()=>void;children:ReactNode}) {
  return <form onSubmit={onSubmit} noValidate aria-label={title||"Agent needs your input"} className="my-4 min-w-0 scheme-light dark:scheme-dark rounded-xl border border-border bg-background p-4 sm:p-5">
    <div className="mb-5 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold leading-6">{title||"Agent needs your input"}</h3>{description?<p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{description}</p>:null}</div><Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={onCancel} className="min-h-11 min-w-11 shrink-0 text-muted-foreground">Cancel</Button></div>
    {children}
    {error?<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>:null}
    <Button type="submit" disabled={disabled} className="mt-5 min-h-11 w-full gap-2">{disabled?<LoaderCircle className="size-4 animate-spin" aria-hidden="true"/>:null}{disabled?"Sending…":submitLabel||"Continue"}{!disabled?<ArrowRight className="size-4" aria-hidden="true"/>:null}</Button>
  </form>;
}
