"use client";

import { LinkIcon } from "@/components/link-icon";
import { createContext, useEffect, useState } from "react";
import { ClipboardList, LayoutDashboard, NotebookPen, Workflow } from "lucide-react";
import type { InternalLinkKind, InternalLinkPreview, InternalLinkTarget } from "@/lib/internal-link";

export const InternalLinkPreviewChat = createContext<string | null>(null);

const kinds = {
  plan: { label: "Plan", Icon: ClipboardList },
  canvas: { label: "Canvas", Icon: LayoutDashboard },
  note: { label: "Note", Icon: NotebookPen },
  automation: { label: "Automation", Icon: Workflow },
  issue: { label: "Issue", Icon: ClipboardList },
} satisfies Record<InternalLinkKind, { label: string; Icon: typeof ClipboardList }>;

export function InternalLinkPreviewContent({ target, chatId }: { target: InternalLinkTarget; chatId: string | null }) {
  const [preview, setPreview] = useState<InternalLinkPreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind: target.kind, id: target.id });
    if (chatId) params.set("chatId", chatId);
    fetch(`/api/internal-link-preview?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Preview unavailable");
        return response.json() as Promise<InternalLinkPreview>;
      })
      .then(value => { if (!controller.signal.aborted) { setPreview(value); setState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [target.kind, target.id, chatId]);

  const { label } = kinds[target.kind];
  return <div data-internal-preview={target.kind}>
    <div className="flex items-start gap-2.5">
      <LinkIcon kind={target.kind} id={target.id} icon={preview?.icon ?? null} className="mt-0.5 !mr-0 !size-4 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {preview ? <div className="mt-0.5 line-clamp-2 break-words text-xs font-medium leading-4 [overflow-wrap:anywhere]">{preview.title}</div> : null}
      </div>
    </div>
    {state === "loading" ? <p role="status" className="mt-2 text-[11px] text-muted-foreground">Loading preview…</p>
      : state === "error" ? <p role="status" className="mt-2 text-[11px] leading-4 text-muted-foreground">Preview unavailable. Click the link to open it.</p>
      : preview ? <>
        <p className="mt-2 line-clamp-3 whitespace-pre-line break-words text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{preview.description || "No content yet."}</p>
        {preview.details.length ? <dl className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[10px] leading-4">
          {preview.details.map(({ label: detailLabel, value }) => <div key={detailLabel} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">{detailLabel}</dt>
            <dd className="min-w-0 truncate text-right">{value}</dd>
          </div>)}
        </dl> : null}
      </> : null}
  </div>;
}
