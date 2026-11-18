"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingStage, OnboardingProgress } from "@/components/onboarding-stage";
import { resolveSetupStep } from "@/lib/setup-step";
import { SetupDisclosure } from "@/components/setup-disclosure";
import { SetupPublicUrlCheck } from "@/components/setup-public-url-check";

const STEPS = [{id:"admin",label:"Admin account"}, {id:"public-url",label:"Public URL"}] as const;

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
  const showAdmin = step === "admin" && !signInRequired;
  if (!open) return null;

  async function complete() {
    const response = await fetch("/api/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not finish setup. Try Finish again.");
    try { window.sessionStorage.removeItem("metis-setup-step"); } catch { /* Optional legacy state. */ }
    onFinished();
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      if (!showAdmin) {
        await complete();
        return;
      }
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
      // URL checks and completion use the authenticated session, never the bootstrap secrets.
      setAccountCreated(true); setUsername(""); setPassword(""); setSetupToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish setup.");
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  return <OnboardingStage transitionKey={signInRequired ? "sign-in" : step} eyebrow=""
    title={signInRequired ? "Sign in to continue" : showAdmin ? "Create your admin account" : "What's your public URL?"}
    description={signInRequired ? "Sign in as the admin to finish setup." : showAdmin ? "This account manages your Metis server." : "What address do you use to open Metis? This is where your share links will point."}
    progress={<OnboardingProgress steps={STEPS} index={step === "public-url" ? 1 : 0}/>}
    footer={<Button type={showAdmin ? "submit" : "button"}
      form={showAdmin ? formId : undefined} disabled={busy}
      onClick={signInRequired ? () => window.location.reload() : !showAdmin ? () => void submit() : undefined}>
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin"/> : null}
      {showAdmin || signInRequired ? "Continue" : "Finish"} {!busy ? <ArrowRight aria-hidden="true" className="size-4"/> : null}
    </Button>}>
    {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {showAdmin ? <form id={formId} onSubmit={event => void submit(event)} className="grid gap-4" aria-busy={busy}>
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
          autoComplete="off" spellCheck={false} required disabled={busy}/>
      </label>
      <SetupDisclosure label="Where to find the setup token">
        Ask your server operator for the one-time token from <code>data/setup-token</code> (or <code>setup-token</code> in <code>CHAT_DATA_DIR</code>), or <code>AI_CHAT_SETUP_TOKEN</code>.
      </SetupDisclosure>
    </form> : !signInRequired ? <SetupPublicUrlCheck disabled={busy} /> : null}
  </OnboardingStage>;
}
