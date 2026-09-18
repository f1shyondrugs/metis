"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type LinkPreviewProps = {
  href: string;
  children: ReactNode;
};

type Preview = {
  title?: string;
  description?: string;
  favicon?: string;
  image?: string;
};

type PreviewCoords = {
  left: number;
  top: number;
  placeBelow: boolean;
};

const PREVIEW_WIDTH = 288;
const PREVIEW_GUTTER = 8;

function positionPreview(rect: DOMRect): PreviewCoords {
  const left = Math.min(
    Math.max(PREVIEW_GUTTER, rect.left),
    Math.max(PREVIEW_GUTTER, window.innerWidth - PREVIEW_WIDTH - PREVIEW_GUTTER),
  );
  const placeBelow = rect.top < 160;
  return {
    left,
    top: placeBelow ? rect.bottom + PREVIEW_GUTTER : rect.top - PREVIEW_GUTTER,
    placeBelow,
  };
}

export function LinkPreview({ href, children }: LinkPreviewProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<PreviewCoords | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      setCoords(positionPreview(rect));
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords(positionPreview(rect));
    setOpen(true);
    if (preview || loading) return;
    timerRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(href)}`, {
          cache: "force-cache",
        });
        if (response.ok) setPreview((await response.json()) as Preview);
      } finally {
        setLoading(false);
      }
    }, 220);
  }

  const tooltip = open && coords ? (
    <span
      role="tooltip"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: PREVIEW_WIDTH,
        transform: coords.placeBelow ? undefined : "translateY(-100%)",
      }}
      className="pointer-events-none z-[80] rounded-xl border border-border/70 bg-popover p-3 text-left text-popover-foreground shadow-xl"
    >
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
    </span>
  ) : null;

  return (
    <span
      ref={triggerRef}
      className="inline-flex max-w-full align-middle"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {tooltip && typeof document !== "undefined" ? createPortal(tooltip, document.body) : null}
    </span>
  );
}
