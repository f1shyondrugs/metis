"use client";
import { useEffect, useState } from "react";
import { RunStatus } from "./run-status";
import { MemoryWaitControl } from "./memory-wait-control";
import { MEMORY_WAIT_MESSAGE } from "@/lib/memory-queue";
import { ToolPreparationDetails } from "./tool-input-status";
import type { PreparingTool } from "@/lib/tool-preparation";

/** Elapsed time remains honest when a provider buffers its next tool or text update. */
export function AgentActivity({ activityKey, label, tool, chatId }: { activityKey: string; label?: string; tool?: PreparingTool; chatId?: string | null }) {
  const [clock, setClock] = useState(() => ({ key: activityKey, since: Date.now(), now: Date.now() }));
  if (clock.key !== activityKey) setClock({ key: activityKey, since: Date.now(), now: Date.now() });
  useEffect(() => {
    const timer = window.setInterval(() => setClock(current => ({ ...current, now: Date.now() })), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((clock.now - clock.since) / 1000));
  if (label === MEMORY_WAIT_MESSAGE && chatId) return <MemoryWaitControl key={chatId} chatId={chatId} />;
  return <span className="flex min-w-0 max-w-full items-center gap-2 text-xs text-muted-foreground" aria-label="Agent working" data-agent-activity>
    <RunStatus status="running" iconOnly decorative className="shrink-0 text-xs"/>
    {tool ? <ToolPreparationDetails key={tool.id} name={tool.name} kind={tool.kind} source={tool.source} characters={tool.inputChars}/>
      : <span className="min-w-0 truncate">{label || "Preparing next action"}</span>}
    {elapsed >= 3 ? <span className="shrink-0 tabular-nums" aria-hidden="true">· {elapsed}s</span> : null}
  </span>;
}
