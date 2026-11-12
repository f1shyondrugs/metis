"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingStage, OnboardingProgress } from "@/components/onboarding-stage";
import { resolveSetupStep } from "@/lib/setup-step";

export function SetupWizard({ open, hasUsers, onFinished }: {
  open: boolean; hasUsers: boolean; onFinished: () => void;
}) {
  const formId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [accountCreated, setAccountCreated] = useState(hasUsers);
  const [signInRequired, setSignInRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => { if (hasUsers) setAccountCreated(true); }, [hasUsers]);
  const step = resolveSetupStep(hasUsers || accountCreated);
  if (!open) return null;

  async function complete() {
    const response = await fetch("/api/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not finish setup. Try Continue again.");
    try { window.sessionStorage.removeItem("metis-setup-step"); } catch { /* Optional legacy state. */ }
    onFinished();
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      if (step === "admin") {
        const response = await fetch("/api/setup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bootstrap", setupToken, username, password }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          if (response.status === 409) {
            setSignInRequired(true); setPassword(""); setSetupToken("");
            throw new Error("An account already exists. Continue to sign in.");
          }
          throw new Error(body.error || "Could not create the admin account.");
        }
        // A completion retry must never recreate the admin or resubmit secrets.
        setAccountCreated(true); setUsername(""); setPassword(""); setSetupToken("");
      }
      await complete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish setup.");
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  return <OnboardingStage transitionKey={signInRequired ? "sign-in" : step} eyebrow=""
    title={signInRequired ? "Sign in to continue" : step === "admin" ? "Create your admin account" : "Your account is ready"}
    description={step === "admin" && !signInRequired ? "Everything else is in Settings." : "Continue into your workspace."}
    progress={<OnboardingProgress steps={[{id:"admin",label:"Admin account"}]} index={0}/>}
    footer={<Button type={step === "admin" && !signInRequired ? "submit" : "button"}
      form={step === "admin" && !signInRequired ? formId : undefined} disabled={busy}
      onClick={signInRequired ? () => window.location.reload() : step === "complete" ? () => void submit() : undefined}>
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin"/> : null}
      Continue {!busy ? <ArrowRight aria-hidden="true" className="size-4"/> : null}
    </Button>}>
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {step === "admin" && !signInRequired ? <form id={formId} onSubmit={event => void submit(event)} className="grid gap-4" aria-busy={busy}>
      <label className="grid gap-2 text-sm">Admin username
        <Input className="h-11" value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" autoFocus
          required minLength={3} maxLength={64} disabled={busy}/>
      </label>
      <label className="grid gap-2 text-sm">Password
        <Input className="h-11" type="password" value={password} onChange={event=>setPassword(event.target.value)}
          autoComplete="new-password" required minLength={8} disabled={busy}/>
      </label>
      <label className="grid gap-2 text-sm">Operator setup token
        <Input className="h-11" type="password" value={setupToken} onChange={event=>setSetupToken(event.target.value)}
          autoComplete="off" spellCheck={false} required disabled={busy} aria-describedby="setup-token-help"/>
      </label>
      <details id="setup-token-help" className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Where to find the setup token</summary>
        <p className="mt-2">Ask your server operator for the one-time token from data/setup-token (or setup-token in CHAT_DATA_DIR), or AI_CHAT_SETUP_TOKEN.</p>
      </details>
    </form> : null}
  </OnboardingStage>;
}
