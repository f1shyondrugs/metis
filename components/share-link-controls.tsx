"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/copy-text";

export type ShareLinkPatch = { active?: boolean; password?: string | null };

export type ShareLinkControlsProps = {
  url: string;
  active: boolean;
  passwordProtected: boolean;
  busy: boolean;
  onUpdate: (patch: ShareLinkPatch) => Promise<unknown> | void;
};

/** The common link, access and password controls used by chat and note sharing. */
export function ShareLinkControls({ url, active, passwordProtected, busy, onUpdate }: ShareLinkControlsProps) {
  const [password, setPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const working = busy || pending;

  useEffect(() => {
    setPassword("");
    setShowPasswordForm(false);
    setCopied(false);
    setError("");
  }, [url, passwordProtected]);

  async function update(patch: ShareLinkPatch) {
    if (working) return;
    setPending(true);
    setError("");
    try {
      // A caller may already display its own API error and return false.
      const result = await onUpdate(patch);
      if (result !== false) {
        setPassword("");
        setShowPasswordForm(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update sharing.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    setError("");
    try {
      await copyText(url, linkInput.current);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not copy. Select the link and copy it manually.");
    }
  }

  return <div className="space-y-4">
    {!active ? <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      This link is inactive. Start sharing to make it available again.
    </p> : null}
    <div className="flex gap-2">
      <Input
        ref={linkInput}
        readOnly
        value={url}
        onFocus={event => event.currentTarget.select()}
        aria-label="Share link"
        className="min-w-0"
      />
      <Button type="button" variant="outline" size="icon" aria-label={copied ? "Share link copied" : "Copy share link"} onClick={() => void copyLink()}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
    {copied ? <p role="status" className="text-xs text-muted-foreground">Share link copied</p> : null}
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LockKeyhole className="size-4 shrink-0" />
          Password protection
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {passwordProtected ? "Visitors must enter a password." : "Anyone with the link can view it."}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={passwordProtected ? "default" : "outline"}
        disabled={working}
        onClick={() => {
          if (passwordProtected) void update({ password: null });
          else { setPassword(""); setShowPasswordForm(true); setError(""); }
        }}
      >
        {passwordProtected ? "Remove" : "Set password"}
      </Button>
    </div>
    {!passwordProtected && showPasswordForm ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (password.trim()) void update({ password }); }}>
      <Input
        type="password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        placeholder="New password"
        autoComplete="new-password"
        aria-label="New share password"
        maxLength={1024}
        disabled={working}
        autoFocus
      />
      <Button type="submit" disabled={working || !password.trim()}>Lock</Button>
    </form> : null}
    <Button type="button" variant={active ? "destructive" : "default"} className="w-full" disabled={working} onClick={() => void update({ active: !active })}>
      {working ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {active ? "Stop sharing" : "Start sharing"}
    </Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
