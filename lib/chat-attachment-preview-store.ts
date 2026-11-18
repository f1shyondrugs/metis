import { getDatabase, parseData } from "@/lib/sqlite";
import type { Chat } from "@/lib/store";
import { MAX_ATTACHMENTS } from "@/lib/upload-limits";
import type { StoredAttachment } from "@/lib/uploads";

/** Retain only the last attachments moved to this account's draft, not all files on disk. */
export function retainDraftAttachmentPreviews(chatId: string, viewerId: string, attachments?: readonly StoredAttachment[]) {
  const db = getDatabase();
  if (!attachments?.length) {
    db.prepare("DELETE FROM chat_draft_attachment_previews WHERE chat_id=? AND user_id=?").run(chatId, viewerId);
    return;
  }
  db.prepare(`INSERT INTO chat_draft_attachment_previews(chat_id,user_id,attachments) VALUES(?,?,?)
    ON CONFLICT(chat_id,user_id) DO UPDATE SET attachments=excluded.attachments`)
    .run(chatId, viewerId, JSON.stringify(attachments.slice(0, MAX_ATTACHMENTS)));
}

/** The caller has already read the chat with the exact requester's permissions. */
export function findChatAttachmentForPreview(chat: Chat, storedName: string, viewerId?: string) {
  for (const message of chat.messages) {
    const attachment = message.attachments?.find((item) => item.storedName === storedName);
    if (attachment) return attachment;
  }
  if (!viewerId) return undefined;
  for (const message of chat.queuedMessages ?? []) {
    const attachment = message.attachments?.find((item) => item.storedName === storedName);
    if (attachment) return attachment;
  }
  const row = getDatabase().prepare("SELECT attachments AS data FROM chat_draft_attachment_previews WHERE chat_id=? AND user_id=?")
    .get(chat.id, viewerId);
  return parseData<StoredAttachment[]>(row)?.find((item) => item.storedName === storedName);
}
