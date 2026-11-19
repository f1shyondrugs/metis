"use client";

import { X } from "lucide-react";
import { ReferenceLink } from "@/components/reference-link";
import type { ReferenceResult } from "@/lib/reference-search";

export function ComposerReferenceChips<T extends ReferenceResult>({
  references, onRemove,
}: { references: readonly T[]; onRemove: (reference: T) => void }) {
  if (!references.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Selected references">
      {references.map((reference) => (
        <div
          key={JSON.stringify([reference.kind, reference.id])}
          className="inline-flex min-w-0 max-w-full items-stretch gap-0.5 rounded-md border border-border/60 bg-muted/25 text-xs text-muted-foreground [&>span]:flex [&>span]:min-w-0"
        >
          <ReferenceLink reference={reference} appearance="chip">
            <span className="shrink-0" aria-hidden="true">@</span>
            <span className="max-w-48 truncate">{reference.label}</span>
          </ReferenceLink>
          <button
            type="button"
            aria-label={`Remove reference: ${reference.label}`}
            className="grid size-6 shrink-0 place-items-center rounded-r-[5px] hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:coarse)]:size-8"
            onClick={() => onRemove(reference)}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
