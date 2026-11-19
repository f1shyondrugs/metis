"use client";

import { useId, useState, type ReactNode } from "react";
import { ActivityDisclosureTrigger } from "@/components/activity-disclosure-trigger";

export function SetupDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <div className="[&>button]:min-h-11 [&>button]:max-w-full [&>button]:text-xs [&>button]:text-muted-foreground [&>button:hover]:text-foreground">
    <ActivityDisclosureTrigger expanded={open} controls={id} onClick={() => setOpen(value => !value)}>
      {label}
    </ActivityDisclosureTrigger>
    <div id={id} hidden={!open} className="pl-4 pb-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </div>
  </div>;
}
