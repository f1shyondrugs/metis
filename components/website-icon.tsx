"use client";

import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Keep a stable fallback when a website has no favicon or refuses image loads. */
export function WebsiteIcon({ src, className }: { src?: string; className?: string }) {
  return (
    <span className={cn("relative inline-block size-3.5 shrink-0", className)} aria-hidden="true">
      <Globe2 className="absolute inset-0 size-full text-muted-foreground" />
      {src ? (
        // External favicons can be data URLs; image optimization is not applicable.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="relative size-full rounded-sm object-contain"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </span>
  );
}
