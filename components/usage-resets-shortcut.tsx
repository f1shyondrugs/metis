"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UsageResetsPanel } from "@/components/usage-resets-panel";
import type { UsageProvider } from "@/lib/usage-display";

export function UsageResetsShortcut({ provider, onClick }: { provider?: UsageProvider | null; onClick: () => void }) {
  const value = provider?.status === "live" ? provider.extra?.resetCredits : null;
  const count = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("en") : "—";
  return <button type="button" className="inline-flex min-h-7 items-center whitespace-nowrap rounded-md text-[11px] font-normal tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClick}>
    Usage Resets ({count})
  </button>;
}

export function UsageResetsEntry() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
      Usage Resets <ChevronRight className="size-4" aria-hidden="true" />
    </button>
    <UsageResetsDialog open={open} onOpenChange={setOpen} />
  </>;
}

export function UsageResetsDialog({ provider, open, onOpenChange, onCloseFocus }: { provider?: UsageProvider | null; open: boolean; onOpenChange: (open: boolean) => void; onCloseFocus?: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { if (onCloseFocus) { event.preventDefault(); onCloseFocus(); } }}>
      <DialogHeader className="sr-only"><DialogTitle>Usage Resets</DialogTitle><DialogDescription>Available reset credits and request history. Using a reset requires a separate confirmation.</DialogDescription></DialogHeader>
      {open ? <div className="min-w-0 pt-4"><UsageResetsPanel key={provider?.connectionId || "default"} initialConnectionId={provider?.connectionId} /></div> : null}
    </DialogContent>
  </Dialog>;
}
