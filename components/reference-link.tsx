"use client";

import type { ReactNode } from "react";
import type { ReferenceResult } from "@/lib/reference-search";
import { referenceHref, parseReferenceLink } from "@/lib/reference-link";
import { parseInternalLink } from "@/lib/internal-link";
import { LinkIcon } from "@/components/link-icon";
import { HoverPreview } from "@/components/hover-preview";
import { InternalLinkPreviewContent } from "@/components/internal-link-preview";
import { usePublicMarkdownShare } from "@/components/public-markdown-context";
import { cn } from "@/lib/utils";

const labels = {file:"File",canvas:"Canvas",plan:"Plan",note:"Note",issue:"Issue",browser:"Browser",terminal:"Terminal",memory:"Memory",chat:"Chat"};

/** Non-document previews use the already selected metadata, never arbitrary URL fetching. */
export function ReferencePreviewContent({reference}:{reference:ReferenceResult}) {
  return <div data-reference-preview={reference.kind}>
    <div className="flex items-start gap-2">
      <LinkIcon kind={reference.kind} id={reference.id} className="mt-0.5 !mr-0 !size-4 text-muted-foreground"/>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{labels[reference.kind]}</div>
        <div className="mt-0.5 line-clamp-2 break-words text-xs font-medium">{reference.label}</div>
      </div>
    </div>
    {reference.detail?<p className="mt-2 line-clamp-3 break-words text-[11px] text-muted-foreground">{reference.detail}</p>:null}
    {reference.path?<p className="mt-2 line-clamp-2 break-all text-[10px] text-muted-foreground">{reference.path}</p>:null}
    <p className="mt-2 text-[10px] text-muted-foreground">Open {labels[reference.kind].toLowerCase()}</p>
  </div>;
}

/** Saved reference identity is authoritative; labels alone never create a destination. */
export function ReferenceLink({reference,children,className}:{
  reference:ReferenceResult;children?:ReactNode;className?:string;
}) {
  const share=usePublicMarkdownShare();
  const href=referenceHref(reference);
  if(share || !href || (!parseInternalLink(href)&&!parseReferenceLink(href)))return <span>{children || "@"+reference.label}</span>;
  const target=parseInternalLink(href);
  const browserHref=reference.kind==="browser" && /^https?:\/\//i.test(reference.path || "") ? reference.path : undefined;
  const webHref=reference.kind==="chat" ? "/?c="+encodeURIComponent(reference.chatId || reference.id) : browserHref;
  return <HoverPreview content={target
    ? <InternalLinkPreviewContent target={target} chatId={reference.chatId || null}/>
    : <ReferencePreviewContent reference={reference}/>}>
    <a href={webHref || href} data-reference-kind={reference.kind}
      className={cn("reference-mention text-primary underline decoration-dotted decoration-primary/60 underline-offset-4 hover:decoration-solid hover:text-primary/80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",className)}
      onClick={event=>{
        if(webHref && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey))return;
        event.preventDefault();event.stopPropagation();
        window.dispatchEvent(new CustomEvent("ai-chat:open-reference",{detail:reference}));
      }}
      onAuxClick={event=>{
        if(!webHref && event.button===1){event.preventDefault();window.dispatchEvent(new CustomEvent("ai-chat:open-reference",{detail:reference}));}
      }}>
      <LinkIcon href={href}/>{children || "@"+reference.label}
    </a>
  </HoverPreview>;
}
