"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function SettingsDialog({ open, onOpenChange, children, title = "Settings", description = "Manage your preferences, providers, and devices.", fullscreen = false, returnFocus, onAfterClose }: {
  open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
  title?: string; description?: string; fullscreen?: boolean;
  returnFocus?: () => HTMLElement | null; onAfterClose?: () => boolean;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={cn("flex h-[min(88dvh,56rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-4rem))]", fullscreen && "inset-0 h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none")}
      onOpenAutoFocus={() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { if (onAfterClose?.()) { event.preventDefault(); return; }
        const target = returnFocus ? returnFocus() : previousFocus.current;
        if (target?.isConnected) { event.preventDefault(); target.focus(); } }}>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      {children}
    </DialogContent>
  </Dialog>;
}
