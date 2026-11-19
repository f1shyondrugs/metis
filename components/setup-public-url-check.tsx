"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetupDisclosure } from "@/components/setup-disclosure";
import { usePublicBaseUrl, useUpdatePublicBaseUrl } from "@/components/public-base-url";
import { resolvePublicBaseUrl, type PublicBaseCheck, type PublicBaseUrl } from "@/lib/public-base-url";

const TOAST_ID = "setup-public-url-verified";

function checkError(result: PublicBaseCheck) {
  switch (result.state) {
    case "verified": return "";
    case "other_instance": return "This address goes to a different Metis server.";
    case "not_metis": return "The address responded, but we couldn’t verify that it runs Metis.";
    case "redirect": return "This address redirects. Enter the final address that opens Metis.";
    case "http_error": return `The address returned HTTP ${result.status}. Check your proxy and access rules.`;
    case "unreachable": return "Metis couldn’t reach this address. Check the URL, DNS and HTTPS certificate.";
    case "https_required": return "Enter an HTTPS address for public sharing.";
    case "unsafe_url": return "Enter a publicly reachable address, not a private or local address.";
    default: return "Enter the full address, including https://.";
  }
}

export function SetupPublicUrlCheck({ disabled, onCheckingChange }: { disabled: boolean; onCheckingChange: (checking: boolean) => void }) {
  const base = usePublicBaseUrl();
  const updateBase = useUpdatePublicBaseUrl();
  const [url, setUrl] = useState("url" in base ? base.url : "");
  const panel = useRef<HTMLFormElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  useEffect(() => {
    if (document.activeElement === document.body) {
      panel.current?.closest(".onboarding-shell")?.querySelector<HTMLElement>("[data-onboarding-heading]")?.focus({ preventScroll: true });
    }
    return () => pending.current?.abort();
  }, []);

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || disabled || pending.current) return;
    const input = resolvePublicBaseUrl(url);
    setVerified(false); setError(""); toast.dismiss(TOAST_ID);
    if (!("url" in input)) { setError("Enter the full address, including https://."); return; }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); onCheckingChange(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action: "check-public-url", publicUrl: input.url }),
      });
      const body = await response.json().catch(() => ({})) as { check?: PublicBaseCheck; base?: PublicBaseUrl; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !body.check) throw new Error(body.error || "Could not check the app URL. Try again.");
      if (body.check.state !== "verified") { setError(checkError(body.check)); return; }
      const confirmed = body.base;
      if (!confirmed || !("url" in confirmed)) throw new Error("Metis could not save this address. Try again.");
      updateBase(confirmed);
      setUrl(confirmed.url);
      setVerified(true);
      if (confirmed.state === "local") {
        toast.success("Local URL verified", { id: TOAST_ID, description: "This address won’t be used for share links." });
      } else {
        toast.success("Public URL verified", { id: TOAST_ID, description: "Saved for your share links." });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check the app URL.");
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(false); onCheckingChange(false); }
    }
  }

  return <form ref={panel} className="space-y-4" onSubmit={check} noValidate>
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">Server address</label>
      <Input id={id} type="url" inputMode="url" autoComplete="url" spellCheck={false}
        placeholder="https://metis.example.com" className="h-11" value={url} disabled={disabled || busy}
        aria-invalid={Boolean(error)} aria-describedby={error ? id + "-help " + id + "-error" : id + "-help"}
        onChange={event => { setUrl(event.target.value); setVerified(false); setError(""); toast.dismiss(TOAST_ID); }}/>
      <p id={id + "-help"} className="text-sm text-muted-foreground">
        {url.trim() ? "A new address is saved after a successful check." : "You can finish setup without a public URL."}
      </p>
      {error ? <p id={id + "-error"} role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
    <div className="flex items-center gap-2">
      <Button type="submit" className="min-h-11" variant="outline" disabled={disabled || busy || !url.trim()}>
        {busy ? "Checking…" : "Check URL"}
      </Button>
      <span data-url-verified={verified} role={verified ? "img" : undefined}
        aria-label={verified ? "URL verified" : undefined} aria-hidden={!verified}
        className="grid size-6 shrink-0 place-items-center text-emerald-600 dark:text-emerald-400 scale-75 opacity-0 transition-[opacity,scale] duration-200 ease-out data-[url-verified=true]:scale-100 data-[url-verified=true]:opacity-100 motion-reduce:transition-none">
        <Check className="size-5" aria-hidden="true"/>
      </span>
    </div>
    <SetupDisclosure label="How do I change this?">
      Edit the address above and run Check URL. If you change <code>AI_CHAT_PUBLIC_URL</code> in your server’s environment instead, restart the Metis web service to load it.
    </SetupDisclosure>
  </form>;
}
