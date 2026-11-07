import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-references-test-"));
Object.assign(process.env, { AI_CHAT_ROOT:root, CHAT_DATA_DIR:root, CHAT_DB_PATH:path.join(root,"chat.sqlite"), AGENT_CWD:root,
  CHAT_PASSWORD:"", METIS_AI_BOOTSTRAP_PASSWORD:"", CHAT_LEGACY_HEADER_AUTH:"false" });
const imports = Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/shared-context"),import("../lib/sqlite"),import("../app/api/references/route"),import("../lib/projects"),import("../lib/project-sharing")]);
let modules: Awaited<typeof imports>;
let owner: string, foreign: string, token: string, chatId: string;
before(async () => {
  modules=await imports;
  const [auth,db,notes]=modules;
  owner=auth.createUser("refs-owner","test-password").id;
  foreign=auth.createUser("refs-foreign","test-password").id;
  token=auth.authenticateUser("refs-owner","test-password")!.token;
  const now=new Date().toISOString();
  const chat=db.createChat("Reference source",undefined,owner);
  chatId=chat.id;
  chat.workspaces=[
    {id:"canvas",type:"canvas",name:"Architecture canvas",content:"Diagram",createdAt:now,updatedAt:now},
    {id:"plan",type:"plan",name:"Launch plan",content:"Checklist",createdAt:now,updatedAt:now},
  ];
  chat.browserContext={tabs:[{id:"tab",title:"Docs",url:"https://example.org/docs"}],activeTabId:"tab",sessionKey:"fixture",updatedAt:now};
  chat.sessionState={terminalTabs:[{id:"term",title:"Build terminal",cwd:"/fixture"}]};
  chat.messages=[{id:"msg",role:"assistant",content:"Saved output",createdAt:now,tools:[
    {id:"edited",name:"edit_file",status:"completed",editedFile:{path:"/fixture/report.md",target:"server",additions:1,deletions:0}},
    {id:"duplicate",name:"edit_file",status:"completed",path:"/fixture/report.md",result:"Updated"},
    {id:"read",name:"read_file",status:"completed",input:JSON.stringify({path:"/fixture/instructions.txt"}),result:"Read"},
    ...Array.from({length:100},(_,n)=>({id:"saturated-"+n,name:"read_file",status:"completed" as const,input:JSON.stringify({path:"/fixture/overload-"+n+".md"})})),
  ]}];
  db.saveChat(chat);
  notes.createNote({ownerId:owner,chatId:chat.id,scope:"chat",title:"Straße März",content:"Launch checklist"});
  const parent=notes.createNote({ownerId:owner,title:"Standalone note",content:"No chat required"});
  const child=notes.createNote({ownerId:owner,parentId:parent.id,title:"Release folder",content:"Child note"});
  notes.createNote({ownerId:owner,parentId:child.id,title:"Nested checklist",content:"Deeply nested note"});
  notes.createNote({ownerId:owner,chatId:chat.id,scope:"chat",kind:"learned_fact",title:"Remembered context",content:"A scoped remembered fact"});
  const privateChat=db.createChat("Private foreign",undefined,foreign);
  notes.createNote({ownerId:foreign,chatId:privateChat.id,scope:"chat",title:"FOREIGN_SECRET",content:"FOREIGN_SECRET"});
});
after(()=>{modules[3].getDatabase().close();rmSync(root,{recursive:true,force:true});});
async function get(kind?:string,q="",session=token,current=chatId,kinds?:string) {
  const query=new URLSearchParams({q,chatId:current}); if(kind)query.set("kind",kind); if(kinds)query.set("kinds",kinds);
  for(let attempt=0;attempt<100;attempt++){
    const response=await modules[4].GET(new Request("http://localhost/api/references?"+query,{headers:session?{cookie:"ai_chat_auth="+session}:{}}));
    if(!response.ok || !(await response.clone().json()).indexing)return response;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error("Reference indexing did not finish");
}
test("document-only search skips file indexing and finds deep subfiles by their ancestors",async()=>{
 const response=await get(undefined,"",token,chatId,"note,canvas,plan");
 assert.equal(response.status,200);
 const data=await response.json();
 assert.ok(data.results.every((r:{kind:string})=>["note","canvas","plan"].includes(r.kind)));
 assert.equal((modules[3].getDatabase().prepare("SELECT count(*) AS n FROM chat_reference_files").get() as {n:number}).n,0);
 const nested=await(await get("note","Standalone Release Nested")).json();
 assert.ok(nested.results.some((r:{label:string;detail:string;parentId:string})=>r.label==="Nested checklist"&&r.detail.includes("Standalone note / Release folder / Subfile")&&r.parentId));
 assert.equal((await get(undefined,"",token,chatId,"note,unknown")).status,400);
 assert.equal((await get("file","",token,chatId,"note,canvas,plan")).status,400);
});

test("unfiltered search balances categories even when the current chat contains hundreds of files",async()=>{
 const response=await get(undefined);
 const data=await response.json();
 const kinds=new Set(data.results.map((r:{kind:string})=>r.kind));
 for(const kind of ["file","note","canvas","plan","chat","terminal","browser"])assert.ok(kinds.has(kind),kind);
 assert.ok(data.results.length<=80);
 assert.ok(data.results.filter((r:{kind:string})=>r.kind==="file").length<=8);
});

test("a matching note title is not hidden by earlier body-only matches",async()=>{
 for(let n=0;n<10;n++)modules[2].createNote({ownerId:owner,title:"Earlier document "+n,content:"rankneedle in the body"});
 const exact=modules[2].createNote({ownerId:owner,title:"rankneedle",content:"Exact title match"});
 const results=(await(await get(undefined,"rankneedle",token,chatId,"note,canvas,plan")).json()).results;
 assert.ok(results.some((item:{id:string})=>item.id===exact.id));
 assert.equal(results[0].id,exact.id);
});

test("all reference categories return their own accessible data",async()=>{
 for(const [kind,label] of [["chat","Reference source"],["canvas","Architecture canvas"],["plan","Launch plan"],["note","Straße März"],["memory","Remembered context"],["browser","Docs"],["terminal","Build terminal"],["file","report.md"]]){
   const response=await get(kind);
   assert.equal(response.status,200,kind);
   const data=await response.json();
   assert.ok(data.results.some((r:{label:string})=>r.label===label),kind);
   assert.ok(data.results.every((r:{kind:string})=>r.kind===kind),kind);
   assert.equal(response.headers.get("Cache-Control"),"private, no-store");
 }
});
test("search includes standalone notes, canonical edited paths, independent words and spelling variants",async()=>{
 const notes=await (await get("note","marz strasse")).json();
 assert.equal(notes.results.length,1);
 assert.equal(notes.results[0].label,"Straße März");
 assert.equal((await (await get("note","standalone")).json()).results[0].label,"Standalone note");
 const files=await (await get("file")).json();
 assert.equal(files.results.filter((r:{path:string})=>r.path==="/fixture/report.md").length,1);
 assert.ok(files.results.some((r:{label:string})=>r.label==="instructions.txt"));
 assert.ok(!(await (await get("note")).json()).results.some((r:{label:string})=>r.label==="Remembered context"));
});
test("a chat with many matching messages appears once in filtered and global reference searches", async () => {
 const [auth, db] = modules;
 const user = auth.createUser("refs-dedup", "test-password");
 const session = auth.authenticateUser("refs-dedup", "test-password")!.token;
 const first = db.createChat("Korlei", undefined, user.id);
 first.messages = Array.from({length: 100}, (_, n) => ({
   id: "match-" + n, role: "user" as const, content: "Korlei message " + n, createdAt: first.createdAt,
 }));
 db.saveChat(first);
 const second = db.createChat("Korlei", undefined, user.id);
 for (const kind of [undefined, "chat"]) {
   const results = (await (await get(kind, "korlei", session, first.id)).json()).results;
   const chats = results.filter((item: {kind: string}) => item.kind === "chat");
   assert.equal(chats.length, 2);
   assert.deepEqual(new Set(chats.map((item: {chatId: string}) => item.chatId)), new Set([first.id, second.id]));
   assert.ok(chats.every((item: {id: string; chatId: string}) => item.id === item.chatId));
 }
});

test("auth, invalid categories and cross-account content stay protected",async()=>{
 assert.equal((await get("note","","")).status,401);
 assert.equal((await get("unknown")).status,400);
 for(const kind of [undefined,"note","chat","memory"]){
   const data=await (await get(kind,"FOREIGN_SECRET",token,"foreign-chat")).json();
   assert.deepEqual(data.results,[]);
 }
});
test("issue references include private and accepted-project work, rehydrate current data and exclude revoked accounts",async()=>{
 const [auth,db,,, ,projects,sharing]=modules;
 const issues=await import("../lib/issues");
 const {resolveScopeReferences}=await import("../lib/context-scope");
 const privateOwner=issues.createIssue(owner,{title:"Issue visibility owner private",description:"Canonical owner context"});
 const privateForeign=issues.createIssue(foreign,{title:"Issue visibility foreign private"});
 const foreignProject=projects.createProject({ownerId:foreign,name:"Foreign issue project"});
 const foreignProjectIssue=issues.createIssue(foreign,{projectId:foreignProject.id,title:"Issue visibility foreign project"});
 const project=projects.createProject({ownerId:owner,name:"Shared issue project"});
 const shared=issues.createIssue(owner,{projectId:project.id,title:"Issue visibility shared",description:"Canonical shared context",status:"todo",priority:"high"});
 const foreignToken=auth.authenticateUser("refs-foreign","test-password")!.token;
 const before=(await (await get("issue","Issue visibility",foreignToken)).json()).results;
 assert.deepEqual(new Set(before.map((item:{id:string})=>item.id)),new Set([privateForeign.id,foreignProjectIssue.id]));
 const invitation=sharing.inviteProjectMember(project.id,owner,"refs-foreign");
 sharing.respondProjectInvitation(invitation.id,foreign,"accept");
 const ownerResults=(await (await get("issue","Issue visibility")).json()).results;
 assert.deepEqual(new Set(ownerResults.map((item:{id:string})=>item.id)),new Set([privateOwner.id,shared.id]));
 assert.ok(ownerResults.every((item:{kind:string})=>item.kind==="issue"));
 const sharedReference=ownerResults.find((item:{id:string})=>item.id===shared.id);
 assert.equal(sharedReference.path,"issue://"+shared.id);
 assert.match(sharedReference.detail,/Shared issue project/);
 assert.match(sharedReference.content,/Canonical shared context/);
 const memberResults=(await (await get("issue","Issue visibility",foreignToken)).json()).results;
 assert.ok(memberResults.some((item:{id:string})=>item.id===shared.id));
 assert.ok(!memberResults.some((item:{id:string})=>item.id===privateOwner.id));
 assert.ok((await (await get(undefined,shared.key)).json()).results.some((item:{id:string;kind:string})=>item.kind==="issue"&&item.id===shared.id));
 const memberChat=db.createChat("Member issue context",undefined,foreign);
 issues.updateIssue(shared.id,owner,{title:"Updated issue title",status:"done"});
 const selected={...sharedReference,label:"STALE LABEL",content:"STALE SNAPSHOT",source:"explicit" as const};
 const resolved=resolveScopeReferences(foreign,memberChat.id,[selected]);
 assert.equal(resolved.length,1);assert.match(resolved[0].label,/Updated issue title/);
 assert.match(resolved[0].content||"",/Status: Done/);assert.ok(!resolved[0].content?.includes("STALE SNAPSHOT"));
 assert.deepEqual(resolveScopeReferences(foreign,memberChat.id,[selected],true),[]);
 sharing.removeProjectMember(project.id,owner,{userId:foreign});
 const after=(await (await get("issue","Issue visibility",foreignToken)).json()).results;
 assert.ok(!after.some((item:{id:string})=>item.id===shared.id));
 assert.deepEqual(resolveScopeReferences(foreign,memberChat.id,[selected]),[]);
 const settings=db.getGlobalModelSettings(owner);
 db.saveGlobalModelSettings({...settings,featureFlags:{...settings.featureFlags,notes:false}},owner);
 try {assert.deepEqual((await (await get("issue","Issue visibility")).json()).results,[]);}
 finally {db.saveGlobalModelSettings(settings,owner);}
});

test("accepted project content is discoverable and disappears after membership removal",async()=>{
 const [auth,db,notes,,,projects,sharing]=modules;
 const member=auth.createUser("refs-member","test-password").id;
 const memberToken=auth.authenticateUser("refs-member","test-password")!.token;
 const project=projects.createProject({ownerId:owner,name:"Reference project"});
 const shared=db.createChat("Shared ref chat",undefined,owner,undefined,{projectId:project.id});
 notes.createNote({ownerId:owner,projectId:project.id,title:"Shared project note",content:"Shared reference"});
 assert.deepEqual((await (await get("note","Shared",memberToken)).json()).results,[]);
 const invitation=sharing.inviteProjectMember(project.id,owner,"refs-member");
 sharing.respondProjectInvitation(invitation.id,member,"accept");
 assert.ok((await (await get("note","Shared",memberToken,shared.id)).json()).results.some((r:{label:string})=>r.label==="Shared project note"));
 sharing.removeProjectMember(project.id,owner,{userId:member});
 assert.deepEqual((await (await get("note","Shared",memberToken)).json()).results,[]);
});
