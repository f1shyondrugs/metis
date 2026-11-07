"use client";

import { useState, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SharedPreviewDialog({ title, onClose, actions, children }: {
  title: string; onClose: () => void; actions?: ReactNode; children: ReactNode;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className={cn(
      "grid h-dvh max-h-dvh w-screen max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:h-[90dvh] sm:max-w-5xl sm:rounded-xl",
      fullscreen && "sm:h-dvh sm:max-w-none sm:rounded-none",
    )}>
      <DialogHeader className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
        {actions}
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => setFullscreen(value => !value)}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
        <DialogClose asChild><Button size="icon-sm" variant="ghost" aria-label="Close preview"><X className="size-4" /></Button></DialogClose>
      </DialogHeader>
      <div data-share-preview-content className="min-h-0 min-w-0 overflow-auto overscroll-contain p-4 sm:p-6">{children}</div>
    </DialogContent>
  </Dialog>;
}
