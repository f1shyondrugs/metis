"use client";

import { useRef, useState, useEffect } from "react";
import { ImageOff } from "lucide-react";
import { ImageViewer } from "@/components/image-viewer";
import type { AssistantImage } from "@/lib/assistant-images";

function GalleryImage({ image, large = false }: { image: AssistantImage; large?: boolean }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return (
    <span className={large ? "relative flex min-h-40 items-center justify-center" : "relative flex h-28 w-40 items-center justify-center bg-muted/40"}>
      {status === "loading" ? <span className="absolute inset-0 bg-muted/40 motion-safe:animate-pulse" aria-label="Loading image" /> : null}
      {status === "error" ? (
        <span className="flex flex-col items-center gap-1 p-2 text-xs text-muted-foreground"><ImageOff className="size-5" />Image unavailable</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.src} alt={image.alt} loading={large ? "eager" : "lazy"}
          onLoad={() => setStatus("ready")} onError={() => setStatus("error")}
          className={large ? "relative max-h-[75dvh] max-w-full object-contain" : "relative h-full w-full object-contain"} />
      )}
    </span>
  );
}

export function AssistantImageGallery({ images }: { images: AssistantImage[] }) {
  const [active, setActive] = useState<AssistantImage | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1);
      const next = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta));
      if (next !== strip.scrollLeft) { event.preventDefault(); strip.scrollLeft = next; }
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [images.length]);
  if (!images.length) return null;
  return (
    <div className="mt-3 min-w-0 max-w-full" data-assistant-image-gallery>
      <div ref={stripRef} role="region" aria-label="Response images" tabIndex={0}
        className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-2 focus-visible:outline-2 focus-visible:outline-ring">
        {images.map((image) => (
          <button key={image.src} type="button" onClick={() => setActive(image)}
            aria-label={`Enlarge ${image.alt}`} title={image.alt}
            className="shrink-0 overflow-hidden rounded-lg border border-border/60 touch-manipulation hover:border-foreground/40 active:border-foreground/60 active:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
            <GalleryImage image={image} />
          </button>
        ))}
      </div>
      <ImageViewer image={active} onOpenChange={open => { if (!open) setActive(null); }}/>
    </div>
  );
}
