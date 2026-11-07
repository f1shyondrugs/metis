"use client";
import { useEffect, useRef, useState } from "react";
import { chooseDesktopMonitor, type DesktopMonitor } from "@/lib/remote-desktop-view";

type Inventory = { deviceId: string | null; monitors: DesktopMonitor[]; selectionSupported: boolean; reason?: string; error: string; loaded: boolean };
const empty: Inventory = { deviceId: null, monitors: [], selectionSupported: false, error: "", loaded: false };

export function useDesktopMonitors({ active, deviceId, unavailable, retry }: {
  active: boolean; deviceId: string | null; unavailable: string | null; retry: number;
}) {
  const [inventory, setInventory] = useState<Inventory>(empty);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const choices = useRef(selectedIds);
  choices.current = selectedIds;
  useEffect(() => {
    if (!active || !deviceId || unavailable) return;
    let disposed = false, controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (disposed || document.hidden) return;
      controller?.abort();
      const current = new AbortController(); controller = current;
      try {
        const response = await fetch("/api/remote-clients/" + encodeURIComponent(deviceId) + "/desktop",
          { signal: current.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load monitors");
        if (disposed || current.signal.aborted) return;
        if (!Array.isArray(data.monitors) || typeof data.selectionSupported !== "boolean") throw new Error("Invalid monitor list");
        const monitors = data.monitors as DesktopMonitor[];
        if (data.selectionSupported && !monitors.length) throw new Error("No monitors are available on this device");
        const selected = chooseDesktopMonitor(monitors, choices.current[deviceId]);
        if (selected) setSelectedIds(previous => previous[deviceId] === selected.id ? previous : { ...previous, [deviceId]: selected.id });
        const next: Inventory = { deviceId, monitors, selectionSupported: data.selectionSupported, error: "", loaded: true,
          ...(typeof data.reason === "string" ? { reason: data.reason.slice(0, 300) } : {}) };
        setInventory(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } catch (error) {
        if (disposed || current.signal.aborted) return;
        setInventory({ deviceId, monitors: [], selectionSupported: false, loaded: true,
          error: error instanceof Error ? error.message : "Could not load monitors" });
      } finally {
        if (!disposed && controller === current && !current.signal.aborted && !document.hidden) timer = setTimeout(load, 15_000);
      }
    };
    const visibility = () => { clearTimeout(timer); controller?.abort(); if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [active, deviceId, unavailable, retry]);
  const current = inventory.deviceId === deviceId ? inventory : empty;
  const monitor = chooseDesktopMonitor(current.monitors, deviceId ? selectedIds[deviceId] : null);
  return {
    monitors: current.monitors, monitor,
    monitorId: current.selectionSupported ? monitor?.id ?? null : null,
    ready: current.loaded, selectionSupported: current.selectionSupported, error: current.error, reason: current.reason,
    selectMonitor(id: string) {
      if (deviceId && current.monitors.some(item => item.id === id)) {
        choices.current = { ...choices.current, [deviceId]: id };
        setSelectedIds(choices.current);
      }
    },
  };
}
