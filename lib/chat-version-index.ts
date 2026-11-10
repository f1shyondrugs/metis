import type { DatabaseSync } from "node:sqlite";

const initialized = new WeakSet<DatabaseSync>();

/** Both tables contain large JSON values; identity checks must use covering indexes. */
export function initializeChatVersionIndexes(db: DatabaseSync) {
  if (initialized.has(db)) return;
  db.exec("CREATE INDEX IF NOT EXISTS chats_reference_version ON chats(id,updated_at); CREATE INDEX IF NOT EXISTS chat_pages_reference_revision ON chat_page_state(chat_id,revision)");
  initialized.add(db);
}

export function readChatVersion(db: DatabaseSync, id: string) {
  initializeChatVersionIndexes(db);
  return db.prepare(`SELECT c.updated_at AS updatedAt,COALESCE(s.revision,0) AS revision
    FROM chats c INDEXED BY chats_reference_version
    LEFT JOIN chat_page_state s INDEXED BY chat_pages_reference_revision ON s.chat_id=c.id
    WHERE c.id=?`).get(id) as { updatedAt: string; revision: number } | undefined;
}
