"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ActivityDisclosureTrigger } from "@/components/activity-disclosure-trigger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AcceptanceReport, AcceptanceTarget } from "@/lib/providers/acceptance";

type Catalog = {
  matrix: AcceptanceTarget[];
  revision: string;
  checks: { id: string; label: string; automated: boolean }[];
  latest?: AcceptanceReport;
};
const statuses = ["passed", "failed", "blocked", "unsupported", "untested"] as const;
type Status = typeof statuses[number];
const statusStyle: Record<Status, string> = {
  passed: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  blocked: "bg-muted text-foreground",
  unsupported: "bg-muted text-muted-foreground",
  untested: "border border-border text-muted-foreground",
};
export function acceptanceCounts(targets: AcceptanceTarget[]) {
  const counts = { passed: 0, failed: 0, blocked: 0, unsupported: 0, untested: 0 };
  for (const target of targets) for (const cell of target.cells) counts[cell.status]++;
  return counts;
}
async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    signal, cache: "no-store",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in to use the provider acceptance console.");
    throw new Error(`Request failed (HTTP ${response.status}). No further steps will be started. Refresh to observe the saved report.`);
  }
  return response.json();
}
function toggle(items: string[], id: string) {
  return items.includes(id) ? items.filter(item => item !== id) : [...items, id];
}
function AcceptanceDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="mt-2"><ActivityDisclosureTrigger expanded={expanded} controls={id} onClick={() => setExpanded(value => !value)}>{label}</ActivityDisclosureTrigger>{expanded && <div id={id}>{children}</div>}</div>;
}
export function ProviderAcceptancePanel() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState("");
  const [resultPage, setResultPage] = useState(0);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [checks, setChecks] = useState<string[]>([]);
  const [maxTurns, setMaxTurns] = useState(3);
  const [seconds, setSeconds] = useState(90);
  const [confirmed, setConfirmed] = useState(false);
  const [report, setReport] = useState<AcceptanceReport>();
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    request<Catalog>("/api/providers/acceptance", abort.signal).then(data => {
      setCatalog(data);
      setReport(data.latest);
      setError("");
    }).catch(err => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load the acceptance catalog."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [reload]);

  // Only a successful explicit Start supplies runId. Loading a saved report never resumes it.
  useEffect(() => {
    if (!runId) return;
    const abort = new AbortController();
    controller.current = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => new Promise<void>(resolve => {
      const finish = () => { abort.signal.removeEventListener("abort", finish); resolve(); };
      timer = setTimeout(finish, 1500);
      abort.signal.addEventListener("abort", finish, { once: true });
    });
    const offline = () => abort.abort();
    window.addEventListener("offline", offline);
    void (async () => {
      try {
        let first = true;
        while (!abort.signal.aborted) {
          if (!navigator.onLine) throw new Error("Connection lost. Automatic advancement stopped; the saved report may be incomplete.");
          const url = `/api/providers/acceptance/${encodeURIComponent(runId)}`;
          const result = await request<{ report: AcceptanceReport; active: boolean }>(
            url, abort.signal, first ? { action: "next" } : undefined,
          );
          first = false;
          if (abort.signal.aborted) break;
          setReport(result.report);
          if (result.report.state === "completed" || result.report.state === "cancelled") break;
          if (!result.active && result.report.state === "running") {
            const next = await request<{ report: AcceptanceReport; active: boolean }>(url, abort.signal, { action: "next" });
            if (abort.signal.aborted) break;
            setReport(next.report);
            if (next.report.state === "completed" || next.report.state === "cancelled") break;
          } else if (!result.active && result.report.state !== "running") break;
          await pause();
        }
        if (abort.signal.aborted && mounted.current && !navigator.onLine)
          setError("Connection lost. Automatic advancement stopped; the saved report may be incomplete.");
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Test progression stopped. The report may be incomplete.");
      } finally {
        if (mounted.current && controller.current === abort) { setRunId(undefined); setBusy(false); pending.current = false; }
      }
    })();
    return () => { abort.abort(); if (timer) clearTimeout(timer); window.removeEventListener("offline", offline); };
  }, [runId]);

  const valid = targetIds.length > 0 && checks.length > 0 && confirmed &&
    Number.isInteger(maxTurns) && maxTurns >= 1 && maxTurns <= 20 &&
    Number.isFinite(seconds) && seconds >= 15 && seconds <= 300;
  async function start() {
    if (!valid || busy || pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await request<{ report: AcceptanceReport }>("/api/providers/acceptance", abort.signal,
        { targetIds, checks, maxTurns, timeoutMs: seconds * 1000, confirmLive: true });
      if (abort.signal.aborted) return;
      setReport(result.report);
      setRunId(result.report.id);
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Unable to create the report.");
      if (mounted.current) { setBusy(false); pending.current = false; }
    }
  }
  async function stop() {
    controller.current?.abort();
    setRunId(undefined);
    if (!report) { setBusy(false); pending.current = false; return; }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const result = await request<{ report: AcceptanceReport }>(`/api/providers/acceptance/${encodeURIComponent(report.id)}`, abort.signal, { action: "cancel" });
      if (!abort.signal.aborted) { setReport(result.report); setError(""); }
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Stop could not be confirmed. No further steps will be started here.");
    } finally {
      if (mounted.current) { setBusy(false); pending.current = false; }
    }
  }
  const targets = report?.targets ?? catalog?.matrix ?? [];
  const counts = acceptanceCounts(targets);
  const matchesFilter = (target: AcceptanceTarget) => [target.providerName, target.providerKey, target.modelId, target.authType, target.connectionId].join(" ").toLowerCase().includes(filter.toLowerCase());
  const filteredCatalog = (catalog?.matrix ?? []).filter(matchesFilter);
  const filteredResults = targets.filter(matchesFilter);
  const pageCount = Math.max(1, Math.ceil(filteredResults.length / 10));
  const page = Math.min(resultPage, pageCount - 1);
  const pagedTargets = filteredResults.slice(page * 10, page * 10 + 10);
  const incomplete = report?.state === "planned" || report?.state === "running";
  return <div className="min-w-0 space-y-6">
    <header className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Provider diagnostics</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Cross-slot navigation needs the owning page and build. */}
      <a href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to Metis</a>
      <h1 className="text-2xl font-semibold tracking-tight">Acceptance console</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">Inspect provider evidence, then explicitly choose a bounded live test. Opening this page never starts or resumes a test.</p>
    </header>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="action" disabled={busy || loading} onClick={() => setReload(value => value + 1)}>Refresh saved results</Button>
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading acceptance catalog…</p>}
      {catalog && <span className="break-all text-xs text-muted-foreground">Revision: {catalog.revision}</span>}
    </div>
    {!loading && !catalog && <p className="text-sm text-muted-foreground">Catalog unavailable. Refresh to try again. No tests have been started.</p>}
    {catalog && <section aria-label="Live test configuration" className="space-y-4 rounded-xl border p-4 sm:p-5">
      <h2 className="font-semibold">Choose what to test</h2>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">Live test configuration</legend>
        <label className="block space-y-2 text-sm"><span>Filter providers, models or authentication</span><Input value={filter} onChange={event => { setFilter(event.target.value); setResultPage(0); }} placeholder="Search the matrix" /></label>
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Available provider targets. None selected by default.</caption>
            <thead className="bg-muted/50"><tr><th className="p-3">Target</th><th className="p-3">Authentication / source</th></tr></thead>
            <tbody>{filteredCatalog.slice(0, 100).map(target => <tr key={target.id} className="border-t align-top">
              <td className="p-3"><label className="flex min-h-11 cursor-pointer items-start gap-3">
                <input className="mt-1 size-4 shrink-0 accent-primary" type="checkbox" checked={targetIds.includes(target.id)} onChange={() => setTargetIds(ids => toggle(ids, target.id))} />
                <span className="min-w-0 break-words"><span className="font-medium">{target.providerName}</span><span className="block break-all text-muted-foreground">{target.modelId ?? target.modelKey ?? "No model available"}</span>{target.connectionId && <span className="block break-all text-xs text-muted-foreground">Connection: {target.connectionId}</span>}</span>
              </label></td>
              <td className="p-3 text-muted-foreground"><span className="break-all">{target.authType}</span><span className="block">{target.modelSource ?? "Source unknown"}</span></td>
            </tr>)}</tbody>
          </table>
          {catalog.matrix.length === 0 && <p className="p-4 text-sm text-muted-foreground">No provider targets available. Configure a provider connection before testing.</p>}
        </div>
        {filteredCatalog.length > 100 && <p className="text-xs text-muted-foreground">Showing the first 100 of {filteredCatalog.length} matching targets. Narrow the filter to find a specific model.</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-1">{catalog.checks.map(check => <label key={check.id} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" disabled={!check.automated} checked={checks.includes(check.id)} onChange={() => setChecks(ids => toggle(ids, check.id))} />
          <span>{check.label}{!check.automated && <span className="text-muted-foreground"> · not automated</span>}</span>
        </label>)}</div>
        <p className="text-xs text-muted-foreground">Deeper probes that are not automated remain untested. Capability metadata alone is not acceptance evidence.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm"><span>Maximum turns (1–20)</span><Input type="number" min={1} max={20} step={1} value={Number.isNaN(maxTurns) ? "" : maxTurns} onChange={event => setMaxTurns(event.target.valueAsNumber)} /></label>
          <label className="space-y-2 text-sm"><span>Timeout in seconds (15–300)</span><Input type="number" min={15} max={300} value={Number.isNaN(seconds) ? "" : seconds} onChange={event => setSeconds(event.target.valueAsNumber)} /></label>
        </div>
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Live tests may consume paid provider quota.</p>
          <p className="text-muted-foreground">The server enforces the turn limit; this is not a dollar-cost guarantee. Stop prevents further steps and cancels only this report’s job. Closing this page stops advancement, but an already-started step may finish.</p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I understand and authorize these selected live tests.</label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="action" disabled={!valid || busy} onClick={start}>{busy ? "Test in progress…" : "Start selected tests"}</Button>
        <span className="text-sm text-muted-foreground">{targetIds.length} targets · {checks.length} checks selected</span>
      </div>
    </section>}
    <section aria-label="Acceptance results" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{report ? "Saved report" : "Catalog evidence"}</h2>
        {report && incomplete && <Button size="action" variant="destructive" disabled={busy && !runId} onClick={stop}>Stop this report</Button>}
      </div>
      {report && <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p className="break-all"><strong>{report.state}</strong> · {report.mode} · {report.id}</p>
        <p className="text-muted-foreground">{report.turnsUsed} / {report.limits.maxTurns} turns used · Updated {new Date(report.updatedAt).toLocaleString("en-US")}</p>
        {incomplete && !runId && <p>This report is incomplete and is not advancing here. Refresh only observes saved results.</p>}
        <nav aria-label="Download report" className="flex flex-wrap gap-4">{["markdown", "html", "json"].map(format => <a className="inline-flex min-h-11 items-center underline underline-offset-4" key={format} href={`/api/providers/acceptance/${encodeURIComponent(report.id)}?format=${format}`} download>Download {format === "markdown" ? "Markdown" : format.toUpperCase()}</a>)}</nav>
        {report.notes.length > 0 && <AcceptanceDisclosure label={"Report notes (" + report.notes.length + ")"}><ul className="mt-2 list-inside list-disc space-y-1 break-words">{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></AcceptanceDisclosure>}
      </div>}
      <div aria-label="Result counts" className="flex flex-wrap gap-2">{statuses.map(status => <span key={status} className={`rounded-md px-2.5 py-1 text-xs ${statusStyle[status]}`}>{counts[status]} {status}</span>)}</div>
      <p className="text-xs text-muted-foreground">Counts describe recorded check cells, not universal provider support. Blocked and untested checks are not passes.</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Acceptance evidence by target and check</caption>
          <thead className="bg-muted/50"><tr>{["Target", "Check", "Status", "Evidence / reason"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{pagedTargets.flatMap(target => target.cells.map((cell, index) => <tr key={`${target.id}:${cell.check}:${index}`} className="border-t align-top">
            <td className="max-w-56 break-words p-3"><span className="font-medium">{target.providerName}</span><span className="block break-all text-xs text-muted-foreground">{target.modelId ?? target.modelKey ?? target.id}</span></td>
            <td className="p-3">{catalog?.checks.find(check => check.id === cell.check)?.label ?? cell.check}</td>
            <td className="p-3"><span className={`inline-block whitespace-nowrap rounded-md px-2 py-1 text-xs ${statusStyle[cell.status]}`}>{cell.status}</span></td>
            <td className="min-w-48 max-w-xl p-3"><p className="break-words">{cell.reason || "No reason recorded."}</p>{cell.evidence != null && <AcceptanceDisclosure label="Recorded evidence"><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(cell.evidence, null, 2)}</pre></AcceptanceDisclosure>}{cell.checkedAt && <p className="mt-1 text-xs text-muted-foreground">{new Date(cell.checkedAt).toLocaleString("en-US")}</p>}</td>
          </tr>))}</tbody>
        </table>
        {targets.every(target => target.cells.length === 0) && <p className="p-4 text-sm text-muted-foreground">No acceptance evidence recorded yet.</p>}
      </div>
      <nav aria-label="Result pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" size="action" disabled={page === 0} onClick={() => setResultPage(page - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1} of {pageCount} · {filteredResults.length} matching targets</span><Button variant="outline" size="action" disabled={page + 1 >= pageCount} onClick={() => setResultPage(page + 1)}>Next</Button></nav>
    </section>
  </div>;
}
