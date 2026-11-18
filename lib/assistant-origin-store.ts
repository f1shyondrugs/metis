import { getDatabase } from "@/lib/sqlite";
import { assistantOriginId } from "@/lib/desktop-assistant";
const initialized = new WeakSet<object>();

/** Message-scoped handoff survives supervisors which predate assistantDeviceId. */
export function rememberAssistantOrigin(ownerId:string|undefined,chatId:string,messageId:string,value:unknown) {
  const id=assistantOriginId(value);
  if(!ownerId||!id)return;
  const db=getDatabase();
  if(!initialized.has(db)){
    db.exec("CREATE TABLE IF NOT EXISTS assistant_message_origins (chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, message_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id TEXT NOT NULL, PRIMARY KEY(chat_id,message_id))");
    initialized.add(db);
  }
  db.prepare("INSERT OR IGNORE INTO assistant_message_origins(chat_id,message_id,owner_id,device_id) VALUES(?,?,?,?)").run(chatId,messageId,ownerId,id);
}

/** Read only; ordinary turns do not create tables or inherit another message's origin. */
export function storedAssistantOrigin(ownerId:string|undefined,chatId:string|undefined,messageId:string|undefined) {
  if(!ownerId||!chatId||!messageId)return undefined;
  try {
    const row=getDatabase().prepare("SELECT device_id FROM assistant_message_origins WHERE chat_id=? AND message_id=? AND owner_id=?").get(chatId,messageId,ownerId) as {device_id:string}|undefined;
    return assistantOriginId(row?.device_id);
  } catch { return undefined; }
}
