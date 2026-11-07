import type { DatabaseSync } from "node:sqlite";
import { referenceFiles } from "./reference-files";
import { getChatMetadata } from "./db-store";
import { chatForUser } from "./project-access";
import type { Chat,ChatIndexEntry } from "./store";
import type { ReferenceResult } from "./reference-search";
import { normalizeReferenceText, referenceMatches } from "./reference-search";
const initializedDatabases = new WeakSet<DatabaseSync>();
const versionDatabases = new WeakSet<DatabaseSync>();
function initializeVersionIndexes(db:DatabaseSync){
 if(versionDatabases.has(db))return;
 // Both rows contain potentially large JSON. A covering lookup must avoid those pages.
 db.exec("CREATE INDEX IF NOT EXISTS chats_reference_version ON chats(id,updated_at); CREATE INDEX IF NOT EXISTS chat_pages_reference_revision ON chat_page_state(chat_id,revision)");
 versionDatabases.add(db);
}

function initializeTitleMatch(db:DatabaseSync){
 if (!initializedDatabases.has(db)) {
  db.function("reference_title_match", { deterministic: true }, (label, query) => Number(referenceMatches(String(query || ""), String(label || ""))));
  initializedDatabases.add(db);
 }
}
export function initializeReferenceIndex(db:DatabaseSync){
 initializeTitleMatch(db);
 db.exec("PRAGMA busy_timeout=100;");
 initializeVersionIndexes(db);
 db.exec("CREATE TABLE IF NOT EXISTS chat_reference_state(chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,version TEXT NOT NULL);"+
  "CREATE TABLE IF NOT EXISTS chat_reference_files(chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(chat_id,position));"+
  "CREATE TABLE IF NOT EXISTS chat_reference_metadata(chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,version TEXT NOT NULL,data TEXT NOT NULL);"+
  "CREATE TEMP TABLE IF NOT EXISTS reference_staging(position INTEGER PRIMARY KEY,data TEXT NOT NULL,normalized TEXT NOT NULL);");
 const columns=db.prepare("PRAGMA table_info(chat_reference_files)").all() as {name:string}[];
 if(!columns.some(column=>column.name==="normalized"))db.exec("ALTER TABLE chat_reference_files ADD COLUMN normalized TEXT");
}
export function referenceVersion(db:DatabaseSync,chatId:string){
 initializeVersionIndexes(db);
 return (db.prepare("SELECT 'n2:'||COALESCE(s.revision,0)||':'||c.updated_at AS version FROM chats c INDEXED BY chats_reference_version LEFT JOIN chat_page_state s INDEXED BY chat_pages_reference_revision ON s.chat_id=c.id WHERE c.id=?").get(chatId) as {version:string}|undefined)?.version;
}
export async function prepareReferenceMetadata(db:DatabaseSync,chatId:string){
 const version=referenceVersion(db,chatId);
 if(!version)return;
 const chat=getChatMetadata(chatId);
 if(!chat)return;
 const metadata={id:chat.id,ownerId:chat.ownerId,projectId:chat.projectId,title:chat.title,keywords:chat.keywords,
  createdAt:chat.createdAt,updatedAt:chat.updatedAt,messages:[],
  workspaces:chat.workspaces?.map(workspace=>({...workspace,content:workspace.content.slice(0,6000)})),
  browserContext:chat.browserContext,
  sessionState:chat.sessionState?{terminalTabs:chat.sessionState.terminalTabs,terminalSessionId:chat.sessionState.terminalSessionId,
   terminalCwd:chat.sessionState.terminalCwd,remoteCwd:chat.sessionState.remoteCwd}:undefined};
 db.prepare("INSERT INTO chat_reference_metadata VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET version=excluded.version,data=excluded.data").run(chatId,version,JSON.stringify(metadata));
}
export function indexedChatMetadata(db:DatabaseSync,entry:ChatIndexEntry,ownerId:string,schedule:(id:string,title:string,part?:"metadata"|"files")=>void){
 const state=db.prepare("SELECT revision,ready_revision,metadata FROM chat_page_state WHERE chat_id=?").get(entry.id) as {revision:number;ready_revision:number;metadata:string|null}|undefined;
 if(state?.metadata && state.revision===state.ready_revision)return {chat:chatForUser({...JSON.parse(state.metadata),messages:[]},ownerId),indexing:false};
 const snapshot=db.prepare("SELECT version,data FROM chat_reference_metadata WHERE chat_id=?").get(entry.id) as {version:string;data:string}|undefined;
 const indexing=snapshot?.version!==referenceVersion(db,entry.id);
 if(indexing)schedule(entry.id,entry.title,"metadata");
 return {chat:chatForUser(snapshot?JSON.parse(snapshot.data) as Chat:{...entry,messages:[]} as Chat,ownerId),indexing};
}
/** TEMP staging avoids holding the main writer lock during legacy JSON extraction. */
export async function prepareReferenceIndex(db:DatabaseSync,chatId:string,title:string){
 const version=referenceVersion(db,chatId);
 if(!version)return;
 db.exec("DELETE FROM temp.reference_staging");
 const insert=db.prepare("INSERT INTO temp.reference_staging VALUES(?,?,?)");
 let position=0;
 await referenceFiles(db,chatId,title,"",item=>insert.run(position++,JSON.stringify(item),
  normalizeReferenceText([item.label,item.detail,item.path,item.content].filter(Boolean).join(" "))),()=>{},()=>false);
 if(!referenceVersion(db,chatId))return;
 db.exec("BEGIN IMMEDIATE");
 try{
  db.prepare("DELETE FROM chat_reference_files WHERE chat_id=?").run(chatId);
  db.prepare("INSERT INTO chat_reference_files(chat_id,position,data,normalized) SELECT ?,position,data,normalized FROM temp.reference_staging").run(chatId);
  db.prepare("INSERT INTO chat_reference_state VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET version=excluded.version").run(chatId,version);
  db.exec("COMMIT");
 }catch(error){db.exec("ROLLBACK");throw error;}
 finally{db.exec("DELETE FROM temp.reference_staging");}
}
export function indexedReferenceFiles(db:DatabaseSync,chatId:string,title:string,query:string,
 push:(item:ReferenceResult)=>void,full:()=>boolean,schedule:(chatId:string,title:string,part?:"metadata"|"files")=>void,limit=80){
 initializeTitleMatch(db);
 const version=referenceVersion(db,chatId);
 const indexed=db.prepare("SELECT version FROM chat_reference_state WHERE chat_id=?").get(chatId) as {version:string}|undefined;
 const indexing=!!version && indexed?.version!==version;
 if(indexing)schedule(chatId,title,"files");
 // Filter compact text in SQLite; never parse tens of thousands of JSON rows per keystroke.
 const terms=normalizeReferenceText(query).trim().split(/\s+/).filter(Boolean);
 const match=terms.map(()=>"instr(normalized,?)>0").join(" AND ");
 for(const row of db.prepare("SELECT data FROM chat_reference_files WHERE chat_id=? AND normalized IS NOT NULL"+
  (match?" AND "+match:"")+" ORDER BY reference_title_match(json_extract(data,\'$.label\'),?) DESC,position LIMIT ?").iterate(chatId,...terms,query,limit)){
  push(JSON.parse(String(row.data)) as ReferenceResult);
  if(full())break;
 }
 return indexing;
}
