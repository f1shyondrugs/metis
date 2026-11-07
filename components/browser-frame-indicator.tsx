"use client";

import { useEffect, useState, type RefObject } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function BrowserFrameIndicator({ updatedAtRef }: { updatedAtRef: RefObject<number | null> }) {
  const [open, setOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setUpdatedAt(updatedAtRef.current);
    refresh();
    const timer = window.setInterval(refresh, 250);
    return () => window.clearInterval(timer);
  }, [open, updatedAtRef]);

  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={(nextOpen) => {
        if (nextOpen) setUpdatedAt(updatedAtRef.current);
        setOpen(nextOpen);
      }}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Last browser image update"
            className="absolute bottom-1 left-1 flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onKeyDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          {updatedAt === null ? "No browser image received yet" : (
            <>Last image update: <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleString("en")}</time></>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
