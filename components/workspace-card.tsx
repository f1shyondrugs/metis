"use client";

import {useEffect,useRef,useState,type ReactNode} from "react";
import {Check,ClipboardList,Copy,PanelsTopLeft} from "lucide-react";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {Markdown} from "@/components/markdown";
import {copyText} from "@/lib/copy-text";

export function WorkspaceCard({kind,title,content,metadata,progress,compact=false,onOpen,actions}:{
  kind:"canvas"|"plan"; title:string; content:string; metadata?:ReactNode; progress?:number|null;
  compact?:boolean; onOpen?:()=>void; actions?:ReactNode;
}) {
  const [copied,setCopied]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const label=kind==="canvas"?"Canvas":"Plan",Icon=kind==="canvas"?PanelsTopLeft:ClipboardList;
  async function copy(){
    try {
      await copyText(content);
      setCopied(true);toast.success(label+" copied");
      if(timer.current)clearTimeout(timer.current);
      timer.current=setTimeout(()=>setCopied(false),1600);
    } catch {toast.error("Could not copy "+kind);}
  }
  return <section data-workspace-card={kind} className="my-3 min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
    <header className="flex items-start gap-3 p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><Icon className="size-4" aria-hidden="true"/></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="font-medium">{label}</span>{metadata}</div>
        <h3 className="mt-1 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{title}</h3>
        {progress!==undefined&&progress!==null?<div className="mt-3 flex items-center gap-2">
          <div role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{width:progress+"%"}}/>
          </div><span className="text-xs tabular-nums text-muted-foreground">{progress}%</span>
        </div>:null}
      </div>
    </header>
    {compact?<p className="border-y border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">{content.split("\n").find(line=>line.trim())?.replace(/^#+\s*/,"").slice(0,150)||"Open the plan to view its details."}</p>:
      <div role="region" aria-label={label+" preview"} tabIndex={0} className="workspace-card-preview max-h-72 overflow-auto overscroll-contain border-y border-border bg-background p-4 text-sm leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:max-h-96 [&_.markdown-body]:m-0 [&_.markdown-body_h1]:mt-0 [&_.markdown-body_h1]:text-lg [&_.markdown-body_h2]:mt-3 [&_.markdown-body_h2]:text-base [&_.markdown-body_p]:my-2">
        {content?<Markdown content={content}/>:<p className="text-muted-foreground">{kind==="canvas"?"No canvas content yet.":"No plan details yet."}</p>}
      </div>}
    <footer className="flex flex-wrap items-center gap-2 p-3">
      <Button type="button" variant="ghost" size="action" aria-label={"Copy "+kind} onClick={()=>void copy()}>{copied?<Check className="size-4" aria-hidden="true"/>:<Copy className="size-4" aria-hidden="true"/>}{copied?"Copied":"Copy"}</Button>
      <span className="flex-1"/>
      {onOpen?<Button type="button" size="action" variant={actions?"outline":"default"} onClick={onOpen}><Icon className="size-4" aria-hidden="true"/>Open {kind}</Button>:null}
      {actions}
    </footer>
  </section>;
}
