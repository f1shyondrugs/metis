"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import { HoverPreview } from "@/components/hover-preview";
import { InternalLinkPreviewChat, InternalLinkPreviewContent } from "@/components/internal-link-preview";
import { parseInternalLink } from "@/lib/internal-link";
import { parseReferenceLink } from "@/lib/reference-link";
import { ReferencePreviewContent } from "@/components/reference-link";

type LinkPreviewProps = {
  href: string;
  children?: ReactNode;
  anchorElement?: HTMLElement | null;
};

type Preview = {
  title?: string;
  description?: string;
  favicon?: string;
  image?: string;
};

export function LinkPreview({ href, children, anchorElement }: LinkPreviewProps) {
  const target = parseInternalLink(href);
  const reference=parseReferenceLink(href);
  const chatId = useContext(InternalLinkPreviewChat);
  return <HoverPreview content={target
    ? <InternalLinkPreviewContent key={`${href}:${chatId || ""}`} target={target} chatId={chatId} />
    : reference ? <ReferencePreviewContent reference={reference}/> : <WebPreview key={href} href={href} />} anchorElement={anchorElement}>{children}</HoverPreview>;
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
              {preview?.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.favicon} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
              ) : null}
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
