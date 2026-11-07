"use client";

import { useState } from "react";
import { ChevronDown, Link2 } from "lucide-react";
import { WebsiteIcon } from "@/components/website-icon";
import { sourceFaviconUrl, type SourceLink } from "@/lib/message-sources";

export function MessageSources({ sources }: { sources: SourceLink[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="group mt-3 text-muted-foreground" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium marker:hidden [&::-webkit-details-marker]:hidden hover:text-foreground">
        <Link2 className="size-3.5 shrink-0" />
        <span>Sources</span>
        <span className="text-[10px] opacity-70">({sources.length})</span>
        <ChevronDown className="ml-auto size-3.5 opacity-60 transition-transform group-open:rotate-180" />
      </summary>
      {expanded ? (
        <ol className="mt-1.5 max-h-80 space-y-1 overflow-y-auto pl-5">
          {sources.map((source, index) => (
            <li key={source.url} className="flex min-w-0 items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 opacity-60">{index + 1}.</span>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 underline decoration-border underline-offset-2 hover:text-foreground"
                title={source.url}
              >
                <WebsiteIcon src={sourceFaviconUrl(source.url)} />
                <span className="min-w-0 truncate">{source.label}</span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
