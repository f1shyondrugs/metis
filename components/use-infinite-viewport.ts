"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { pinchDistance, pinchMidpoint, viewAfterZoom, type NotesView } from "@/lib/notes-gestures";

import { viewAfterWheel, viewAfterPinch } from "@/lib/infinite-viewport";

type Point = { clientX: number; clientY: number };
type Gesture =
  | { type: "pan"; origin: NotesView; point: Point }
  | { type: "pinch"; origin: NotesView; midpoint: Point; distance: number };

/** Notes-style camera: unbounded panning and anchored zoom, independent of live data updates. */
export function useInfiniteViewport(contentWidth: number, contentHeight: number, ready: boolean, options?: { minimumZoom?: number; fitPadding?: number; maxFitZoom?: number }) {
  const minimumZoom = options?.minimumZoom ?? 0.2;
  const fitPadding = options?.fitPadding;
  const maxFitZoom = options?.maxFitZoom ?? 1.15;
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<NotesView>({ x: 0, y: 0, zoom: 1 });
  const current = useRef(view);
  const initialized = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const [panning, setPanning] = useState(false);

  const updateView = useCallback((update: NotesView | ((previous: NotesView) => NotesView)) => {
    const next = typeof update === "function" ? update(current.current) : update;
    current.current = next;
    setView(next);
  }, []);
  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const zoom = Math.max(minimumZoom, Math.min(maxFitZoom, Math.max(1, size.width - (fitPadding ?? 24)) / contentWidth, Math.max(1, size.height - (fitPadding ?? 100)) / contentHeight));
    updateView({ zoom, x: (size.width - contentWidth * zoom) / 2, y: (size.height - contentHeight * zoom) / 2 });
  }, [contentWidth, contentHeight, size.width, size.height, minimumZoom, fitPadding, maxFitZoom, updateView]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !ready) return;
    let previous = { width: 0, height: 0 };
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (previous.width && previous.height) {
        updateView(view => ({ ...view, x: view.x + (next.width - previous.width) / 2, y: view.y + (next.height - previous.height) / 2 }));
      }
      previous = next;
      setSize(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, updateView, minimumZoom]);

  useEffect(() => {
    if (!ready) initialized.current = false;
    if (ready && size.width && size.height && !initialized.current) {
      initialized.current = true;
      fit();
    }
  }, [ready, size.width, size.height, fit]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !ready) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      updateView(view => viewAfterWheel(view, event, { x: event.clientX - rect.left, y: event.clientY - rect.top }, element.clientHeight, minimumZoom));
    };
    const reset = () => { pointers.current.clear(); gesture.current = null; setPanning(false); };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      reset();
    };
  }, [ready, updateView, minimumZoom]);

  const startGesture = () => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      gesture.current = { type: "pinch", origin: current.current, midpoint: pinchMidpoint(points[0], points[1]), distance: Math.max(1, pinchDistance(points[0], points[1])) };
    } else if (points.length === 1) {
      gesture.current = { type: "pan", origin: current.current, point: points[0] };
    } else {
      gesture.current = null;
    }
    setPanning(points.length > 0);
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    startGesture();
  };

  return {
    viewport, view, size, updateView, fit, panning,
    zoom: (factor: number) => updateView(view => viewAfterZoom(view, size.width / 2, size.height / 2, view.zoom * factor, minimumZoom)),
    pointerHandlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target as Element).closest("button")) return;
        pointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
        startGesture();
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        const active = gesture.current;
        const points = [...pointers.current.values()];
        if (active?.type === "pinch" && points.length >= 2) {
          updateView(viewAfterPinch(active.origin, active, points[0], points[1], event.currentTarget.getBoundingClientRect(), minimumZoom));
        } else if (active?.type === "pan" && points.length === 1) {
          updateView({ ...active.origin, x: active.origin.x + points[0].clientX - active.point.clientX, y: active.origin.y + points[0].clientY - active.point.clientY });
        }
      },
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onLostPointerCapture: endPointer,
    },
  };
}
