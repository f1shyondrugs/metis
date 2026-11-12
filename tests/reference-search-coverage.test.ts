import assert from "node:assert/strict";
import test,{before,after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-reference-coverage-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_LEGACY_HEADER_AUTH:"false"});
let owner:string,token:string,chatId:string;
let route:typeof import("../app/api/references/route");
before(async()=>{
 const auth=await import("../lib/auth"),store=await import("../lib/db-store"),notes=await import("../lib/shared-context");
 owner=auth.createUser("coverage-owner","synthetic-test-password").id;
 token=auth.authenticateUser("coverage-owner","synthetic-test-password")!.token;
 const foreign=auth.createUser("coverage-other","synthetic-test-password").id;
 const stamp=new Date().toISOString(),chat=store.createChat("Unrelated conversation",undefined,owner);chatId=chat.id;
 chat.messages=Array.from({length:100},(_,i)=>({id:"body-"+i,role:"user" as const,content:"Only inside messages: bodyonlyneedle",createdAt:stamp}));
 chat.workspaces=[{id:"long-plan",type:"plan",name:"Long plan",content:"x".repeat(9000)+" tailplanneedle",createdAt:stamp,updatedAt:stamp},{id:"long-canvas",type:"canvas",name:"Long canvas",content:"x".repeat(9000)+" tailcanvasneedle",createdAt:stamp,updatedAt:stamp}];
 store.saveChat(chat);
 const second=store.createChat("Another conversation",undefined,owner);second.messages=[{id:"second",role:"assistant",content:"bodyonlyneedle",createdAt:stamp}];store.saveChat(second);
 const hidden=store.createChat("Hidden conversation",undefined,foreign);hidden.messages=[{id:"hidden",role:"assistant",content:"bodyonlyneedle foreignbodysecret",createdAt:stamp}];store.saveChat(hidden);
 notes.createNote({ownerId:owner,title:"Long note",content:"x".repeat(9000)+" tailnoteneedle"});
 route=await import("../app/api/references/route");
});
after(()=>rmSync(root,{recursive:true,force:true}));
async function search(kind:string|undefined,q:string){
 for(let attempt=0;attempt<120;attempt++){
  const params=new URLSearchParams({q,chatId});if(kind)params.set("kind",kind);
  const response=await route.GET(new Request("http://localhost/api/references?"+params,{headers:{cookie:"ai_chat_auth="+token}}));
  assert.equal(response.status,200);
  const body=await response.json();if(!body.indexing)return body.results as Array<{kind:string;id:string;label:string;content?:string;chatId?:string}>;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error("Reference indexing did not finish.");
}
test("chat references find message-only matches once per accessible conversation",async()=>{
 for(const kind of ["chat",undefined]){
  const found=(await search(kind,"bodyonlyneedle")).filter(item=>item.kind==="chat");
  assert.equal(found.length,2);assert.equal(new Set(found.map(item=>item.chatId)).size,2);
  assert(found.every(item=>item.id===item.chatId));
 }
 assert.deepEqual(await search("chat","foreignbodysecret"),[]);
});
test("notes search full content without returning an unbounded preview",async()=>{
 const found=await search("note","tailnoteneedle");assert.equal(found.length,1);assert.equal(found[0].label,"Long note");assert((found[0].content?.length??0)<=6000);
});
test("plans search beyond their preview boundary",async()=>{
 const found=await search("plan","tailplanneedle");assert.equal(found.length,1);assert.equal(found[0].id,"long-plan");assert((found[0].content?.length??0)<=6000);
});
test("legacy compact metadata is refreshed without requiring a file reindex",async()=>{
 const store=await import("../lib/db-store"),{getDatabase}=await import("../lib/sqlite"),index=await import("../lib/reference-file-index");
 const chat=store.createChat("Legacy metadata",undefined,owner),stamp=new Date().toISOString();
 chat.workspaces=[{id:"legacy-plan",type:"plan",name:"Legacy plan",content:"x".repeat(9000)+" legacytailneedle",createdAt:stamp,updatedAt:stamp}];
 store.saveChat(chat);const db=getDatabase();index.initializeReferenceIndex(db);
 db.prepare("UPDATE chat_page_state SET ready_revision=-1 WHERE chat_id=?").run(chat.id);
 db.prepare("INSERT OR REPLACE INTO chat_reference_metadata VALUES(?,?,?)").run(chat.id,index.referenceVersion(db,chat.id)!,JSON.stringify({...chat,messages:[],workspaces:chat.workspaces.map(item=>({...item,content:item.content.slice(0,6000)}))}));
 const found=await search("plan","legacytailneedle");assert.equal(found[0]?.id,"legacy-plan");
 assert.equal(db.prepare("SELECT count(*) AS n FROM chat_reference_files WHERE chat_id=?").get(chat.id)?.n,0);
});
test("canvases search beyond their preview boundary",async()=>{
 const found=await search("canvas","tailcanvasneedle");assert.equal(found.length,1);assert.equal(found[0].id,"long-canvas");assert((found[0].content?.length??0)<=6000);
});
