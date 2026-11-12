"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { OnboardingStage, OnboardingProgress } from "@/components/onboarding-stage";
import { ProviderSetupDialog } from "@/components/provider-setup-dialog";
import { resolveSetupStep, type SetupStep } from "@/lib/setup-step";
import { OsUserField } from "@/components/os-user-field";

type OsPlatform = "linux" | "darwin" | "win32";
type OsUser = { username: string; home?: string };
type CreatedUser = { id: string; username: string; isAdmin: boolean };
const SETUP_STEP_STORAGE_KEY = "metis-setup-step";

function platformLabel(platform: OsPlatform) {
  return platform === "win32" ? "Windows user" : platform === "darwin" ? "Mac user" : "Linux user";
}

export function SetupWizard({
  open,
  hasUsers,
  onFinished,
}: {
  open: boolean;
  hasUsers: boolean;
  onFinished: () => void;
}) {
  const [step, setStep] = useState<SetupStep>(hasUsers ? "people" : "welcome");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [osUsername, setOsUsername] = useState("");
  const [platform, setPlatform] = useState<OsPlatform>("linux");
  const [osUsers, setOsUsers] = useState<OsUser[]>([]);
  const [osUsersState, setOsUsersState] = useState<"pending" | "loading" | "ready" | "error">("pending");
  const [osUsersError, setOsUsersError] = useState("");
  const [users, setUsers] = useState<CreatedUser[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let savedStep: string | null = null;
    try { savedStep = window.sessionStorage.getItem(SETUP_STEP_STORAGE_KEY); } catch { /* ignore */ }
    setStep((current) => resolveSetupStep(hasUsers, savedStep || current));
  }, [open, hasUsers]);

  function goToStep(nextStep: SetupStep) {
    try { window.sessionStorage.setItem(SETUP_STEP_STORAGE_KEY, nextStep); } catch { /* ignore */ }
    setStep(nextStep);
  }

  useEffect(() => {
    if (!open || step !== "people") return;
    void fetch("/api/setup", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          platform?: OsPlatform;
          osUsers?: OsUser[];
          hasUsers?: boolean;
          suggestedOsUsername?: string;
          osUsersAvailable?: boolean;
        };
        setPlatform(body.platform || "linux");
        if (body.osUsersAvailable) {
          setOsUsers(body.osUsers || []);
          setOsUsersState("ready");
          setOsUsername((current) => current || body.suggestedOsUsername || "");
        }
      })
      .catch(() => undefined);
    if (hasUsers && users.length === 0) {
      void fetch("/api/admin/users", { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json().catch(() => ({}))) as { users?: CreatedUser[] };
          if (response.ok) setUsers(body.users || []);
        })
        .catch(() => undefined);
    }
  }, [open, step, hasUsers, users.length]);

  useEffect(() => {
    if (!open || step !== "people" || hasUsers || users.length) return;
    setOsUsersState("pending");
    setOsUsersError("");
    setOsUsers([]);
    if (!setupToken.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setOsUsersState("loading");
      void fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "os-users", setupToken }), signal: controller.signal,
      }).then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "Could not load OS users.");
        setPlatform(body.platform || "linux");
        setOsUsers(body.osUsers || []);
        setOsUsername(current => current || body.suggestedOsUsername || "");
        setOsUsersState("ready");
      }).catch(cause => {
        if (controller.signal.aborted) return;
        setOsUsersError(cause instanceof Error ? cause.message : "Could not load OS users.");
        setOsUsersState("error");
      });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, step, hasUsers, users.length, setupToken]);

  const steps = useMemo(
    () => [
      { id: "welcome" as const, label: "Welcome" },
      { id: "people" as const, label: "People" },
      { id: "provider" as const, label: "Provider" },
      { id: "ready" as const, label: "Ready" },
    ],
    [],
  );
  const stepIndex = steps.findIndex((item) => item.id === step);

  if (!open) return null;

  async function createFirstAdmin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bootstrap", setupToken, username, password, osUsername: osUsername.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: CreatedUser;
      };
      if (!response.ok) throw new Error(body.error || "Could not create account.");
      const created = { id: body.user?.id || "admin", username: username.trim(), isAdmin: true };
      setUsers([created]);
      setSetupToken("");
      setUsername("");
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          isAdmin: makeAdmin,
          osUsername: osUsername.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: CreatedUser;
      };
      if (!response.ok) throw new Error(body.error || "Could not create user.");
      setUsers((current) => [
        ...current,
        {
          id: body.user?.id || username,
          username: body.user?.username || username.trim(),
          isAdmin: Boolean(body.user?.isAdmin ?? makeAdmin),
        },
      ]);
      setUsername("");
      setPassword("");
      setMakeAdmin(false);
      setOsUsername("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not finish setup.");
      try { window.sessionStorage.removeItem(SETUP_STEP_STORAGE_KEY); } catch { /* ignore */ }
      onFinished();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish setup.");
    } finally { setBusy(false); }
  }

  return (
    <OnboardingStage transitionKey={step} eyebrow="Metis · Server setup" title={step === "welcome" ? "Welcome to Metis" : step === "people" ? "Create your account" : step === "provider" ? "Connect a provider" : "Metis is ready"} description={step === "welcome" ? "A fresh Metis installation. Let’s set it up." : step === "people" ? "Your first account manages this server." : step === "provider" ? "Choose a provider, or add one later." : "Your workspace is ready."} progress={<OnboardingProgress steps={steps} index={stepIndex}/>} footer={stepIndex>0?<Button type="button" variant="ghost" disabled={busy} onClick={()=>goToStep(steps[Math.max(0,stepIndex-1)].id)}>Back</Button>:null}>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      {step === "welcome" ? (
        <Button type="button" className="h-11 min-h-11 rounded-xl" onClick={() => goToStep("people")}>
          Continue <ArrowRight className="size-4" />
        </Button>
      ) : null}

      {step === "people" ? (
        <div className="grid gap-6">
          {users.length ? (
            <ul className="grid gap-2" aria-label="Created users">
              {users.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{user.username}</span>
                  <span className="text-xs text-muted-foreground">{user.isAdmin ? "Admin" : "Member"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No accounts yet. Create the first admin to continue.</p>
          )}

          <form onSubmit={(event) => void (hasUsers || users.length ? addPerson(event) : createFirstAdmin(event))} className="grid gap-4">
            {!hasUsers && !users.length ? (
              <label className="grid gap-1 text-sm">
                Operator setup token
                <Input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)}
                  autoComplete="off" spellCheck={false} required aria-describedby="setup-token-help" />
                <div id="setup-token-help" className="text-xs font-normal text-muted-foreground">
                  One-time token from your server operator. <details><summary className="cursor-pointer underline">Where to find it</summary>On the server: data/setup-token (or setup-token in CHAT_DATA_DIR), or AI_CHAT_SETUP_TOKEN. Creating the first account consumes it.</details>
                </div>
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              {users.length ? "Username" : "Admin username"}
              <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required minLength={3} />
            </label>
            <label className="grid gap-1 text-sm">
              Password
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            {users.length ? (
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                Admin
                <Switch checked={makeAdmin} onCheckedChange={setMakeAdmin} aria-label="Admin" />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              {platformLabel(platform)}
              <OsUserField
                value={osUsername}
                onChange={setOsUsername}
                osUsers={osUsers}
                ariaLabel={platformLabel(platform)}
                className="h-11 font-normal"
              />
              <span className="text-xs font-normal text-muted-foreground" role="status">
                {osUsersState === "loading" ? "Loading OS users…" :
                  osUsersState === "error" ? osUsersError :
                  osUsersState === "pending" && !hasUsers && !users.length ? "Enter the operator setup token to load OS users. You can leave this field blank to create the admin." :
                  osUsersState === "ready" && !osUsers.length ? "No eligible OS users found. Leave this field blank to create the admin, then configure an OS user before running agents." :
                  !hasUsers && !users.length ? "Choose an existing OS user, or leave this blank and configure it after creating the admin." :
                  "Pick a host user or type a custom name that exists on this machine."}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="h-11 min-h-11 rounded-xl" disabled={busy}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : users.length ? <><Plus className="size-4" /> Add person</> : <>Create admin <ArrowRight className="size-4" /></>}
              </Button>
              {users.length ? (
                <Button type="button" variant="secondary" className="h-11 min-h-11 rounded-xl" disabled={busy} onClick={() => goToStep("provider")}>
                  Continue <ArrowRight className="size-4" />
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {step === "provider" ? (
        <div className="grid gap-4">
          <ProviderSetupDialog
            open
            embedded
            onOpenChange={() => undefined}
            onConnected={() => goToStep("ready")}
            onStartChat={() => goToStep("ready")}
            onSkip={() => goToStep("ready")}
          />
        </div>
      ) : null}

      {step === "ready" ? (
        <Button type="button" className="h-11 min-h-11 rounded-xl" disabled={busy} onClick={() => void finish()}>
          Enter Metis <ArrowRight className="size-4" />
        </Button>
      ) : null}
    </OnboardingStage>
  );
}
