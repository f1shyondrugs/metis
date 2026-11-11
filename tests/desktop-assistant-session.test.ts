import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {assistantPanelSize,createAssistantSessionWriter,EMPTY_ASSISTANT_SESSION} from "../lib/desktop-assistant-session";
test("panel sizes are finite, bounded and do not rewrite persisted preference for a small screen",()=>{
 assert.deepEqual(assistantPanelSize({width:9999,height:1}),{width:1200,height:160});
 assert.throws(()=>assistantPanelSize({width:NaN,height:200}));
});
test("session writes serialize versions, preserve later drafts and stop after conflicts",async()=>{
 const versions:number[]=[];let release!:()=>void;
 const writer=createAssistantSessionWriter(EMPTY_ASSISTANT_SESSION,async(version,patch)=>{
  versions.push(version);if(!version)await new Promise<void>(resolve=>{release=resolve;});
  return {...EMPTY_ASSISTANT_SESSION,version:version+1,draft:{text:patch.draftText||""}};
 });
 const first=writer.save({draftText:"first"}),second=writer.save({draftText:"newer"});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(versions,[0]);release();
 await first;assert.equal((await second).draft.text,"newer");assert.deepEqual(versions,[0,1]);
 let requests=0;const conflict=createAssistantSessionWriter(EMPTY_ASSISTANT_SESSION,async()=>{requests++;throw Error("Conflict");});
 await assert.rejects(conflict.save({draftText:"mine"}));await assert.rejects(conflict.save({draftText:"newer"}));
 assert.equal(requests,1,"a stale tab must not overwrite another writer");
});
test("server sessions isolate owners/devices and atomically move queued context into a durable editable draft",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-assistant-session-"));
 Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,METIS_AI_BOOTSTRAP_PASSWORD:""});
 const {getDatabase}=await import("../lib/sqlite");const db=getDatabase();
 for(const id of ["owner","other"]){
  db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)").run(id,id,"fixture",new Date().toISOString(),0);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(id).digest("hex"),id,new Date(Date.now()+60000).toISOString());
 }
 try{
  const store=await import("../lib/db-store"),remote=await import("../lib/remote-clients"),sessions=await import("../lib/desktop-assistant-session-store"),api=await import("../app/api/desktop-assistant/session/route");
  const enroll=remote.createEnrollmentToken("owner"),registration=remote.registerRemoteClient(enroll.token,{name:"Fixture",hostname:"fixture",os:"windows",architecture:"x64",version:"fixture"});
  assert.ok(registration?.client);const deviceId=registration.client.id,chat=store.createChat("Fixture assistant",undefined,"owner");
  const req=(owner:string|undefined,body?:unknown,origin?:string)=>new Request("http://localhost/api/desktop-assistant/session?deviceId="+deviceId,{
   method:body?"PUT":"GET",headers:{...(owner?{cookie:"ai_chat_auth="+owner}:{}),...(origin?{origin}:{}),"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})
  });
  assert.equal((await api.GET(req(undefined))).status,401);
  assert.equal((await api.GET(req("other"))).status,404);
  assert.equal((await api.PUT(req("owner",{deviceId,version:0,patch:{}}, "https://foreign.invalid"))).status,403);
  let session=sessions.saveAssistantSession("owner",deviceId,0,{chatId:chat.id,draftText:"draft\nsecond line",panelSize:{width:720,height:600}});
  assert.equal(session.version,1);
  assert.throws(()=>sessions.saveAssistantSession("owner",deviceId,0,{draftText:"stale"}),/another window/);
  const otherChat=store.createChat("Private",undefined,"other");
  assert.throws(()=>sessions.saveAssistantSession("owner",deviceId,1,{chatId:otherChat.id}),/Chat not found/);
  store.updateChat(chat.id,{queuedMessages:[{id:"q-one",text:"Queued words",referenceText:"old monitor coordinates",attachments:[{id:"screen",name:"Screen.png",mimeType:"image/png",size:1,kind:"image",storedName:"screen.png"}]}]},"owner");
  session=sessions.saveAssistantSession("owner",deviceId,1,{},"q-one");
  assert.equal(store.getChat(chat.id,"owner")!.queuedMessages?.length||0,0);
  assert.equal(session.draft.attachments?.[0].id,"screen");
  assert.equal(session.draft.referenceText,"old monitor coordinates");
  assert.equal(sessions.getAssistantSession("owner",deviceId).draft.text,"Queued words");
  const version=session.version;
  assert.throws(()=>sessions.saveAssistantSession("owner",deviceId,version,{},"missing"),/left the queue/);
  assert.equal(sessions.getAssistantSession("owner",deviceId).version,version,"failed edit must not consume a version or overwrite a draft");
  session=sessions.saveAssistantSession("owner",deviceId,version,{draftText:"edited"});
  assert.equal(session.draft.attachments?.[0].id,"screen");
  session=sessions.saveAssistantSession("owner",deviceId,session.version,{draftText:"",clearContext:true});
  assert.deepEqual(session.draft,{text:""});
  const response=await api.GET(req("owner"));assert.equal(response.status,200);
  assert.equal((await response.json()).session.panelSize.width,720,"size survives a separate authenticated read");
  assert.equal((await api.PUT(req("owner",{deviceId,version:session.version,patch:{draftText:"x".repeat(100001)}}))).status,400);
  remote.revokeRemoteClient(deviceId,"owner");
  assert.equal((await api.GET(req("owner"))).status,404);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
