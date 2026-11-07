"use client";

import { useEffect, useRef } from "react";

/** Follow initial asynchronous layout until the visitor starts interacting. */
export function useShareInitialScroll(shareId: string, ready: boolean) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current, content = contentRef.current;
    if (!ready || !viewport || !content) return;
    let following = true, frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (following) viewport.scrollTop = viewport.scrollHeight; });
    };
    const stop = () => { following = false; cancelAnimationFrame(frame); };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) stop(); };
    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home", "End", "ArrowDown", "PageDown", " "].includes(event.key)) stop();
    };
    const observer = new ResizeObserver(scroll);
    observer.observe(content);
    observer.observe(viewport);
    viewport.addEventListener("load", scroll, true);
    viewport.addEventListener("wheel", wheel, { passive: true });
    viewport.addEventListener("touchstart", stop, { passive: true });
    viewport.addEventListener("pointerdown", stop, { passive: true });
    window.addEventListener("keydown", key);
    scroll();
    return () => {
      stop(); observer.disconnect();
      viewport.removeEventListener("load", scroll, true);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("touchstart", stop);
      viewport.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", key);
    };
  }, [shareId, ready]);
  return { viewportRef, contentRef };
}
