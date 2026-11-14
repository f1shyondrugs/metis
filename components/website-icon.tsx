"use client";

import { useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Keep the caller's existing icon until a favicon loads, and on any image error. */
export function WebsiteIcon({ src, className, fallback }: { src?: string; className?: string; fallback?: ReactNode }) {
  return (
    <span className={cn("relative inline-block size-3.5 shrink-0", className)} aria-hidden="true">
      <WebsiteImage key={src || ""} src={src} fallback={fallback ?? <Globe2 className="size-full text-muted-foreground" />} />
    </span>
  );
}

function WebsiteImage({ src, fallback }: { src?: string; fallback: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  return <>
    <span data-website-icon-fallback="" className="absolute inset-0 size-full" hidden={status === "loaded"}>{fallback}</span>
    {src && status !== "failed" ? (
      // External favicons can be data URLs; image optimization is not applicable.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="relative size-full rounded-sm object-contain"
        style={{ opacity: status === "loaded" ? 1 : 0 }}
        onLoad={event => setStatus(event.currentTarget.naturalWidth > 0 ? "loaded" : "failed")}
        onError={() => setStatus("failed")}
      />
    ) : null}
  </>;
}
