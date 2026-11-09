import { randomUUID } from "node:crypto";
import { clearStoreCaches, deleteChat, getChat, saveChat } from "@/lib/db-store";
import { projectRole } from "@/lib/project-access";
import { getDatabase, transaction } from "@/lib/sqlite";
import type { Chat } from "@/lib/store";

export type DeletedChat = { id: string; title: string; deletedAt: string };
type TrashRow = { id: string; owner_id: string; project_id: string | null; title: string; data: string; related_data: string; deleted_at: string };
// User artifacts survive a round trip. Executing jobs, approvals and queued work never resume.
const relatedTables = ["chat_user_settings", "tool_revert_snapshots", "session_snapshots", "chat_model_chains"] as const;
const accessSql = `((d.owner_id = ? AND (d.project_id IS NULL OR NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=d.project_id)
  OR EXISTS(SELECT 1 FROM projects p WHERE p.id=d.project_id AND (p.owner_id=? OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?)))))
  OR EXISTS(SELECT 1 FROM projects p WHERE p.id=d.project_id AND p.owner_id=?))`;

function rowForUser(id: string, userId: string) {
  return getDatabase().prepare(`SELECT d.* FROM deleted_chats d WHERE d.id=? AND ${accessSql}`)
    .get(id, userId, userId, userId, userId) as TrashRow | undefined;
}
export function listDeletedChats(userId: string): DeletedChat[] {
  return (getDatabase().prepare(`SELECT d.id,d.title,d.deleted_at FROM deleted_chats d WHERE ${accessSql} ORDER BY d.deleted_at DESC,d.id`)
    .all(userId,userId,userId,userId) as Pick<TrashRow,"id"|"title"|"deleted_at">[])
    .map(row=>({id:row.id,title:row.title,deletedAt:row.deleted_at}));
}
export function moveChatToTrash(id: string, userId: string): boolean {
  return transaction(()=>{
    const visible = getChat(id,userId);
    if(!visible || (visible.ownerId!==userId && projectRole(visible.projectId,userId)!=="owner")) return false;
    const chat = getChat(id)!; // Save canonical data, never another member's personal projection.
    if(chat.incognito) return deleteChat(id,userId);
    const db=getDatabase(), related:Record<string,unknown>={};
    for(const table of relatedTables) related[table]=db.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).all(id);
    db.prepare("INSERT INTO deleted_chats(id,owner_id,project_id,title,data,related_data,deleted_at) VALUES(?,?,?,?,?,?,?)")
      .run(id,chat.ownerId || userId,chat.projectId || null,chat.title,JSON.stringify(chat),JSON.stringify(related),new Date().toISOString());
    if(!deleteChat(id,userId)) throw new Error("Could not move chat to Recently deleted.");
    return true;
  });
}
export function restoreDeletedChat(id: string,userId: string): boolean {
  return transaction(()=>{
    const row=rowForUser(id,userId);
    if(!row) return false;
    const db=getDatabase();
    if(db.prepare("SELECT 1 FROM chats WHERE id=?").get(id)) throw new Error("A chat with this ID already exists.");
    const chat=JSON.parse(row.data) as Chat;
    chat.archived=false;
    chat.runStatus="idle";
    delete chat.pendingQuestion; delete chat.pendingApproval; delete chat.queuedMessages;
    delete chat.queueMessage; delete chat.approvedPatterns;
    // Old public URLs/cookies must stay revoked after restoration.
    if(chat.share) chat.share={...chat.share,active:false,accessKey:randomUUID()};
    if(chat.projectId && !db.prepare("SELECT 1 FROM projects WHERE id=?").get(chat.projectId)) delete chat.projectId;
    db.prepare("DELETE FROM deleted_chats WHERE id=?").run(id);
    saveChat(chat);
    const related=JSON.parse(row.related_data) as Record<string,Record<string,string|number|null>[]>;
    for(const table of relatedTables) {
      const columns=(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name);
      for(const record of related[table] || []) {
        if(record.chat_id!==id) continue;
        // A model chain or project member may have been removed while in the trash.
        if(table==="chat_model_chains" && !db.prepare("SELECT 1 FROM model_chains WHERE id=?").get(record.chain_id)) continue;
        if(record.user_id && !db.prepare("SELECT 1 FROM users WHERE id=?").get(record.user_id)) continue;
        if(record.owner_id && !db.prepare("SELECT 1 FROM users WHERE id=?").get(record.owner_id)) continue;
        db.prepare(`INSERT OR IGNORE INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`)
          .run(...columns.map(c=>record[c] ?? null));
      }
    }
    clearStoreCaches();
    return true;
  });
}
export function permanentlyDeleteChat(id: string,userId: string): boolean {
  return transaction(()=>{
    if(!rowForUser(id,userId)) return false;
    return getDatabase().prepare("DELETE FROM deleted_chats WHERE id=?").run(id).changes>0;
  });
}
