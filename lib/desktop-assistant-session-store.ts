import { getDatabase, transaction } from "@/lib/sqlite";
import { getChatMetadata, getChat, removeQueuedMessage } from "@/lib/db-store";
import { getRemoteClient } from "@/lib/remote-clients";
import { EMPTY_ASSISTANT_SESSION, assistantPanelSize, type AssistantSession, type AssistantSessionPatch } from "./desktop-assistant-session";
const initialized=new WeakSet<object>();
function database(){
 const db=getDatabase();
 if(!initialized.has(db)){
  db.exec("CREATE TABLE IF NOT EXISTS desktop_assistant_sessions (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_id TEXT NOT NULL REFERENCES remote_clients(id) ON DELETE CASCADE, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner_id,device_id))");
  initialized.add(db);
 }
 return db;
}
export class AssistantSessionError extends Error {
 constructor(message:string,public status:number){super(message);}
}
function device(ownerId:string,deviceId:string) {
 const client=getRemoteClient(deviceId,ownerId);
 if(!client||client.revokedAt)throw new AssistantSessionError("Device not found.",404);
}
export function getAssistantSession(ownerId:string,deviceId:string):AssistantSession {
 device(ownerId,deviceId);
 const row=database().prepare("SELECT data,version FROM desktop_assistant_sessions WHERE owner_id=? AND device_id=?").get(ownerId,deviceId) as {data:string;version:number}|undefined;
 const session:AssistantSession=row?{...JSON.parse(row.data),version:row.version}:{...EMPTY_ASSISTANT_SESSION,draft:{text:""}};
 // A remembered identity grants no access after deletion, expiry or revocation.
 if(session.chatId&&!getChatMetadata(session.chatId,ownerId))return {...session,chatId:null,draft:{text:""}};
 return session;
}
export function saveAssistantSession(ownerId:string,deviceId:string,version:number,patch:AssistantSessionPatch,editQueueId?:string) {
 return transaction(()=>{
  const current=getAssistantSession(ownerId,deviceId);
  if(current.version!==version)throw new AssistantSessionError("This assistant changed in another window. Reload it before saving.",409);
  const next:AssistantSession={...current,draft:{...current.draft},version:version+1};
  if(patch.chatId!==undefined) {
   if(patch.chatId!==null&&(typeof patch.chatId!=="string"||!getChatMetadata(patch.chatId,ownerId)))throw new AssistantSessionError("Chat not found.",404);
   next.chatId=patch.chatId;
  }
  if(patch.draftText!==undefined){
   if(typeof patch.draftText!=="string"||patch.draftText.length>100_000)throw new AssistantSessionError("Draft is too long.",400);
   next.draft.text=patch.draftText;
  }
  if(patch.clearContext===true)next.draft={text:next.draft.text};
  if(patch.panelSize!==undefined)next.panelSize=assistantPanelSize(patch.panelSize);
  if(editQueueId!==undefined){
   if(!next.chatId)throw new AssistantSessionError("Chat not found.",404);
   const chat=getChat(next.chatId,ownerId),message=chat?.queuedMessages?.find(item=>item.id===editQueueId);
   if(!message)throw new AssistantSessionError("This message has already left the queue. Your draft is preserved.",409);
   next.draft={text:message.text,referenceText:message.referenceText,references:message.references,attachments:message.attachments,...(message.assistantDeviceId?{assistantDeviceId:message.assistantDeviceId}:{})};
   removeQueuedMessage(next.chatId,editQueueId,ownerId);
  }
  database().prepare("INSERT INTO desktop_assistant_sessions(owner_id,device_id,version,data) VALUES(?,?,?,?) ON CONFLICT(owner_id,device_id) DO UPDATE SET version=excluded.version,data=excluded.data").run(ownerId,deviceId,next.version,JSON.stringify(next));
  return next;
 });
}
