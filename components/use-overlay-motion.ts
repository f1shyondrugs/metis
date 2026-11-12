"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { OverlayItem } from "@/lib/desktop-overlay";
import { interpolateOverlayItem, motionEase, OVERLAY_MOTION } from "@/lib/overlay-motion";
import { useReducedMotion } from "@/components/use-chart-motion";

/** No exit retention: removing the owner cancels RAF and removes pixels immediately. */
export function useOverlayMotion(target: OverlayItem) {
  const reduced = useReducedMotion();
  const [painted, setPainted] = useState(target);
  const current = useRef(target);
  // Scene revisions also contain unchanged items; do not restart those animations.
  const signature = JSON.stringify(target);
  useLayoutEffect(() => {
    const next = JSON.parse(signature) as OverlayItem;
    if (reduced || current.current.type !== next.type) {
      current.current = next;
      setPainted(next);
      return;
    }
    const from = current.current;
    if (JSON.stringify(from) === signature) return;
    let frame = 0, start: number | undefined;
    const duration = next.type === "spotlight" ? OVERLAY_MOTION.dim : OVERLAY_MOTION.update;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      current.current = interpolateOverlayItem(from, next, motionEase(t));
      setPainted(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [signature, reduced]);
  // Reduced motion takes effect in the same render, without a trailing stale frame.
  return reduced ? target : painted;
}
