"use client";
import { useEffect, useState } from "react";
import type { DesktopShortcuts } from "@/lib/desktop-assistant";

export type LocalDeviceState = {
  paired?: boolean; clientId?: string; connection?: string; permissionMode?: string;
  platform?: string; version?: string; hideOverlayFromCapture?: boolean; autostartEnabled?: boolean;
  fileDrop?: { available: boolean; error: string };
  appUpdate?: { phase: string; available: boolean; version: string; message: string };
  assistant?: { hotkey: string; shortcuts?:DesktopShortcuts; defaults?:DesktopShortcuts; hotkeyAvailable: boolean; error?: string };
};
export type DesktopBridge = {
  openDeviceSettings: () => Promise<void>;
  deviceState?: () => Promise<LocalDeviceState>;
  setOverlayCaptureHidden?: (hidden:boolean) => Promise<boolean>;
  setAutostart?: (enabled:boolean) => Promise<boolean>;
  checkUpdates?: () => Promise<string>;
  onFilesDropped?: (callback:(payload:{files:Array<{name:string;bytes:Uint8Array;lastModified:number}>;point:{x:number;y:number}})=>void) => (()=>void);
  openAssistant?: () => Promise<void>;
  setShortcuts?: (value:DesktopShortcuts) => Promise<DesktopShortcuts>;
  setShortcutCapture?: (active:boolean) => Promise<void>;
};
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as Window & { metisApp?: DesktopBridge }).metisApp;
  return typeof bridge?.openDeviceSettings === "function" ? bridge : undefined;
}
export function useDesktopAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => { setAvailable(Boolean(desktopBridge())); }, []);
  return available;
}
