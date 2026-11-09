"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  destructive = true,
  secondaryLabel,
  onSecondary,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const confirming = useRef(false);
  useEffect(() => { if (open) setError(""); }, [open]);

  async function confirm() {
    if (confirming.current) return;
    confirming.current = true;
    setLoading(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete this action. Please retry.");
    } finally {
      confirming.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !loading && onOpenChange(nextOpen)}>
      <DialogContent closeButtonDisabled={loading} aria-busy={loading} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-sm">
        <DialogHeader className="min-h-0 overflow-y-auto p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="shrink-0 px-4 pb-4 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
        <DialogFooter className="mx-0 mb-0 shrink-0">
          <Button variant="ghost" disabled={loading} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button variant="outline" disabled={loading} onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
          <Button variant={destructive ? "destructive" : "default"} disabled={loading} onClick={() => void confirm()}>
            {loading ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
