"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { Download, ImageOff, Maximize, Minimize, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { containedImageBounds, magnifierGeometry, magnifierZoom } from "@/lib/image-magnifier";
import { fileDownloadUrl } from "@/lib/file-types";

const actionClass = "flex size-10 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

/** Pointer motion only paints this leaf; it never rerenders the chat or dialog. */
export function ImageSurface({ src, alt, fullscreen = false, loading = "eager", allowHorizontalScroll = false, onDimensions }: { src: string; alt: string; fullscreen?: boolean; loading?: "eager" | "lazy"; allowHorizontalScroll?: boolean; onDimensions?: (width: number, height: number) => void }) {
  const helpId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null), imageRef = useRef<HTMLImageElement>(null);
  const lensRef = useRef<HTMLDivElement>(null), detailRef = useRef<HTMLImageElement>(null);
  const pointer = useRef<{ x: number; y: number; id: number | null } | null>(null);
  const zoom = useRef(2.5), frame = useRef<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const hide = useCallback(() => {
    pointer.current = null;
    if (lensRef.current) lensRef.current.style.opacity = "0";
  }, []);
  const paint = useCallback(() => {
    frame.current = null;
    const surface = surfaceRef.current, image = imageRef.current, lens = lensRef.current, detail = detailRef.current;
    if (!surface || !image || !lens || !detail || !pointer.current || !image.complete) return;
    const box = surface.getBoundingClientRect();
    const bounds = containedImageBounds(image.getBoundingClientRect(), image.naturalWidth, image.naturalHeight);
    const geometry = bounds && magnifierGeometry(bounds, box, pointer.current.x, pointer.current.y, zoom.current);
    if (!geometry) { lens.style.opacity = "0"; return; }
    Object.assign(lens.style, { opacity: "1", width: geometry.diameter + "px", height: geometry.diameter + "px",
      transform: `translate3d(${geometry.left}px,${geometry.top}px,0)` });
    Object.assign(detail.style, { width: geometry.width + "px", height: geometry.height + "px",
      transform: `translate3d(${geometry.imageLeft}px,${geometry.imageTop}px,0)` });
    lens.dataset.zoom = zoom.current.toFixed(2);
  }, []);
  const schedule = useCallback(() => { if (frame.current === null) frame.current = requestAnimationFrame(paint); }, [paint]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !imageRef.current) return;
      if (allowHorizontalScroll && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
      const image = imageRef.current;
      const bounds = containedImageBounds(image.getBoundingClientRect(), image.naturalWidth, image.naturalHeight);
      if (!bounds || !magnifierGeometry(bounds, surface.getBoundingClientRect(), event.clientX, event.clientY, zoom.current)) return;
      event.preventDefault();
      zoom.current = magnifierZoom(zoom.current, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1));
      if (pointer.current) { pointer.current.x = event.clientX; pointer.current.y = event.clientY; schedule(); }
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      surface.removeEventListener("wheel", wheel); window.removeEventListener("blur", hide); window.removeEventListener("resize", hide);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [allowHorizontalScroll, hide, schedule]);
  return <div ref={surfaceRef} data-image-surface tabIndex={0} role="group" aria-label={alt + " image preview"}
    aria-describedby={helpId} className="relative flex h-full min-h-0 w-full select-none items-center justify-center overflow-hidden focus-visible:outline-2 focus-visible:outline-ring"
    style={{ touchAction: fullscreen ? "none" : allowHorizontalScroll ? "manipulation" : "pan-y" }}
    onBlur={hide} onDragStart={e => e.preventDefault()}
    onPointerDown={e => {
      if (e.button !== 0 || status !== "ready") return;
      e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true });
      pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId); schedule();
    }}
    onPointerMove={e => { if (pointer.current?.id === e.pointerId) { pointer.current.x = e.clientX; pointer.current.y = e.clientY; schedule(); } }}
    onPointerUp={hide} onPointerCancel={hide} onLostPointerCapture={hide}
    onKeyDown={e => {
      if (e.key === "Escape") { if (pointer.current) { e.preventDefault(); e.stopPropagation(); hide(); } return; }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (pointer.current) hide();
        else { const b = e.currentTarget.getBoundingClientRect(); pointer.current = { x: b.left + b.width / 2, y: b.top + b.height / 2, id: null }; schedule(); }
      } else if (["+", "=", "-", "_"].includes(e.key)) {
        e.preventDefault(); zoom.current = magnifierZoom(zoom.current, e.key === "-" || e.key === "_" ? 120 : -120); schedule();
      } else if (pointer.current && e.key.startsWith("Arrow")) {
        e.preventDefault(); pointer.current.x += e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0;
        pointer.current.y += e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0; schedule();
      }
    }}>
    <span id={helpId} className="sr-only">Hold the image to magnify. Scroll to change magnification. Keyboard: Space to toggle the magnifier, plus or minus to zoom, arrow keys to move.</span>
    {status === "loading" && <span role="status" className="absolute text-xs text-muted-foreground">Loading image…</span>}
    {status === "error" ? <span role="alert" className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground"><ImageOff aria-hidden="true" className="size-6"/>Image unavailable. Download the original file.</span> :
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={imageRef} src={src} alt={alt} loading={loading} draggable={false} onLoad={e => { setStatus("ready"); onDimensions?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); }} onError={() => { hide(); setStatus("error"); }}
        className="h-full w-full object-contain" style={{ cursor: status === "ready" ? "zoom-in" : undefined }} />}
    <div ref={lensRef} data-image-magnifier aria-hidden="true" className="pointer-events-none absolute left-0 top-0 overflow-hidden rounded-full bg-background ring-2 ring-foreground/70" style={{ opacity: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={detailRef} src={src} alt="" loading={loading} draggable={false} className="absolute left-0 top-0 max-w-none" />
    </div>
  </div>;
}

export type ImageViewerHandle = { enterFullscreen: () => void };
export function ImageViewer({ image, onOpenChange, initialFullscreen = false, ref }: {
  image: { src: string; alt: string; name?: string } | null; onOpenChange: (open: boolean) => void; initialFullscreen?: boolean; ref?: Ref<ImageViewerHandle>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const imageSrc = image?.src;
  const [fullscreen, setFullscreen] = useState(initialFullscreen);
  const nativeEntered = useRef(false);
  const [dimensions, setDimensions] = useState<{ src: string; ratio: number } | null>(null);
  const enter = useCallback(() => {
    flushSync(() => setFullscreen(true));
    const node = contentRef.current;
    if (node?.requestFullscreen && document.fullscreenElement !== node) {
      void node.requestFullscreen().catch(() => { /* The viewport layout also works where native fullscreen is unavailable. */ });
    }
  }, []);
  useImperativeHandle(ref, () => ({ enterFullscreen: enter }), [enter]);
  const exit = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement === contentRef.current) void document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const node = contentRef.current;
    if (!imageSrc || !node) return;
    const changed = () => {
      if (document.fullscreenElement === node) { nativeEntered.current = true; setFullscreen(true); }
      else if (nativeEntered.current) { nativeEntered.current = false; setFullscreen(false); }
    };
    document.addEventListener("fullscreenchange", changed);
    if (initialFullscreen && node.requestFullscreen) void node.requestFullscreen().catch(() => {});
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
    };
  }, [imageSrc, initialFullscreen]);
  useEffect(() => {
    if (fullscreen) contentRef.current?.querySelector<HTMLButtonElement>("[aria-label='Exit fullscreen']")?.focus({ preventScroll: true });
  }, [fullscreen]);
  return <Dialog open={Boolean(image)} onOpenChange={open => { if (!open) exit(); onOpenChange(open); }}>
    <DialogContent ref={contentRef} showCloseButton={false} aria-describedby={undefined} data-image-viewer data-fullscreen={fullscreen}
      onEscapeKeyDown={e => { if (fullscreen) { e.preventDefault(); exit(); } }}
      className={fullscreen
        ? "inset-0 flex flex-col h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:animate-none data-closed:animate-none"
        : "flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"}>
      <div className={fullscreen ? "sr-only" : "flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-2"}>
        <DialogTitle className="min-w-0 flex-1 truncate pr-2">{image?.alt || "Image"}</DialogTitle>
        {!fullscreen && image && <>
          <a href={fileDownloadUrl(image.src)} download={image.name || image.alt} aria-label={"Download " + image.alt} title="Download image" className={actionClass}><Download className="size-4" aria-hidden="true"/></a>
          <button type="button" aria-label="Enter fullscreen" title="Fullscreen" onClick={enter} className={actionClass}><Maximize className="size-4" aria-hidden="true"/></button>
          <button type="button" aria-label="Close image" title="Close" onClick={() => { exit(); onOpenChange(false); }} className={actionClass}><X className="size-4" aria-hidden="true"/></button>
        </>}
      </div>
      {image && <div className={fullscreen ? "min-h-0 flex-1" : "min-h-0 shrink-0"}
        style={fullscreen ? undefined : {height:`max(8rem, min(calc(100dvh - 8rem), calc(min(calc(100vw - 2rem), 64rem) * ${dimensions?.src === image.src ? dimensions.ratio : 0.5625})))`}}>
        <ImageSurface key={image.src} src={image.src} alt={image.alt} fullscreen={fullscreen}
          onDimensions={(width,height)=>{if(width>0)setDimensions({src:image.src,ratio:height/width});}}/>
      </div>}
      {fullscreen ? <button type="button" aria-label="Exit fullscreen" title="Exit fullscreen" onClick={exit}
        className={actionClass + " absolute z-10 bg-background/90"}
        style={{ top: "max(12px, env(safe-area-inset-top))", right: "max(12px, env(safe-area-inset-right))" }}><Minimize className="size-4" aria-hidden="true"/></button>
        : <p className="shrink-0 border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">Hold to magnify · Scroll to zoom</p>}
    </DialogContent>
  </Dialog>;
}
