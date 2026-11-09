"use client";

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
    onClick={target.kind === "note" || target.kind === "workspace" ? event => {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "workspace") share.onOpenWorkspace?.(target.id, target.type);
      else share.onOpenNote?.(target.id, target.blockId);
    } : undefined}
  ><LinkIcon href={href} icon={target.kind === "note" ? share.noteIcons?.[target.id] ?? null : null} />{children}</a>;
}
