import {getDatabase} from "./sqlite";
import type {RemotePresence} from "./remote-presence";
import {applyRuntimeCapabilities} from "./remote-security";
export function initialize(){getDatabase().exec("PRAGMA busy_timeout=100");}
export function writePresence(updates:RemotePresence[]){
 const db=getDatabase();
 db.exec("BEGIN IMMEDIATE");
 try{
  for(const update of updates){
   const row=db.prepare("SELECT capabilities,last_seen_at FROM remote_clients WHERE id=? AND owner_id=? AND revoked_at IS NULL")
    .get(update.clientId,update.ownerId) as {capabilities:string;last_seen_at:string|null}|undefined;
   if(!row || (row.last_seen_at && row.last_seen_at>update.at))continue;
   let capabilities=row.capabilities;
   if(update.status==="online" && (typeof update.desktopGui==="boolean" || typeof update.overlayAnnotations==="boolean")){
    let values:string[]=[];try{values=JSON.parse(capabilities);}catch{}
    capabilities=JSON.stringify(applyRuntimeCapabilities(Array.isArray(values)?values:[],update));
   }
   db.prepare("UPDATE remote_clients SET status=?,last_seen_at=CASE WHEN ?='online' THEN ? ELSE last_seen_at END,address=COALESCE(?,address),capabilities=?,updated_at=CASE WHEN updated_at>? THEN updated_at ELSE ? END WHERE id=? AND owner_id=? AND revoked_at IS NULL")
    .run(update.status,update.status,update.at,update.address??null,capabilities,update.at,update.at,update.clientId,update.ownerId);
   if(update.credentialHash){
    const at=update.credentialUsedAt??update.at;
    db.prepare("UPDATE remote_client_credentials SET last_used_at=CASE WHEN last_used_at IS NULL OR last_used_at<? THEN ? ELSE last_used_at END WHERE client_id=? AND secret_hash=? AND revoked_at IS NULL")
     .run(at,at,update.clientId,update.credentialHash);
   }
  }
  db.exec("COMMIT");
 }catch(error){db.exec("ROLLBACK");throw error;}
}
