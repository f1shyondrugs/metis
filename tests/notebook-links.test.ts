import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";import path from "node:path";
import {parseNotebookLink} from "../lib/notebook-link";
const origin="https://app.example.test",shareToken="A".repeat(43);
test("copied notebook URLs retain note/block identity only on this exact origin",()=>{
 assert.deepEqual(parseNotebookLink(origin+"/?c=notes#note-a/block-b",origin),{type:"note",id:"a",blockId:"b"});
 assert.deepEqual(parseNotebookLink("/?c=notes#note-a%20b",origin),{type:"note",id:"a b"});
 assert.deepEqual(parseNotebookLink(origin+"/share/notes/"+shareToken+"#note-child",origin),{type:"share",token:shareToken,noteId:"child"});
 for(const url of ["https://foreign.test/?c=notes#note-a","https://name:pass@app.example.test/?c=notes#note-a","javascript:alert(1)","//foreign.test/share/notes/"+shareToken,"/?c=notes#note-a%2Fb","/?c=notes#note-%00","/?c=other#note-a"]){assert.equal(parseNotebookLink(url,origin),null,url);}
 assert.equal(parseNotebookLink(origin+"/?c=notes#note-a",undefined),null);
});
const data=mkdtempSync(path.join(os.tmpdir(),"metis-notebook-links-"));
Object.assign(process.env,{AI_CHAT_ROOT:data,CHAT_DATA_DIR:data,CHAT_DB_PATH:path.join(data,"chat.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,5).toString("hex")});
test("share previews are bounded metadata with the live password/revocation/tree guards",async()=>{
 const auth=await import("../lib/auth"),notes=await import("../lib/shared-context"),sharing=await import("../lib/note-sharing");
 const route=await import("../app/api/shared-notes/[token]/route"),db=await import("../lib/sqlite");
 try{
  const user=auth.createUser("share-preview","SYNTHETIC-TEST-ONLY");
  const root=notes.createNote({ownerId:user.id,title:"Root title",content:"Visible **summary** "+("words ".repeat(200)),icon:"lucide:book-open"});
  const child=notes.createNote({ownerId:user.id,parentId:root.id,title:"Child title",content:"CHILD_ALLOWED"});
  const foreign=notes.createNote({ownerId:user.id,title:"Secret outside tree",content:"NEVER_EXPOSE"});
  const link=sharing.createNoteShare(root.id,user.id);
  const request=(query="",credential?:string)=>route.GET(new Request("https://app.example.test/api/shared-notes/"+link.token+"?view=preview"+query,{headers:credential?{cookie:sharing.noteShareCookieName(link.token)+"="+credential}:{}}),{params:Promise.resolve({token:link.token})});
  let response=await request();assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(Object.keys(result).sort(),["description","icon","title"]);assert.equal(result.title,"Root title");assert.equal(result.icon,"lucide:book-open");assert.ok(result.description.startsWith("Visible summary"));assert.ok(result.description.length<=600);
  assert.match(response.headers.get("cache-control")!,/private, no-store/);assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  response=await request("&noteId="+child.id);assert.equal(response.status,200);assert.equal((await response.json()).description,"CHILD_ALLOWED");
  assert.equal((await request("&noteId="+foreign.id)).status,404);assert.equal((await request("&noteId=bad%2Fid")).status,400);
  sharing.updateNoteShare(root.id,user.id,{password:"SYNTHETIC-PREVIEW-PASSWORD"});
  response=await request();assert.equal(response.status,401);assert.ok(!JSON.stringify(await response.json()).includes("Root title"));
  const credential=sharing.unlockSharedNote(link.token,"SYNTHETIC-PREVIEW-PASSWORD")!;assert.equal((await request("",credential)).status,200);
  sharing.updateNoteShare(root.id,user.id,{password:"DIFFERENT-SYNTHETIC-PASSWORD"});assert.equal((await request("",credential)).status,401);
  sharing.updateNoteShare(root.id,user.id,{password:null});assert.equal((await request()).status,200);
  sharing.revokeNoteShare(root.id,user.id);assert.equal((await request()).status,404);
 }finally{db.getDatabase().close();rmSync(data,{recursive:true,force:true});}
});
