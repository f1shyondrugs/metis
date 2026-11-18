"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePublicBaseUrl } from "@/components/public-base-url";
import type { PublicBaseCheck } from "@/lib/public-base-url";

function checkMessage(result: PublicBaseCheck, local: boolean) {
  switch (result.state) {
    case "verified": return local
      ? "This Metis instance responded. This local URL is not used for public links."
      : "Verified: this URL reaches this Metis instance from the server.";
    case "other_instance": return "A different Metis instance answered. Check your reverse proxy or DNS.";
    case "not_metis": return "The URL responded, but did not return a Metis instance proof. Check the app address and proxy route.";
    case "redirect": return `The URL redirects (HTTP ${result.status}). Configure the final app address instead.`;
    case "http_error": return `The URL returned HTTP ${result.status}. Check your proxy and access rules.`;
    case "unreachable": return "The server could not reach this URL. Check DNS, TLS and your proxy.";
    case "unset":
    case "invalid": return "Configure AI_CHAT_PUBLIC_URL and reload setup before checking.";
  }
}

export function SetupPublicUrlCheck({ setupToken, disabled }: { setupToken: string; disabled: boolean }) {
  const base = usePublicBaseUrl();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublicBaseCheck | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => pending.current?.abort(), []);
  const url = "url" in base ? base.url : null;

  async function check() {
    if (!url || !setupToken.trim() || disabled || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setResult(null); setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "check-public-url", setupToken }),
      });
      const body = await response.json().catch(() => ({})) as { check?: PublicBaseCheck; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !body.check) throw new Error(body.error || "Could not check the app URL. Try again.");
      setResult(body.check);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check the app URL.");
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false); }
    }
  }

  return <details className="text-xs text-muted-foreground">
    <summary className="cursor-pointer">Public app URL</summary>
    <div className="mt-2 space-y-2">
      {url ? <>
        <p className="break-all text-foreground">{url}</p>
        {base.state === "local" ? <p>This is a local-only address. Set a reachable app address to create public links.</p> : null}
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy || !setupToken.trim()} onClick={() => void check()}>
          {busy ? "Checking…" : "Check URL"}
        </Button>
        {!setupToken.trim() ? <p>Enter the operator setup token above to check this address.</p> : null}
        <div role="status" className={result?.state === "verified" ? "text-foreground" : undefined}>
          {busy ? "Checking from the Metis server…" : result ? checkMessage(result, base.state === "local") : null}
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </> : <p>{base.state === "invalid" ? "The configured address is invalid." : "No public address is configured."} Set AI_CHAT_PUBLIC_URL or use the installer’s --public-url option. You can still continue setup.</p>}
    </div>
  </details>;
}
