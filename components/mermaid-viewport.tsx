"use client";

import { useMemo } from "react";
import { Focus, Minus, Plus } from "lucide-react";
import { useInfiniteViewport } from "@/components/use-infinite-viewport";
import { mermaidSvgDimensions } from "@/lib/mermaid";
import { cn } from "@/lib/utils";

export function MermaidViewport({ svg, fullscreen = false }: { svg: string; fullscreen?: boolean }) {
  const dimensions = useMemo(() => mermaidSvgDimensions(svg), [svg]);
  const { viewport, view, updateView, fit, zoom, panning, pointerHandlers } = useInfiniteViewport(
    dimensions?.width || 1, dimensions?.height || 1, Boolean(dimensions),
    { minimumZoom: 0.01, fitPadding: 48, maxFitZoom: 1 },
  );
  return <div className={cn("relative min-h-0", fullscreen ? "flex flex-1" : "h-[360px] sm:h-[420px]")}>
    <div ref={viewport} role="region" aria-label="Mermaid diagram canvas" tabIndex={0}
      data-mermaid-viewport data-zoom={view.zoom}
      className={cn("relative h-full min-h-0 w-full flex-1 touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", panning ? "cursor-grabbing" : "cursor-grab")}
      style={{ backgroundColor: "var(--background)", backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 24%, transparent) 1px, transparent 1px)",
        backgroundSize: "24px 24px", backgroundPosition: view.x + "px " + view.y + "px" }}
      {...pointerHandlers}
      onKeyDown={event => {
        const movement: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (movement[event.key]) {
          const [x, y] = movement[event.key]; updateView(current => ({ ...current, x: current.x + x, y: current.y + y }));
        } else if (event.key === "+" || event.key === "=") zoom(1.2);
        else if (event.key === "-") zoom(1 / 1.2);
        else if (event.key === "0" || event.key === "Home") fit();
        else return;
        event.preventDefault(); event.stopPropagation();
      }}>
      <div className="mermaid-diagram absolute left-0 top-0 origin-top-left"
        style={{ width: dimensions?.width, height: dimensions?.height, transform: "translate(" + view.x + "px," + view.y + "px) scale(" + view.zoom + ")" }}
        dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
    <div role="group" aria-label="Diagram zoom controls" className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border/60 bg-background/95 p-1 shadow-sm">
      <button type="button" className="flex size-8 items-center justify-center rounded hover:bg-muted" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}><Minus className="size-4"/></button>
      <output className="min-w-12 text-center text-xs tabular-nums" aria-label="Zoom level">{Math.round(view.zoom * 100)}%</output>
      <button type="button" className="flex size-8 items-center justify-center rounded hover:bg-muted" aria-label="Zoom in" onClick={() => zoom(1.2)}><Plus className="size-4"/></button>
      <button type="button" className="flex size-8 items-center justify-center rounded hover:bg-muted" aria-label="Fit diagram" title="Fit diagram (0)" onClick={fit}><Focus className="size-4"/></button>
    </div>
  </div>;
}
