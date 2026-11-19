"use client";

import { ChevronRight, Clock, Repeat2, ArrowRightLeft } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ProviderRetryPart } from "@/lib/provider-retry";
import type { ModelSwitchPart, RunControlPart } from "@/lib/run-control-event";
import { activityRowClass } from "@/lib/activity-display";
import { parseModelKey } from "@/lib/providers/types";
import { cn } from "@/lib/utils";

function DividerLine() {
  return <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border/60" />;
}
const reasoningLabel = (value: string | null | undefined) => value ?? "Default (not specified)";
const contextLabel = (value: string | null | undefined) => {
  if (value == null) return "Automatic";
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return `${Number(value).toLocaleString("en-US")} tokens`;
  return value;
};
const defaultModelLabel = (id: string) => parseModelKey(id).modelId || id;

export function ModelSwitchDetails({ event, modelLabel = defaultModelLabel }: {
  event: ModelSwitchPart;
  modelLabel?: (id: string) => string;
}) {
  return <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
    {event.fromModelId === event.toModelId ? <>
      <dt>Model</dt><dd className="break-words text-foreground/90" title={event.toModelId}>{modelLabel(event.toModelId)}</dd>
    </> : <>
      <dt>From</dt><dd className="break-words text-foreground/90" title={event.fromModelId}>{modelLabel(event.fromModelId)}</dd>
      <dt>To</dt><dd className="break-words text-foreground/90" title={event.toModelId}>{modelLabel(event.toModelId)}</dd>
    </>}
    {event.fromReasoning !== event.toReasoning ? <>
      <dt>Reasoning from</dt><dd className="break-words text-foreground/90">{reasoningLabel(event.fromReasoning)}</dd>
      <dt>Reasoning to</dt><dd className="break-words text-foreground/90">{reasoningLabel(event.toReasoning)}</dd>
    </> : null}
    {event.fromContext !== event.toContext ? <>
      <dt>Context from</dt><dd className="break-words text-foreground/90">{contextLabel(event.fromContext)}</dd>
      <dt>Context to</dt><dd className="break-words text-foreground/90">{contextLabel(event.toContext)}</dd>
    </> : null}
    {event.reason ? <><dt>Chain</dt><dd className="break-words">{event.chainName}</dd><dt>Reason</dt><dd>{event.reason === "chain-usage" ? "Usage limit reached" : "Unavailable after 3 retries"}</dd></> : null}
    <dt>Switched at</dt><dd className="break-words"><time dateTime={event.timestamp}>{event.timestamp}</time></dd>
  </dl>;
}

export function RunEventDivider({ event, modelLabel }: {
  event: ProviderRetryPart | RunControlPart;
  modelLabel?: (id: string) => string;
}) {
  if (event.type === "model-switch") {
    const label = event.reason ? "Model chain fallback"
      : event.fromModelId !== event.toModelId ? "Switched model"
      : event.fromContext !== event.toContext
        ? event.fromReasoning !== event.toReasoning ? "Updated model settings" : "Switched context"
        : event.fromReasoning !== event.toReasoning ? "Switched reasoning" : "Updated model settings";
    return <div data-run-event={event.id} className="my-4 flex min-h-8 min-w-0 items-center gap-3">
      <DividerLine />
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn(activityRowClass, "min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-ring")}>
            <ArrowRightLeft aria-hidden="true" className="size-3 shrink-0 opacity-70" />
            <span role="status" className="min-w-0 break-words">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label + " details"}
          className="max-h-[min(70dvh,36rem,var(--radix-popover-content-available-height,70dvh))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-3 text-xs leading-5"
        >
          <ModelSwitchDetails event={event} modelLabel={modelLabel} />
        </PopoverContent>
      </Popover>
      <DividerLine />
    </div>;
  }

  const label = event.type === "provider-wait" ? "Usage limit wait" : `Continuing Run… (${event.attempt}/${event.maxRetries})`;
  const Icon = event.type === "provider-wait" ? Clock : Repeat2;
  return <details data-run-event={event.id}
    data-provider-retry={event.type === "provider-retry" ? event.id : undefined}
    className="group/run-event my-4 min-w-0">
    <summary className="flex min-h-8 w-full cursor-pointer list-none items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <DividerLine />
      <span className={activityRowClass}>
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 transition-transform group-open/run-event:rotate-90 motion-reduce:transition-none" />
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span role="status" className="min-w-0 break-words">{label}</span>
      </span>
      <DividerLine />
    </summary>
    <div className="mx-1 mt-1 min-w-0 border-l border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <p className="mb-1.5 font-medium text-foreground/90">{event.type === "provider-wait" ? "Provider usage limit" : "Provider error"}</p>
      {event.type === "provider-wait" ? <p className="mb-2 break-words">Automatic resume at <time dateTime={event.resetAt}>{event.resetAt}</time></p> : null}
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-normal leading-relaxed">{event.detail || "No error details were provided."}</pre>
    </div>
  </details>;
}
