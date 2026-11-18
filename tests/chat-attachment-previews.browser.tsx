import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GripVertical, Pencil, X } from "lucide-react";
import { ChatAttachmentPreviews, QueuedAttachmentPreview, type ChatAttachment } from "../components/chat-attachment-previews";
import { QueuedPromptPreview } from "../components/queued-prompt-preview";

const chatId = "fixture-chat";
const attachments: ChatAttachment[] = [
  { id: "photo", name: "image.png", kind: "image", mimeType: "image/png", previewUrl: "/api/file-uploads/11111111-1111-4111-8111-111111111111/file" },
  { id: "notes", name: "notes.txt", kind: "file", mimeType: "text/plain", storedName: "fixture notes.txt" },
];

function Fixture() {
  const [draft, setDraft] = useState<ChatAttachment[] | null>(null);
  return (
    <main style={{ position: "fixed", left: 0, right: 0, bottom: 24, maxWidth: 704, marginInline: "auto" }} className="space-y-2 px-3">
      {draft ? (
        <ChatAttachmentPreviews attachments={draft} chatId={chatId} label="Restored attachments"
          onRemove={(id) => setDraft(draft.filter((attachment) => attachment.id !== id))} />
      ) : (
        <QueuedAttachmentPreview attachments={attachments} chatId={chatId}>
          <div tabIndex={0} aria-label="Queued message 1" className="group/queue flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 text-xs">
            <GripVertical aria-hidden="true" className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 pt-1.5">
              <QueuedPromptPreview text="1. Can you look at these?" />
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                {attachments.map((attachment) => <span key={attachment.id} className="rounded border border-border/50 px-1.5 py-0.5">{attachment.name}</span>)}
              </div>
            </div>
            <button type="button" className="h-7 shrink-0 px-2">Send now</button>
            <button type="button" className="grid size-7 place-items-center" aria-label="Edit queued message" onClick={() => setDraft(attachments)}>
              <Pencil className="size-3.5" />
            </button>
            <button type="button" className="grid size-7 place-items-center" aria-label="Remove queued message"><X className="size-3.5" /></button>
          </div>
        </QueuedAttachmentPreview>
      )}
      <textarea aria-label="Message Metis" className="block h-20 w-full resize-none rounded-xl border border-border/50 bg-muted/30 p-3 text-sm" placeholder="Message Metis…" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
