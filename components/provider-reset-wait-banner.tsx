"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, LoaderCircle } from "lucide-react";
import { subscribeToWindowEvents } from "@/lib/browser-events";
import { parseProviderResetWait, providerResetWaitLabel, type ProviderResetWait } from "@/lib/provider-reset-wait";

type WaitAction = "wake" | "cancel";

export function ProviderResetWaitBar({ wait, pending = null, error = "", now = Date.now(), onWake, onCancel, onRefresh }: {
  wait: ProviderResetWait; pending?: WaitAction | null; error?: string; now?: number;
  onWake: () => void; onCancel: () => void; onRefresh?: () => void;
}) {
  const due = Date.parse(wait.resetAt) <= now;
  const button = "inline-flex min-h-11 items-center justify-center gap-1 rounded px-2 text-xs outline-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-7 sm:px-1.5";
  return <div data-provider-reset-wait={wait.jobId} role="region" aria-label="Provider reset wait" aria-busy={Boolean(pending)}
    className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-3 py-1.5 text-xs text-amber-950 dark:text-amber-100">
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-1 basis-full items-start gap-2 py-1 sm:basis-0">
        <Gauge aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <p role="status" aria-live="polite" className="min-w-0 leading-5">
          <span className="mr-1.5 font-medium">Usage limit reached</span>
          <time dateTime={wait.resetAt} title={new Date(wait.resetAt).toLocaleString("en-GB", { timeZoneName: "short" })}
            className="text-amber-900/80 dark:text-amber-100/70">{providerResetWaitLabel(wait.resetAt, now)}</time>
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button type="button" className={button} disabled={Boolean(pending)} onClick={onCancel}>
          {pending === "cancel" ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : null}
          {pending === "cancel" ? "Cancelling…" : "Cancel auto-resume"}
        </button>
        <button type="button" className={button} disabled={Boolean(pending) || due} onClick={onWake}>
          {pending === "wake" ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : null}
          {pending === "wake" ? "Waking…" : "Wake now"}
        </button>
      </div>
    </div>
    {error ? <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 border-t border-amber-500/20 pt-2 text-destructive">
      <span>{error}</span>
      {onRefresh ? <button type="button" className="min-h-8 rounded px-1 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring" onClick={onRefresh}>Retry</button> : null}
    </div> : null}
  </div>;
}

export function ProviderResetWaitBanner({ chatId, refreshKey, onWaitingChange, onAction }: {
  chatId: string; refreshKey: string;
  onWaitingChange: (chatId: string, waiting: boolean) => void;
  onAction?: () => void;
}) {
  const [wait, setWait] = useState<ProviderResetWait | null>(null);
  const [pending, setPending] = useState<WaitAction | null>(null);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(Date.now);
  const waitRef = useRef<ProviderResetWait | null>(null);
  const pendingRef = useRef<WaitAction | null>(null);
  const version = useRef(0);
  const mounted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const refresh = useRef<() => void>(() => {});
  const accept = useCallback((next: ProviderResetWait | null) => { waitRef.current = next; setWait(next); }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionController.current?.abort(); };
  }, [chatId]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); if (alive) timer = setTimeout(() => void read(), 5000); };
    const read = async () => {
      clearTimeout(timer);
      if (pendingRef.current) { schedule(); return; }
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const revision = ++version.current;
      try {
        const response = await fetch("/api/chat/provider-wait?chatId=" + encodeURIComponent(chatId), { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not read provider reset status.");
        if (!alive || revision !== version.current) return;
        const next = data.wait === null ? null : parseProviderResetWait(data.wait);
        if (data.wait !== null && !next) throw new Error("Invalid provider reset status.");
        if (!next || next.jobId !== waitRef.current?.jobId || next.detectedAt !== waitRef.current?.detectedAt) setActionError("");
        accept(next);
        setReadError("");
        if (next) schedule();
      } catch (cause) {
        if (!alive || controller.signal.aborted || revision !== version.current) return;
        if (waitRef.current) setReadError(cause instanceof Error ? cause.message : "Could not read provider reset status.");
        schedule();
      }
    };
    refresh.current = () => { void read(); };
    const unsubscribe = subscribeToWindowEvents(["focus", "online"], () => { void read(); });
    void read();
    return () => { alive = false; clearTimeout(timer); readController.current?.abort(); unsubscribe(); };
  }, [chatId, refreshKey, accept]);

  const waiting = Boolean(wait);
  useEffect(() => {
    onWaitingChange(chatId, waiting);
    return () => onWaitingChange(chatId, false);
  }, [chatId, waiting, onWaitingChange]);

  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function act(action: WaitAction) {
    const current = waitRef.current;
    if (!current || pendingRef.current) return;
    pendingRef.current = action;
    setPending(action); setActionError(""); setReadError("");
    version.current += 1;
    readController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    try {
      const response = await fetch("/api/chat/provider-wait", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ chatId, jobId: current.jobId, detectedAt: current.detectedAt, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update this waiting run.");
      if (!mounted.current) return;
      const next = data.wait === null ? null : parseProviderResetWait(data.wait);
      if (data.wait !== null && !next) throw new Error("Invalid provider reset status.");
      accept(next);
      onAction?.();
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setActionError(cause instanceof Error ? cause.message : "Could not update this waiting run.");
    } finally {
      if (mounted.current) {
        pendingRef.current = null;
        setPending(null);
        refresh.current();
      }
    }
  }

  return wait ? <ProviderResetWaitBar wait={wait} pending={pending} error={actionError || readError} now={now}
    onWake={() => void act("wake")} onCancel={() => void act("cancel")} onRefresh={() => { setActionError(""); refresh.current(); }} /> : null;
}
