"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";

export function UpdateInstallConfirmation({
  open,
  onOpenChange,
  target,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Install ${target}?`}
      description="This installs the server update and restarts Metis services. Metis may be briefly unavailable. Keep this page open."
      confirmLabel="Install and restart"
      destructive={false}
      onConfirm={onConfirm}
    />
  );
}
