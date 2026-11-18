"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SetupDisclosure } from "@/components/setup-disclosure";
import { usePublicBaseUrl } from "@/components/public-base-url";
import type { PublicBaseCheck } from "@/lib/public-base-url";

function checkMessage(result: PublicBaseCheck, local: boolean) {
  switch (result.state) {
    case "verified": return local
      ? "This Metis instance responded. This local URL is not used for public links."
      : "Verified. This address reaches this Metis server.";
    case "other_instance": return "This address goes to a different Metis server.";
    case "not_metis": return "The address responded, but we couldn’t verify that it runs Metis.";
    case "redirect": return `The URL redirects (HTTP ${result.status}). Configure the final app address instead.`;
    case "http_error": return `The URL returned HTTP ${result.status}. Check your proxy and access rules.`;
    case "unreachable": return "The server could not reach this URL. Check DNS, TLS and your proxy.";
    case "unset":
    case "invalid": return "Configure AI_CHAT_PUBLIC_URL and reload setup before checking.";
  }
}

export function SetupPublicUrlCheck({ disabled }: { disabled: boolean }) {
  const base = usePublicBaseUrl();
  const panel = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublicBaseCheck | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (document.activeElement === document.body) {
      panel.current?.closest(".onboarding-shell")?.querySelector<HTMLElement>("[data-onboarding-heading]")?.focus({ preventScroll: true });
    }
    return () => pending.current?.abort();
  }, []);
  const url = "url" in base ? base.url : null;

  async function check() {
    if (!url || disabled || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setResult(null); setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "check-public-url" }),
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

  return <div ref={panel} className="space-y-4">
    <dl className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <dt className="text-sm text-muted-foreground">Server address</dt>
      <dd className="mt-1 min-w-0 break-all text-sm font-medium text-foreground">
        {url ?? (base.state === "invalid" ? "Invalid address" : "No public address set")}
      </dd>
    </dl>
    {base.state === "local" ? <p className="text-sm text-muted-foreground">This address only works on the server itself. It won’t be used for share links.</p> : null}
    {url ? <div>
      <Button type="button" className="min-h-11" variant="outline" disabled={disabled || busy} onClick={() => void check()}>
        {busy ? "Checking…" : "Check URL"}
      </Button>
      <div role="status" className={result?.state === "verified" ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
        {busy || result ? <p className="mt-2">{busy ? "Checking from your Metis server…" : result ? checkMessage(result, base.state === "local") : null}</p> : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div> : <p className="text-sm text-muted-foreground">You can finish setup without a public URL and add one later.</p>}
    <SetupDisclosure label="How do I change this?">
      Set <code>AI_CHAT_PUBLIC_URL</code> in your server configuration, or use <code>--public-url</code> when installing. Restart your Metis web server, then open setup again.
    </SetupDisclosure>
  </div>;
}
