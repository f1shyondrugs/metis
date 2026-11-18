"use client";

import { File, X } from "lucide-react";
import { HoverCard } from "radix-ui";
import type { ReactElement } from "react";
import { FileEmbed } from "@/components/file-embed";
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

export function ChatAttachmentPreviews({ attachments, chatId, label = "Attachments", onRemove, className, previewOnly = false }: {
  attachments?: readonly ChatAttachment[];
  chatId?: string | null;
  label?: string;
  onRemove?: (id: string) => void;
  className?: string;
  previewOnly?: boolean;
}) {
  if (!attachments?.length) return null;
  return (
    <div role="group" aria-label={label} className={cn(
      previewOnly ? "grid gap-2" : "flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1",
      className,
    )}>
      {attachments.map((attachment) => {
        const url = chatAttachmentUrl(attachment, chatId);
        return (
          <div key={attachment.id} className={cn(
            "relative min-w-0 rounded-lg border border-border/40 bg-background/40",
            !previewOnly && "w-80 max-w-full shrink-0",
          )}>
            {previewOnly && url && <div className="truncate px-2 py-1.5 text-xs text-muted-foreground" title={attachment.name}>{attachment.name}</div>}
            {url ? (
              <FileEmbed key={url} file={{ ...attachment, url }} previewOnly={previewOnly}
                resizable={false} className={cn("rounded-[inherit]", previewOnly || onRemove ? "max-h-56" : "max-h-96")} />
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

/** Open above the queue row without moving its drag handle or action buttons. */
export function QueuedAttachmentPreview({ attachments, chatId, suspended, children }: {
  attachments: readonly ChatAttachment[];
  chatId?: string | null;
  suspended?: boolean;
  children: ReactElement;
}) {
  if (!attachments.length) return children;
  return (
    <HoverCard.Root openDelay={160} closeDelay={140}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      {!suspended && (
        <HoverCard.Portal>
          <HoverCard.Content side="top" align="start" sideOffset={6} collisionPadding={8}
            className="z-50 w-[min(26rem,calc(100vw-1rem))] max-h-[min(22rem,var(--radix-hover-card-content-available-height))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
            <ChatAttachmentPreviews attachments={attachments} chatId={chatId} label="Queued attachment previews" previewOnly />
          </HoverCard.Content>
        </HoverCard.Portal>
      )}
    </HoverCard.Root>
  );
}
