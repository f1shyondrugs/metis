"use client";
import { useEffect, useState } from "react";

export type LocalDeviceState = {
  paired?: boolean; clientId?: string; connection?: string; permissionMode?: string;
  platform?: string; version?: string; hideOverlayFromCapture?: boolean;
  assistant?: { hotkey: string; hotkeyAvailable: boolean; error?: string };
};
export type DesktopBridge = {
  openDeviceSettings: () => Promise<void>;
  deviceState?: () => Promise<LocalDeviceState>;
  openAssistant?: () => Promise<void>;
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
