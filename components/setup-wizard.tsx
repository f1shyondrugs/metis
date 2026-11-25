"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OnboardingStage, OnboardingProgress } from "@/components/onboarding-stage";
import { resolveSetupStep } from "@/lib/setup-step";
import { SetupDisclosure } from "@/components/setup-disclosure";
import { SetupPublicUrlCheck } from "@/components/setup-public-url-check";

const ACCOUNT_STEPS = [
  { id: "token", label: "Operator setup token", description: "Enter the one-time token from your Metis server." },
  { id: "username", label: "Admin username", description: "Choose a username for your Metis admin account." },
  { id: "password", label: "Password", description: "Choose a password with at least 8 characters." },
  { id: "agent-user", label: "Run agents as", description: "Enter an existing OS username on this server. It can be different from your Metis username." },
] as const;

const STEPS = [...ACCOUNT_STEPS, { id: "public-url", label: "Public URL" }];

export function SetupWizard({ open, hasUsers, onFinished }: {
  open: boolean; hasUsers: boolean; onFinished: () => void;
}) {
  const formId = useId();
  const fieldId = useId();
  const [accountIndex, setAccountIndex] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [osUsername, setOsUsername] = useState("");
  const [accountCreated, setAccountCreated] = useState(hasUsers);
  const [signInRequired, setSignInRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingUrl, setCheckingUrl] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  function clearAccountInputs() {
    setUsername(""); setPassword(""); setSetupToken(""); setOsUsername("");
  }

  useEffect(() => {
    if (!open || hasUsers) {
      clearAccountInputs();
      setAccountIndex(0);
      setError("");
    }
    if (hasUsers) setAccountCreated(true);
  }, [open, hasUsers]);

  const showAdmin = resolveSetupStep(hasUsers || accountCreated) === "admin" && !signInRequired;
  const accountStep = ACCOUNT_STEPS[accountIndex]!;
  if (!open) return null;

  async function setupRequest(payload: object) {
    const response = await fetch("/api/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    return { response, body };
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current || signInRequired) return;
    setError("");
    if (showAdmin && accountStep.id === "username") {
      const candidate = username.trim();
      if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(candidate)) {
        setError("Use 3–64 letters, numbers, dots, underscores or hyphens.");
        return;
      }
      setUsername(candidate);
      setAccountIndex(2);
      return;
    }
    if (showAdmin && accountStep.id === "password") {
      if (password.length < 8) {
        setError("Enter at least 8 characters.");
        return;
      }
      setAccountIndex(3);
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      if (!showAdmin) {
        const { response, body } = await setupRequest({ action: "complete" });
        if (!response.ok) throw new Error(body.error || "Could not finish setup. Try Finish again.");
        try { window.sessionStorage.removeItem("metis-setup-step"); } catch { /* Optional legacy state. */ }
        onFinished();
        return;
      }
      const tokenStep = accountStep.id === "token";
      const agentAccount = osUsername.trim();
      if (!tokenStep && !agentAccount) throw new Error("Enter the OS username that will run agents.");
      const { response, body } = await setupRequest(tokenStep
        ? { action: "check-token", setupToken }
        : { action: "bootstrap", setupToken, username, password, osUsername: agentAccount });
      if (!response.ok) {
        if (response.status === 409) {
          setSignInRequired(true);
          clearAccountInputs();
          throw new Error("An account already exists or the setup token has been used. Continue to sign in.");
        }
        if (response.status === 403 && !tokenStep) {
          setSetupToken("");
          setAccountIndex(0);
        }
        throw new Error(body.error || (tokenStep ? "Could not check the setup token. Try again." : "Could not create the admin account."));
      }
      if (tokenStep) {
        setAccountIndex(1);
      } else {
        // URL checks and completion use the authenticated session, never the bootstrap secrets.
        clearAccountInputs();
        setAccountCreated(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish setup.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const inputProps = {
    id: fieldId, className: "h-11", required: true, autoFocus: true, disabled: busy,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldId + "-error" : undefined,
  };
  const index = showAdmin ? accountIndex : ACCOUNT_STEPS.length;
  return <OnboardingStage transitionKey={signInRequired ? "sign-in" : STEPS[index]?.id} eyebrow={signInRequired ? "" : `Step ${index + 1} of ${STEPS.length}`}
    title={signInRequired ? "Sign in to continue" : showAdmin ? accountStep.label : "What's your public URL?"}
    description={signInRequired ? "Sign in as the admin to finish setup." : showAdmin ? accountStep.description : "What address do you use to open Metis? This is where your share links will point."}
    progress={!signInRequired && <OnboardingProgress steps={STEPS} index={index}/>}
    footer={<>
      {showAdmin && accountIndex > 0 && <Button type="button" variant="ghost" disabled={busy}
        onClick={() => { setError(""); setAccountIndex(accountIndex - 1); }}>Back</Button>}
      <Button type={showAdmin ? "submit" : "button"}
        form={showAdmin ? formId : undefined} disabled={busy || checkingUrl}
        onClick={signInRequired ? () => window.location.reload() : !showAdmin ? () => void submit() : undefined}>
        {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin"/> : null}
        {signInRequired ? "Sign in" : showAdmin ? accountStep.id === "agent-user" ? "Create admin" : "Continue" : "Finish"}
        {!busy ? <ArrowRight aria-hidden="true" className="size-4"/> : null}
      </Button>
    </>}>
    {error ? <p id={fieldId + "-error"} role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
    {showAdmin ? <form id={formId} onSubmit={event => void submit(event)} className="grid gap-4" aria-busy={busy}>
      <label htmlFor={fieldId} className="sr-only">{accountStep.label}</label>
      {accountStep.id === "token" && <>
        <Input {...inputProps} type="password" value={setupToken} onChange={event => setSetupToken(event.target.value)}
          autoComplete="off" spellCheck={false}/>
        <SetupDisclosure label="Where to find the setup token">
          Ask your server operator for the one-time token from <code>data/setup-token</code> (or <code>setup-token</code> in <code>CHAT_DATA_DIR</code>), or <code>AI_CHAT_SETUP_TOKEN</code>.
        </SetupDisclosure>
      </>}
      {accountStep.id === "username" && <Input {...inputProps} value={username} onChange={event => setUsername(event.target.value)}
        autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64}/>}
      {accountStep.id === "password" && <Input {...inputProps} type="password" value={password} onChange={event => setPassword(event.target.value)}
        autoComplete="new-password" minLength={8}/>}
      {accountStep.id === "agent-user" && <Input {...inputProps} value={osUsername} onChange={event => setOsUsername(event.target.value)}
        autoComplete="off" autoCapitalize="none" spellCheck={false}/>}
    </form> : !signInRequired ? <SetupPublicUrlCheck disabled={busy} onCheckingChange={setCheckingUrl} /> : null}
  </OnboardingStage>;
}
