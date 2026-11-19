"use client";

import { File, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { FileEmbed } from "@/components/file-embed";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StoredAttachment } from "@/lib/uploads";

export type ChatAttachment = Omit<StoredAttachment, "storedName" | "size"> &
  Partial<Pick<StoredAttachment, "storedName" | "size">> & { previewUrl?: string };

export function chatAttachmentUrl(attachment: ChatAttachment, chatId?: string | null) {
  if (attachment.storedName && chatId) {
    return `/api/uploads/${encodeURIComponent(chatId)}/${encodeURIComponent(attachment.storedName)}`;
  }
  return attachment.previewUrl;
}

export function ChatAttachmentPreviews({ attachments, chatId, label = "Attachments", onRemove, className, compact = false }: {
  attachments?: readonly ChatAttachment[];
  chatId?: string | null;
  label?: string;
  onRemove?: (id: string) => void;
  className?: string;
  compact?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <div role="group" aria-label={label} tabIndex={compact && attachments.length > 1 ? 0 : undefined} className={cn(
      "flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-2 focus-visible:outline-ring",
      className,
    )}>
      {attachments.map((attachment) => {
        const url = chatAttachmentUrl(attachment, chatId);
        return (
          <div key={attachment.id} className={cn(
            "relative min-w-0 rounded-lg border border-border/40 bg-background/40",
            "w-80 max-w-full shrink-0",
          )}>
            {url ? (
              <FileEmbed key={url} file={{ ...attachment, url }} textPreviewLimit={compact ? 8_001 : undefined}
                allowHorizontalScroll={compact && attachments.length > 1} resizable={false} className={cn("rounded-[inherit]", compact || onRemove ? "max-h-56" : "max-h-96")} />
            ) : (
              <div className={cn("flex items-center gap-2 p-3 text-xs text-muted-foreground", onRemove && "pr-11")}>
                <File aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate" title={attachment.name}>{attachment.name}</span>
                  Preview unavailable
                </span>
              </div>
            )}
            {onRemove && (
              <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}
                className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-background/90 text-muted-foreground ring-1 ring-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:size-11">
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Keep the queue row expanded while the pointer or keyboard is inside its portalled preview. */
export function QueuedAttachmentPreview({ attachments, chatId, suspended, children }: {
  attachments: readonly ChatAttachment[];
  chatId?: string | null;
  suspended?: boolean;
  children: (preview: { expanded: boolean; trigger: (label: ReactElement) => ReactElement }) => ReactElement;
}) {
  const [mode, setMode] = useState<"closed" | "peek" | "pinned">("closed");
  const row = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelFocused = useRef(false);
  const panelWasFocused = useRef(false);
  const available = attachments.length > 0 && !suspended;
  const open = available && mode !== "closed";
  const clearTimer = () => clearTimeout(timer.current);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!available) {
      clearTimeout(timer.current);
      setMode("closed");
    }
  }, [available]);

  function enter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch" || !available) return;
    clearTimer();
    if (!open) timer.current = setTimeout(() => setMode("peek"), 160);
  }

  function closePeek() {
    clearTimer();
    timer.current = setTimeout(() => {
      if (panelFocused.current || row.current?.matches(":hover") || panel.current?.matches(":hover")) return;
      setMode((current) => current === "peek" ? "closed" : current);
    }, 220);
  }

  function leave(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") closePeek();
  }

  if (!attachments.length) return children({ expanded: false, trigger: (label) => label });
  return (
    <Popover open={open} onOpenChange={(next) => {
      clearTimer();
      setMode(next ? "pinned" : "closed");
    }}>
      <PopoverAnchor asChild>
        <div ref={row} onPointerEnter={enter} onPointerLeave={leave}>
          {children({
            expanded: open,
            trigger: (label) => <PopoverTrigger asChild>
              <button type="button" aria-label="Preview queued attachments" disabled={!available}
                className="block min-w-0 w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
                onClick={(event) => {
                  event.preventDefault();
                  clearTimer();
                  setMode((current) => current === "pinned" ? "closed" : "pinned");
                  if (mode === "peek" && event.detail === 0) panel.current?.focus();
                }}>
                {label}
              </button>
            </PopoverTrigger>,
          })}
        </div>
      </PopoverAnchor>
      <PopoverContent ref={panel} side="top" align="start" sideOffset={6} collisionPadding={8} aria-label="Queued attachments"
        onPointerEnter={enter} onPointerLeave={leave}
        onFocusCapture={() => { panelFocused.current = true; panelWasFocused.current = true; clearTimer(); }}
        onBlurCapture={() => { panelFocused.current = false; closePeek(); }}
        onOpenAutoFocus={(event) => { if (mode === "peek") event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          // A pointer-only preview should never steal focus from another control.
          if (!panelWasFocused.current) event.preventDefault();
          panelFocused.current = false;
          panelWasFocused.current = false;
        }}
        className="w-[min(26rem,calc(100vw-1rem))] max-h-[min(22rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-2">
        <ChatAttachmentPreviews attachments={attachments} chatId={chatId} label="Queued attachment previews" compact />
      </PopoverContent>
    </Popover>
  );
}
