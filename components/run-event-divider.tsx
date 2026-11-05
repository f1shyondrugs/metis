import { ChevronRight, Clock, Repeat2, ArrowRightLeft } from "lucide-react";
import type { ProviderRetryPart } from "@/lib/provider-retry";
import type { RunControlPart } from "@/lib/run-control-event";
import { activityRowClass } from "@/lib/activity-display";
import { parseModelKey } from "@/lib/providers/types";

export function RunEventDivider({ event, modelLabel }: {
  event: ProviderRetryPart | RunControlPart;
  modelLabel?: (id: string) => string;
}) {
  const label = event.type === "model-switch" ? "Switched model"
    : event.type === "provider-wait" ? "Usage limit wait"
      : `Continuing Run… (${event.attempt}/${event.maxRetries})`;
  const Icon = event.type === "model-switch" ? ArrowRightLeft : event.type === "provider-wait" ? Clock : Repeat2;
  const name = modelLabel || ((id: string) => parseModelKey(id).modelId || id);
  return <details data-run-event={event.id}
    data-provider-retry={event.type === "provider-retry" ? event.id : undefined}
    className="group/run-event my-4 min-w-0">
    <summary className="flex min-h-8 w-full cursor-pointer list-none items-center gap-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border/60" />
      <span className={activityRowClass}>
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 transition-transform group-open/run-event:rotate-90 motion-reduce:transition-none" />
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        <span role="status" className="min-w-0 break-words">{label}</span>
      </span>
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border/60" />
    </summary>
    <div className="mx-1 mt-1 min-w-0 border-l border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
      {event.type === "model-switch" ? <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>From</dt><dd className="break-words text-foreground/90" title={event.fromModelId}>{name(event.fromModelId)}</dd>
        <dt>To</dt><dd className="break-words text-foreground/90" title={event.toModelId}>{name(event.toModelId)}</dd>
        <dt>Switched at</dt><dd className="break-words"><time dateTime={event.timestamp}>{event.timestamp}</time></dd>
      </dl> : <>
        <p className="mb-1.5 font-medium text-foreground/90">{event.type === "provider-wait" ? "Provider usage limit" : "Provider error"}</p>
        {event.type === "provider-wait" ? <p className="mb-2 break-words">Automatic resume at <time dateTime={event.resetAt}>{event.resetAt}</time></p> : null}
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-normal leading-relaxed">{event.detail || "No error details were provided."}</pre>
      </>}
    </div>
  </details>;
}
