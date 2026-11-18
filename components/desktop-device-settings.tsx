"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

import { desktopBridge } from "@/lib/desktop-bridge";

export function DesktopDeviceSettings({
  buttonLabel = "Open Remote Client Device Settings",
  buttonClassName,
}: {
  buttonLabel?: string;
  buttonClassName?: string;
}) {
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
    <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5">
      <Button type="button" variant="outline" size="action" className={buttonClassName} onClick={() => void open()} disabled={opening}>
        <Monitor data-icon="inline-start" aria-hidden="true" />
        {opening ? "Opening…" : buttonLabel}
      </Button>
      {error ? <p role="alert" className="max-w-xs text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function RemoteClientInstallActions({ installers }: {
  installers: ReadonlyArray<{ url: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {installers.map(({ url, label }) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-10">
          Download {label}
        </a>
      ))}
      <DesktopDeviceSettings
        buttonLabel="Open Remote Client Settings"
        buttonClassName="h-auto min-h-11 max-w-full whitespace-normal py-2 sm:min-h-10"
      />
    </div>
  );
}
