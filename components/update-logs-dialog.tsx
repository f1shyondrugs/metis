"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type UpdateHistoryEntry = {
  jobId: string;
  status: "preparing" | "ready" | "failed";
  startedAt: string;
  finishedAt?: string;
  fromLabel: string;
  toLabel: string;
  error?: string;
  logs: string[];
};

function formatWhen(value?: string) {
  if (!value) return "Time unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unknown";
  return date.toLocaleString("en");
}

function statusLabel(status: UpdateHistoryEntry["status"]) {
  if (status === "ready") return "Succeeded";
  if (status === "failed") return "Failed";
  return "Running";
}

export function UpdateLogsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<UpdateHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void fetch("/api/admin/system/update/logs", { cache: "no-store" })
      .then(async (response) => {
        const next = (await response.json().catch(() => ({}))) as { entries?: UpdateHistoryEntry[]; error?: string };
        if (!active) return;
        if (!response.ok) throw new Error(next.error || `Could not load update logs (HTTP ${response.status}).`);
        const list = Array.isArray(next.entries) ? next.entries : [];
        setEntries(list);
        setSelectedId(list[0]?.jobId || null);
      })
      .catch((loadError) => {
        if (active) {
          setEntries([]);
          setSelectedId(null);
          setError(loadError instanceof Error ? loadError.message : "Could not load update logs.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const selected = entries.find((entry) => entry.jobId === selectedId) || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,calc(100vh-2rem))] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update logs</DialogTitle>
          <DialogDescription>
            Recent installer updates, from the installed version to the target, with the recorded output.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading update logs…</p> : null}
        {!loading && !error && entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No installer updates have been recorded yet.</p>
        ) : null}
        {!loading && entries.length > 0 ? (
          <div className="grid min-h-0 gap-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
            <ScrollArea className="max-h-72 rounded-md border border-border/60">
              <ul className="p-1">
                {entries.map((entry) => (
                  <li key={entry.jobId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(entry.jobId)}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left",
                        selectedId === entry.jobId ? "bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <p className="text-sm font-medium">
                        {entry.fromLabel} → {entry.toLabel}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {statusLabel(entry.status)} · {formatWhen(entry.finishedAt || entry.startedAt)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="min-w-0 space-y-2">
              {selected ? (
                <>
                  <div>
                    <p className="text-sm font-medium">
                      {selected.fromLabel} → {selected.toLabel}
                    </p>
                    <p className={cn(
                      "mt-0.5 text-xs",
                      selected.status === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}>
                      {statusLabel(selected.status)}
                      {selected.error ? `: ${selected.error}` : ""}
                    </p>
                  </div>
                  <ScrollArea className="h-64 rounded-md border border-border/60 bg-muted/20">
                    <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-5 text-foreground">
                      {selected.logs.length ? selected.logs.join("\n") : "No log lines were stored for this update."}
                    </pre>
                  </ScrollArea>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select an update.</p>
              )}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
