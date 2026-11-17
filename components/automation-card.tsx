"use client";

import {AutomationIcon} from "./automation-icon";
import { ExternalLink } from "lucide-react";

export type AutomationCardProps = {
  actionLabel: string;
  title: string;
  icon?:string|null;
  prompt?: string;
  scheduleLabel?: string;
  automationLink?: string;
  onOpen?: () => void;
};

export function AutomationCard({
  actionLabel,
  title,
  icon,
  prompt,
  scheduleLabel,
  automationLink,
  onOpen,
}: AutomationCardProps) {
  return (
    <section className="my-2.5 w-full rounded-lg border border-border/50 border-l-teal-400/70 bg-muted/20 p-2.5">
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-400/10 text-teal-300">
          <AutomationIcon value={icon} className="size-3.5"/>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-teal-300/80">
            {actionLabel}
          </p>
          <a
            href={automationLink || "#automations"}
            className="block truncate text-[13px] font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary"
            title={title}
            onClick={(event) => {
              event.preventDefault();
              onOpen?.();
            }}
          >
            {title}
          </a>
          {scheduleLabel ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{scheduleLabel}</p>
          ) : null}
          <p className="mt-0.5 max-h-20 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
            {prompt || "No automation details available yet."}
          </p>
          {automationLink ? (
            <p className="mt-1 truncate text-[10px] text-muted-foreground/70">{automationLink}</p>
          ) : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open automation"
            title="Open automation"
            onClick={onOpen}
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      {onOpen ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onOpen}
          >
            Open automation
          </button>
        </div>
      ) : null}
    </section>
  );
}
