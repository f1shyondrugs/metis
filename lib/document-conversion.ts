import {createHash,randomUUID} from "node:crypto";
import {getDatabase,transaction} from "@/lib/sqlite";
import {createChat,getChat,getGlobalModelSettings,updateChat} from "@/lib/db-store";
import {createNote,getNote,MAX_NOTE_CONTENT_LENGTH} from "@/lib/shared-context";
import {featureFlags} from "@/lib/feature-flags";
import {availableWorkspaceName} from "@/lib/workspace-create";
import {workspaceContentError} from "@/lib/workspace-limits";
import type {ConvertedDocument,ConversionSource,DocumentKind} from "@/lib/document-conversion-types";
import type {WorkspaceItem} from "@/lib/store";

export class ConversionError extends Error {constructor(message:string,public status=400){super(message);}}
const fail=(message:string,status=400):never=>{throw new ConversionError(message,status);};
const kind=(value:unknown):value is DocumentKind=>value==="canvas"||value==="plan"||value==="note";

/** Copy conversion: originals, references, subfiles, history and sharing remain untouched. */
export function convertDocument(input:unknown,userId:string):ConvertedDocument {
 if(!input||typeof input!=="object"||Array.isArray(input))return fail("Invalid conversion request.");
 const body=input as Record<string,unknown>,source=body.source as ConversionSource;
 if(!source||!kind(source.kind)||typeof source.id!=="string"||!source.id||source.id.length>200||
  !Number.isSafeInteger(source.version)||source.version<1||typeof source.title!=="string"||!source.title.trim()||source.title.length>200||
  typeof source.content!=="string"||!kind(body.target)||body.target===source.kind||
  typeof body.requestId!=="string"||! /^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId))return fail("A source, different target and request ID are required.");
 const target=body.target,requestId=body.requestId;
 if(!featureFlags(getGlobalModelSettings(userId)).notes&&(source.kind==="note"||target==="note"))return fail("Notes are disabled.",404);
 // Check destination limits before SQLite stores an idempotency payload. Never truncate Markdown.
 if(target==="note"&&source.content.length>MAX_NOTE_CONTENT_LENGTH)return fail("Notes support up to 50,000 characters. The original has not been changed.",413);
 const limitError=target!=="note"?workspaceContentError({type:target},source.content):undefined;
 if(limitError)return fail(limitError,413);
 const db=getDatabase();
 db.exec("CREATE TABLE IF NOT EXISTS document_conversions (owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner_id,request_id))");
 const fingerprint=createHash("sha256").update(JSON.stringify({source,target})).digest("hex");
 return transaction(()=>{
  let projectId:string|undefined,sourceChat:ReturnType<typeof getChat>=null;
  if(source.kind==="note"){
   const note=getNote(source.id,userId);
   if(!note||note.archived)return fail("Note not found.",404);
   if(note.kind!=="note"&&note.kind!==undefined||note.issueId||note.asset)return fail("Only Markdown notes can be converted.");
   projectId=note.projectId;
  }else{
   if(typeof source.chatId!=="string")return fail("Source chat is required.");
   sourceChat=getChat(source.chatId,userId);
   if(!sourceChat||!sourceChat.workspaces?.some(w=>w.id===source.id&&w.type===source.kind))return fail("Workspace not found.",404);
   if(sourceChat.incognito)return fail("Workspaces are unavailable in Incognito.",403);
   projectId=sourceChat.projectId;
  }
  const previous=db.prepare("SELECT fingerprint,result FROM document_conversions WHERE owner_id=? AND request_id=?").get(userId,requestId) as {fingerprint:string;result:string}|undefined;
  if(previous){
   if(previous.fingerprint!==fingerprint)return fail("This request ID was already used for another conversion.",409);
   const result=JSON.parse(previous.result) as ConvertedDocument;
   if(result.note){const note=getNote(result.note.id,userId);if(!note||note.archived)return fail("Converted note is no longer available.",404);return {...result,note};}
   const chat=result.chatId?getChat(result.chatId,userId):null;
   const workspace=chat?.workspaces?.find(w=>w.id===result.workspace?.id);
   if(!workspace)return fail("Converted workspace is no longer available.",404);
   return {...result,workspace};
  }
  const version=source.kind==="note"?getNote(source.id,userId)!.version:sourceChat!.workspaces!.find(w=>w.id===source.id)!.version||1;
  if(version!==source.version)return fail("The source changed elsewhere. Close this dialog and reopen the latest document before converting.",409);
  let result:ConvertedDocument;
  if(target==="note"){
   const note=createNote({ownerId:userId,scope:"global",projectId:projectId??null,title:source.title,content:source.content,kind:"note",icon:source.kind==="plan"?"lucide:list-checks":"lucide:file-text"});
   result={kind:"note",note};
  }else{
   // Notes have no chat container: create a normal, empty chat in the same project.
   const chat=sourceChat||createChat(source.title,undefined,userId,undefined,{projectId});
   if((chat.workspaces?.length||0)>=20)return fail("This chat already has 20 workspaces. The original has not been changed.",409);
   const now=new Date().toISOString(),workspace:WorkspaceItem={id:randomUUID(),type:target,name:availableWorkspaceName(chat.workspaces||[],source.title),content:source.content,createdAt:now,updatedAt:now,version:1,scope:"chat",idempotencyKey:"conversion:"+requestId};
   const saved=updateChat(chat.id,{workspaces:[...(chat.workspaces||[]),workspace]},userId);
   if(!saved?.workspaces?.some(w=>w.id===workspace.id))return fail("Could not save the converted document.",503);
   result={kind:target,chatId:chat.id,workspace};
  }
  db.prepare("INSERT INTO document_conversions(owner_id,request_id,fingerprint,result) VALUES(?,?,?,?)").run(userId,requestId,fingerprint,JSON.stringify(result));
  return result;
 });
}
