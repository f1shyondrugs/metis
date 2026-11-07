"use client";

import { useEffect, useState } from "react";
import { MemoryStick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMORY_WAIT_MESSAGE, MEMORY_OVERRIDE_MESSAGE } from "@/lib/memory-queue";

export function MemoryWaitControl({ chatId }: { chatId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "sent" | "stale">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/runs?chatId=" + encodeURIComponent(chatId), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not read the waiting run.");
        const body = await response.json() as { jobs?: Array<{ id: string; status: string; memoryWaiting?: boolean }> };
        const waiting = body.jobs?.find(job => job.status === "queued" && job.memoryWaiting);
        if (controller.signal.aborted) return;
        setJobId(waiting?.id ?? null);
        setState(waiting ? "ready" : "stale");
      }).catch(cause => {
        if (!controller.signal.aborted) { setError(String(cause.message || cause)); setState("stale"); }
      });
    return () => controller.abort();
  }, [chatId]);

  async function continueAnyway() {
    if (!jobId || state !== "ready") return;
    setState("submitting");
    setError("");
    try {
      const response = await fetch("/api/runs/memory-override", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setState(response.status === 409 || response.status === 404 ? "stale" : "ready");
        setError(body.error || "Could not continue this run.");
        return;
      }
      setState("sent");
    } catch {
      setError("Connection failed. Try again.");
      setState("ready");
    }
  }

  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-memory-wait>
    <MemoryStick className="size-3.5 shrink-0" aria-hidden="true" />
    <span>{state === "sent" ? MEMORY_OVERRIDE_MESSAGE : state === "stale" && !error ? "Run status changed. Updating…" : MEMORY_WAIT_MESSAGE}</span>
    {state !== "sent" && state !== "stale" ? <Button type="button" variant="outline" size="xs"
      disabled={state !== "ready"} onClick={() => void continueAnyway()}
      title="Skip the RAM waiting check for this run. System memory limits still apply.">
      {state === "submitting" ? "Continuing…" : "Continue anyways"}
    </Button> : null}
    {error ? <span role="alert" className="basis-full text-destructive">{error}</span> : null}
  </span>;
}
