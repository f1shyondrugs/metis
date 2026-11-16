"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import { HoverPreview } from "@/components/hover-preview";
import { LinkIcon } from "@/components/link-icon";
import { WebsiteIcon } from "@/components/website-icon";
import { sourceFaviconUrl } from "@/lib/message-sources";
import { InternalLinkPreviewChat, InternalLinkPreviewContent } from "@/components/internal-link-preview";
import { parseInternalLink } from "@/lib/internal-link";
import { useNotebookLink } from "@/components/use-notebook-link";
import { NoteIcon } from "@/components/notes/note-icon";
import { parseReferenceLink } from "@/lib/reference-link";
import { ReferencePreviewContent } from "@/components/reference-link";

type LinkPreviewProps = {
  href: string;
  children?: ReactNode;
  anchorElement?: HTMLElement | null;
  onDismiss?: () => void;
};

type Preview = {
  title?: string;
  description?: string;
  favicon?: string;
  image?: string;
};

export function LinkPreview({ href, children, anchorElement, onDismiss }: LinkPreviewProps) {
  const notebook = useNotebookLink(href);
  const target = parseInternalLink(href) || (notebook?.type === "note" ? {kind:"note" as const,id:notebook.id,blockId:notebook.blockId} : null);
  const reference=parseReferenceLink(href);
  const chatId = useContext(InternalLinkPreviewChat);
  return <HoverPreview content={target
    ? <InternalLinkPreviewContent key={`${href}:${chatId || ""}`} target={target} chatId={chatId} />
    : reference ? <ReferencePreviewContent reference={reference}/> : notebook?.type === "share" ? <SharedNotePreview key={href} token={notebook.token} noteId={notebook.noteId}/> : <WebPreview key={href} href={href} />} anchorElement={anchorElement} onDismiss={onDismiss}>{children}</HoverPreview>;
}

function SharedNotePreview({token,noteId}:{token:string;noteId?:string}){
 const [preview,setPreview]=useState<{title:string;description:string;icon:string|null}|null>(null),[state,setState]=useState("loading");
 useEffect(()=>{
  const controller=new AbortController(),params=new URLSearchParams({view:"preview"});if(noteId)params.set("noteId",noteId);
  fetch("/api/shared-notes/"+encodeURIComponent(token)+"?"+params,{signal:controller.signal,cache:"no-store",credentials:"same-origin"})
   .then(async response=>{if(!response.ok){if(!controller.signal.aborted)setState(response.status===401?"locked":"error");return;}const value=await response.json();if(!controller.signal.aborted){setPreview(value);setState("ready");}})
   .catch(()=>{if(!controller.signal.aborted)setState("error");});
  return()=>controller.abort();
 },[token,noteId]);
 return <div data-shared-note-preview>
  <div className="flex items-center gap-2 text-xs font-medium"><NoteIcon value={preview?.icon} className="size-4"/><span>{preview?.title||"Shared notebook"}</span></div>
  <p role="status" className="mt-2 line-clamp-3 whitespace-pre-line break-words text-[11px] text-muted-foreground">{state==="loading"?"Loading preview…":state==="locked"?"Password required. Open the link to unlock it.":state==="error"?"Preview unavailable. The link may have expired or been revoked.":preview?.description||"No content yet."}</p>
 </div>;
}

function WebPreview({ href }: { href: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/link-preview?url=${encodeURIComponent(href)}`, { cache: "force-cache", signal: controller.signal })
      .then(async response => { if (response.ok) setPreview(await response.json() as Preview); })
      .catch(() => { /* The link remains usable without metadata. */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [href]);

  return <>
          {loading ? (
            <span className="text-xs text-muted-foreground">Loading link…</span>
          ) : (
            <span className="flex gap-2.5">
              <WebsiteIcon src={preview?.favicon || sourceFaviconUrl(href)} className="mt-0.5 size-4" fallback={<LinkIcon href={href} className="!mr-0 !size-full" kind="link" />} />
              <span className="min-w-0">
                {preview?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.image} alt="" className="mb-2 h-20 w-full rounded-md object-cover" />
                ) : null}
                <span className="block truncate text-xs font-medium">
                  {preview?.title || href}
                </span>
                {preview?.description ? (
                  <span className="mt-1 block line-clamp-3 text-[11px] leading-4 text-muted-foreground">
                    {preview.description}
                  </span>
                ) : (
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">{href}</span>
                )}
              </span>
            </span>
          )}
  </>;
}
