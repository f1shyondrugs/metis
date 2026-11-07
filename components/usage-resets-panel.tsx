"use client";
import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { resetCreditUsable, resetOutcomeLabel, type UsageResetConfirmation, type UsageResetSnapshot, type UsageResetHistory } from "@/lib/usage-reset-types";

type Catalog = {
  providers: { key: string; name: string; status: string; reason: string; documentationUrl?: string }[];
  connections: { id: string; label: string; providerName: string; supported: boolean }[];
  history: UsageResetHistory[];
};
const time = (value: string) => new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
function expiry(value: string | null | undefined) {
  return value === null ? "Does not expire" : value ? "Expires " + time(value) : "Expiration unavailable";
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not load provider resets.");
  return body;
}
export function UsageResetsPanel({ initialConnectionId }: { initialConnectionId?: string } = {}) {
  const id = useId();
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState("");
  const selectedRef = useRef("");
  const [snapshot, setSnapshot] = useState<UsageResetSnapshot | null>(null);
  const [tab, setTab] = useState<"available" | "history">("available");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<UsageResetConfirmation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void api<Catalog>("/api/usage-resets", { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      const first = data.connections.find(c => c.id === initialConnectionId) || data.connections.find(c => c.supported) || data.connections[0];
      if (first) { selectedRef.current = first.id; setSelected(first.id); }
      else setLoading(false);
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setLoading(false); } });
    return () => controller.abort();
  }, [catalogRevision, initialConnectionId]);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => {
      if (!busyRef.current) { setConfirmation(null); setNotice("The confirmation expired. Review the reset again."); }
    }, Math.max(0, Date.parse(confirmation.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [confirmation]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setSnapshot(null); setConfirmation(null);
    void api<UsageResetSnapshot>("/api/usage-resets?connectionId=" + encodeURIComponent(selected), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setSnapshot(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, revision]);
  async function prepare(creditId?: string, retryId?: string) {
    if (busyRef.current || !selected) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const account = selectedRef.current;
    try {
      const result = await api<UsageResetConfirmation>("/api/usage-resets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", connectionId: account, creditId, retryId }),
      });
      if (account === selectedRef.current) { setAcknowledged(false); setConfirmation(result); }
    } catch (cause) { if (account === selectedRef.current) setError(cause instanceof Error ? cause.message : "Could not review this reset."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function consume() {
    if (!confirmation || !acknowledged || busyRef.current || confirmation.connectionId !== selectedRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const reviewed = confirmation;
    try {
      const result = await api<{ outcome: string; snapshot: UsageResetSnapshot | null }>("/api/usage-resets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "consume", connectionId: reviewed.connectionId, id: reviewed.id, token: reviewed.token, confirmed: true }),
      });
      if (selectedRef.current === reviewed.connectionId) {
        setConfirmation(null); setNotice(resetOutcomeLabel(result.outcome));
        if (result.snapshot) setSnapshot(result.snapshot); else setRevision(n => n + 1);
      }
      window.dispatchEvent(new Event("metis:plan-usage-changed"));
    } catch (cause) {
      setConfirmation(null); setTab("history"); setRevision(n => n + 1);
      setNotice(cause instanceof Error ? cause.message : "The result could not be confirmed. Check History.");
    } finally { busyRef.current = false; setBusy(false); }
  }
  const history = snapshot?.history || catalog?.history.filter(item => !selected || item.connectionId === selected) || [];
  const credits = snapshot?.credits || [];
  return <section aria-label="Usage limit resets" className="min-w-0 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">Usage limit resets</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">View available resets for your account. Using a reset always requires confirmation.</p></div>
      <Button variant="ghost" size="icon" className="size-11" disabled={loading || busy || !selected} aria-label="Refresh reset availability" onClick={() => { setNotice(""); setRevision(n => n + 1); }}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
    </div>
    {catalog?.connections.length ? <label className="block space-y-1.5 text-xs text-muted-foreground">Account
      <select aria-label="Reset account" value={selected} disabled={busy} className="block min-h-11 w-full max-w-xl rounded-lg border border-border bg-background px-3 text-sm text-foreground" onChange={event => {
        selectedRef.current = event.target.value; setSelected(event.target.value); setConfirmation(null); setNotice("");
      }}>{catalog.connections.map(item => <option key={item.id} value={item.id}>{item.providerName} · {item.label}{item.supported ? "" : " · Resets unavailable"}</option>)}</select>
    </label> : !loading && !error ? <p className="text-sm text-muted-foreground">Connect an account in Settings → Providers to check for usage resets.</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" disabled={busy} onClick={() => selected ? setRevision(n => n + 1) : setCatalogRevision(n => n + 1)}>Try again</Button></div> : null}
    {notice ? <p role="status" className="text-sm leading-relaxed">{notice}</p> : null}
    {selected ? <div className="overflow-hidden rounded-xl border border-border/60">
      <div className="flex gap-1 border-b border-border/60 px-3" role="tablist" aria-label="Reset records" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "available" : event.key === "End" ? "history" : tab === "available" ? "history" : "available";
        setTab(next);
        (event.currentTarget.querySelector('[data-reset-tab="' + next + '"]') as HTMLElement | null)?.focus();
      }}>
        <button type="button" role="tab" id={id + "-available"} data-reset-tab="available" aria-controls={id + "-panel"} tabIndex={tab === "available" ? 0 : -1} aria-selected={tab === "available"} className={"min-h-11 border-b-2 px-3 text-sm " + (tab === "available" ? "border-primary" : "border-transparent text-muted-foreground")} onClick={() => setTab("available")}>Available {snapshot?.availableCount ?? "—"}</button>
        <button type="button" role="tab" id={id + "-history"} data-reset-tab="history" aria-controls={id + "-panel"} tabIndex={tab === "history" ? 0 : -1} aria-selected={tab === "history"} className={"min-h-11 border-b-2 px-3 text-sm " + (tab === "history" ? "border-primary" : "border-transparent text-muted-foreground")} onClick={() => setTab("history")}>History</button>
      </div>
      <div className="px-4 py-3" id={id + "-panel"} role="tabpanel" aria-labelledby={id + "-" + tab} aria-busy={loading}>
        {loading ? <p className="py-3 text-sm text-muted-foreground">Loading provider resets…</p> : tab === "available" ? <>
          {snapshot?.status === "unavailable" ? <p className="py-2 text-sm leading-relaxed text-muted-foreground">{snapshot.reason}</p> : null}
          {snapshot?.status === "live" && !credits.length ? <p className="py-2 text-sm text-muted-foreground">{snapshot.availableCount ? "The provider returned a count without reset details. Refresh to check again." : "No reset credits are available for this account."}</p> : null}
          <div className="divide-y divide-border/50">{credits.map(credit => <div key={credit.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{credit.title}</p><p className="mt-1 text-xs text-muted-foreground">{expiry(credit.expiresAt)}{credit.status !== "available" ? " · " + credit.status : ""}</p>{credit.description ? <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{credit.description}</p> : null}</div>
            <Button variant="secondary" className="min-h-11 shrink-0" disabled={busy || !resetCreditUsable(credit)} onClick={() => void prepare(credit.id)}>Use reset</Button>
          </div>)}</div>
          {snapshot?.availableCount != null && snapshot.availableCount > credits.filter(c => c.status === "available").length && credits.length ? <p className="mt-2 text-xs text-muted-foreground">The provider returned details for only some available resets.</p> : null}
        </> : <>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Reset requests made in Metis. Provider-wide history may not be exposed by your account connection.</p>
          {!history.length ? <p className="py-2 text-sm text-muted-foreground">No reset requests have been made in Metis for this account.</p> : <div className="divide-y divide-border/50">{history.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{resetOutcomeLabel(item.status)} · {time(item.completedAt || item.requestedAt)}</p></div>
            {item.retryable ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void prepare(undefined, item.id)}>Review retry</Button> : null}
          </div>)}</div>}
        </>}
      </div>
    </div> : null}
    {catalog ? <details className="text-xs text-muted-foreground"><summary className="min-h-10 cursor-pointer py-2">Provider support</summary><div className="divide-y divide-border/40">{catalog.providers.map(provider => <div key={provider.key} className="flex flex-wrap justify-between gap-x-5 gap-y-1 py-2"><span className="text-foreground">{provider.name}</span><span>{provider.status === "integrated" ? "Available for supported connected accounts" : "No manual resets exposed by this integration"}</span></div>)}</div></details> : null}
    <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!busy && !open) setConfirmation(null); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg" showCloseButton={!busy} onOpenAutoFocus={event => { event.preventDefault(); cancelRef.current?.focus(); }}>
        <DialogHeader><DialogTitle>{confirmation?.retry ? "Retry the previous reset request?" : "Use this reset?"}</DialogTitle><DialogDescription>A successful reset consumes one credit and cannot be undone.</DialogDescription></DialogHeader>
        {confirmation ? <div className="min-h-0 space-y-3 overflow-y-auto">
          <dl className="space-y-2 text-sm"><div><dt className="text-xs text-muted-foreground">Account</dt><dd className="break-words font-medium">{confirmation.accountLabel}</dd></div><div><dt className="text-xs text-muted-foreground">Reset</dt><dd className="font-medium">{confirmation.credit.title}</dd><dd className="mt-1 text-xs text-muted-foreground">{expiry(confirmation.credit.expiresAt)}</dd></div></dl>
          {confirmation.credit.description ? <p className="text-sm leading-relaxed text-muted-foreground">{confirmation.credit.description}</p> : null}
          {confirmation.retry ? <p className="text-sm leading-relaxed">The previous result is unknown. This retries that same request with its original request ID, rather than starting a second reset.</p> : null}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I confirm using this reset for {confirmation.accountLabel}.</label>
        </div> : null}
        <DialogFooter><Button ref={cancelRef} variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button className="min-h-11" disabled={!acknowledged || busy || !confirmation || Date.parse(confirmation.expiresAt) <= Date.now()} onClick={() => void consume()}>{busy ? "Using reset…" : confirmation?.retry ? "Confirm retry" : "Confirm and use reset"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
