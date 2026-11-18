import type { ChatIndexEntry } from "@/lib/store";

export const CHAT_LIST_PAGE_SIZE = 30;
export const CHAT_LIST_MAX_PAGE_SIZE = 100;
export type ChatListCursor = { pinned: number; sentAt: string; id: string };
export type ChatListPage = { chats: ChatIndexEntry[]; nextCursor: string | null };

export function chatListCursor(chat: ChatIndexEntry): ChatListCursor {
  return { pinned: chat.pinned ? 1 : 0, sentAt: chat.lastMessageSent ?? chat.createdAt, id: chat.id };
}

export function encodeChatListCursor(chat: ChatIndexEntry): string {
  return Buffer.from(JSON.stringify(chatListCursor(chat))).toString("base64url");
}

export function decodeChatListCursor(value: string): ChatListCursor {
  try {
    if (value.length > 2048 || !/^[\w-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || ![0, 1].includes(cursor.pinned) ||
        typeof cursor.sentAt !== "string" || cursor.sentAt.length > 100 ||
        typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200) throw new Error();
    return { pinned: cursor.pinned, sentAt: cursor.sentAt, id: cursor.id };
  } catch {
    throw new Error("Invalid chat list cursor");
  }
}
