"use client";

import { decodeNotesSection, findNotesSection, scrollNotesSection } from "@/lib/notes-section-navigation";
import { LinkIcon } from "@/components/link-icon";
import type { ReactNode } from "react";
import { publicMarkdownLinkTarget, type PublicMarkdownShare } from "@/lib/public-markdown";

/** Share navigation never mounts account previews or dispatches application events. */
export function PublicMarkdownLink({ href, share, children, title, className }: {
  href: string; share: PublicMarkdownShare; children: ReactNode; title?: string; className?: string;
}) {
  const target = publicMarkdownLinkTarget(href, share);
  if (!target) return <span className={className}>{children}</span>;
  return <a href={target.href} title={title} className={className}
    target={target.kind === "external" ? "_blank" : undefined}
    rel={target.kind === "external" ? "noopener noreferrer" : undefined}
    referrerPolicy="no-referrer"
    onClick={target.kind === "note" || target.kind === "workspace" || target.kind === "anchor" ? event => {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "anchor") { const id=decodeNotesSection(target.href);const element=id&&findNotesSection(event.currentTarget.closest(".markdown-body") || event.currentTarget.closest("article") || document,id);if(element)scrollNotesSection(element); }
      else if (target.kind === "workspace") share.onOpenWorkspace?.(target.id, target.type);
      else if(target.kind === "note") share.onOpenNote?.(target.id, target.blockId);
    } : undefined}
  ><LinkIcon href={href} icon={target.kind === "note" ? share.noteIcons?.[target.id] ?? null : null} />{children}</a>;
}
