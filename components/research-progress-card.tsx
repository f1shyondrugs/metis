"use client";
import React from "react";
import { Check, Circle, Loader2, Telescope, ArrowUpRight } from "lucide-react";
import { researchReportNavigation, type ResearchProgress } from "@/lib/research-progress";

export function ResearchProgressCard({ progress, running = false }: { progress: ResearchProgress; running?: boolean }) {
  const done = progress.status === "report_attached";
  const reportNavigation = done ? researchReportNavigation(progress) : undefined;
  const completed = progress.steps.filter(step => step.status === "completed").length;
  const current = progress.steps.find(step => step.status === "in_progress");
  return <section className="my-3 overflow-hidden rounded-lg border border-border bg-card" aria-label="Research progress">
    <div className="flex items-start gap-3 px-4 py-3">
      <Telescope className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">{progress.title}</h3>
          <span className="text-xs text-muted-foreground">{done ? "Report ready" : `${completed}/${progress.steps.length} steps`}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{`${progress.readCount || 0}/${progress.sourceTarget} sources fully read · ${progress.discoveredCount || 0} found`}</p>
      </div>
    </div>
    <div className="h-1 bg-muted" role="progressbar" aria-label="Completed steps" aria-valuemin={0} aria-valuemax={progress.steps.length} aria-valuenow={completed}>
      <div className="h-full bg-primary transition-[width]" style={{width: `${progress.steps.length ? completed / progress.steps.length * 100 : 0}%`}} />
    </div>
    <ol className="space-y-2 px-4 py-3">
      {progress.steps.map(step => <li key={step.id} className="flex items-start gap-2 text-xs">
        {step.status === "completed" ? <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> : step.status === "in_progress" && running ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <span className={step.status === "in_progress" ? "font-medium text-foreground" : "text-muted-foreground"}>{step.content}{step.status === "in_progress" ? <span className="ml-2 text-[10px] text-primary">{running ? "Current" : "Pending"}</span> : null}</span>
      </li>)}
    </ol>
    {progress.note ? <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{progress.note}</p> : null}
    {(progress.blockedCount || progress.failedCount) ? <p className="px-4 pb-3 text-xs text-muted-foreground">{`${progress.blockedCount || 0} blocked · ${progress.failedCount || 0} failed`}</p> : null}
    {reportNavigation ? <a href={reportNavigation.href} onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent(reportNavigation.event, { detail: reportNavigation.detail }));
    }} className="flex items-center gap-1 border-t border-border px-4 py-3 text-xs font-medium hover:underline">Open report in Canvas<ArrowUpRight className="size-3" /></a> : done && progress.downloadUrl?.startsWith("/api/uploads/") ? <a href={progress.downloadUrl} className="flex items-center gap-1 border-t border-border px-4 py-3 text-xs font-medium hover:underline">Open full report<ArrowUpRight className="size-3" /></a> : !running && !done && current ? <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Research is not complete yet.</p> : null}
  </section>;
}
