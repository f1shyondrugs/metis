"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { activityRowClass } from "@/lib/activity-display";
import { cn } from "@/lib/utils";

/** Shared row and state indicator for compact inline chat disclosures. */
export function ActivityDisclosureTrigger({ expanded, controls, onClick, leading, children }: {
  expanded: boolean;
  controls: string;
  onClick: () => void;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(activityRowClass, "rounded-sm focus-visible:outline-2 focus-visible:outline-ring")}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      {leading ?? <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0 transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />}
      {children}
    </button>
  );
}
