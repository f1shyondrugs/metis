"use client";
import { useEffect, useState } from "react";
import type { DesktopShortcuts } from "@/lib/desktop-assistant";

export type LocalDeviceState = {
  paired?: boolean; clientId?: string; connection?: string; permissionMode?: string;
  platform?: string; version?: string; hideOverlayFromCapture?: boolean;
  assistant?: { hotkey: string; shortcuts?:DesktopShortcuts; defaults?:DesktopShortcuts; hotkeyAvailable: boolean; error?: string };
};
export type DesktopBridge = {
  openDeviceSettings: () => Promise<void>;
  deviceState?: () => Promise<LocalDeviceState>;
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
