"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

import { desktopBridge } from "@/lib/desktop-bridge";

export function DesktopDeviceSettings() {
  const [available, setAvailable] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setAvailable(Boolean(desktopBridge())); }, []);
  if (!available) return null;

  async function open() {
    const bridge = desktopBridge();
    if (!bridge) return;
    setOpening(true);
    setError("");
    try { await bridge.openDeviceSettings(); }
    catch { setError("Could not open Remote Client Device Settings. Try again."); }
    finally { setOpening(false); }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="outline" size="action" onClick={() => void open()} disabled={opening}>
        <Monitor data-icon="inline-start" aria-hidden="true" />
        {opening ? "Opening…" : "Open Remote Client Device Settings"}
      </Button>
      {error ? <p role="alert" className="max-w-xs text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
