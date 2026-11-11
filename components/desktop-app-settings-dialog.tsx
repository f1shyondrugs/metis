"use client";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DesktopClientSettings } from "@/components/desktop-client-settings";
export function DesktopAppSettingsDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="gap-0 p-0 sm:max-w-xl">
    <DialogHeader className="border-b border-border px-4 py-4 sm:px-6"><DialogTitle>App settings</DialogTitle><DialogDescription className="text-xs">Preferences for this device’s Metis app and Remote Client.</DialogDescription></DialogHeader>
    <DesktopClientSettings />
  </DialogContent></Dialog>;
}
