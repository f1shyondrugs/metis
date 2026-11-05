import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync,rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-reference-performance-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"db.sqlite"),AGENT_CWD:root});
test.after(()=>rmSync(root,{recursive:true,force:true}));
test("large legacy files stay searchable without parsing histories on the requesting thread",async()=>{
 const {getDatabase}=await import("../lib/sqlite");
 const {searchReferences}=await import("../lib/reference-search-server");
 const db=getDatabase(),stamp=new Date().toISOString();
 db.prepare("INSERT INTO users VALUES(?,?,?,?,0)").run("owner","owner","unused",stamp);
 const chat={id:"large",ownerId:"owner",title:"Large history",createdAt:stamp,updatedAt:stamp,messages:[
  {id:"msg",role:"assistant",content:"x".repeat(8*1024*1024),tools:[
   {id:"tool",name:"read_file",status:"completed",input:{path:"C:\\fixture\\large.txt"},result:"Needle "+"y".repeat(8*1024*1024)},
   {id:"wrapped",name:"edit_file",status:"completed",input:JSON.stringify({arguments:{path:"/fixture/wrapped.md"}})},
   {id:"unicode",name:"read_file",status:"completed",input:{path:"/fixture/Straße März 100%_literal_.txt"}}
  ],attachments:[{id:"asset",name:"Upload.png",storedName:"stored.png"}]}
 ],workspaces:[{id:"plan",type:"plan",name:"Launch plan",content:"Checklist",createdAt:stamp,updatedAt:stamp}]};
 const raw=JSON.stringify(chat);
 db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(chat.id,"owner",raw,stamp,stamp);
 db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at,incognito,archived) VALUES(?,?,?,?,?,0,0)").run(chat.id,"owner",chat.title,stamp,stamp);
 const {initializeReferenceIndex,referenceVersion}=await import("../lib/reference-file-index");
 initializeReferenceIndex(db);
 const version=referenceVersion(db,"large"),versionStart=performance.now();
 for(let i=0;i<100;i++)assert.equal(referenceVersion(db,"large"),version);
 assert.ok(performance.now()-versionStart<150,"version reads must not load the 16MiB transcript");
 db.prepare("UPDATE chats SET updated_at=? WHERE id='large'").run(stamp+"-changed");
 assert.notEqual(referenceVersion(db,"large"),version);
 db.prepare("UPDATE chats SET updated_at=? WHERE id='large'").run(stamp);
 const query=(kind?:"file"|"plan",query="")=>({ownerId:"owner",currentChatId:"large",kind,query});
 let ticks=0,maxGap=0,previous=performance.now();
 const timer=setInterval(()=>{ticks++;const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;},5);
 try{
  let first=await searchReferences(query("file"));
  assert.equal(first.indexing,true);
  for(let attempt=0;first.indexing && attempt<200;attempt++){
    await new Promise(resolve=>setTimeout(resolve,20));
    first=await searchReferences(query("file"));
  }
  assert.equal(first.indexing,false);
  const files=first.results;
  assert.ok(files.some(r=>r.label==="large.txt"));
  assert.ok(files.some(r=>r.label==="wrapped.md"));
  assert.equal((await searchReferences(query("file","marz strasse 100%_literal_"))).results[0]?.label,"Straße März 100%_literal_.txt");
  assert.ok(files.some(r=>r.label==="Upload.png"));
  assert.ok(files.every(r=>(r.content?.length || 0)<=6000));
  assert.ok(ticks>5,"requesting event loop keeps ticking");
  assert.ok(maxGap<250,"no history parse blocks the requesting thread: "+maxGap);
  const started=performance.now();
  assert.equal((await searchReferences(query("plan","Launch"))).results[0].id,"plan");
  console.log(JSON.stringify({warmPlanMs:performance.now()-started,maxGap,ticks,fixtureBytes:raw.length}));
  const abort=new AbortController();
  const pending=searchReferences(query("file","missing"),abort.signal);abort.abort();
  await assert.rejects(pending,{name:"AbortError"});
  assert.equal((await searchReferences(query("file","Needle"))).results[0].label,"large.txt");
  assert.equal((db.prepare("SELECT data FROM chats WHERE id='large'").get() as {data:string}).data,raw);
  assert.deepEqual((await searchReferences({...query("file"),ownerId:"stranger"})).results,[]);
  db.prepare("UPDATE chats SET data=json_set(data,'$.messages[0].tools[0].input.path','/changed/new.txt') WHERE id='large'").run();
  let updated=await searchReferences(query("file","new.txt"));
  for(let attempt=0;updated.indexing && attempt<200;attempt++){
    await new Promise(resolve=>setTimeout(resolve,20));updated=await searchReferences(query("file","new.txt"));
  }
  assert.equal(updated.indexing,false);assert.equal(updated.results[0]?.path,"/changed/new.txt");
  db.prepare("DELETE FROM chats WHERE id='large'").run();
  assert.deepEqual((await searchReferences(query("file"))).results,[]);
  assert.equal((db.prepare("SELECT count(*) AS n FROM chat_reference_files").get() as {n:number}).n,0);
 }finally{clearInterval(timer);}
});
test("broad searches materialize bounded file candidates while retaining late Unicode title matches",async()=>{
 const {getDatabase}=await import("../lib/sqlite"),{collectReferences}=await import("../lib/reference-search-engine");
 const index=await import("../lib/reference-file-index"),{normalizeReferenceText}=await import("../lib/reference-search");
 const db=getDatabase(),stamp=new Date().toISOString(),chatId="bounded-files",owner="bounded-owner";
 db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,0)").run(owner,owner,"unused",stamp);
 const raw=JSON.stringify({id:chatId,ownerId:owner,title:"Bounded files",messages:[],createdAt:stamp,updatedAt:stamp});
 db.prepare("INSERT INTO chats VALUES(?,?,?,?,?)").run(chatId,owner,raw,stamp,stamp);
 db.prepare("INSERT INTO chat_list(id,owner_id,title,created_at,updated_at,incognito,archived) VALUES(?,?,?,?,?,0,0)").run(chatId,owner,"Bounded files",stamp,stamp);
 index.initializeReferenceIndex(db);
 const insert=db.prepare("INSERT INTO chat_reference_files(chat_id,position,data,normalized) VALUES(?,?,?,?)");
 db.exec("BEGIN IMMEDIATE");
 try{
  for(let i=0;i<1000;i++){
   const item={kind:"file",id:chatId+":"+i,chatId,label:i===999?"Néedle plan.md":"body-"+i+".md",path:"/fixture/"+i,content:"Needle body ".repeat(500)};
   insert.run(chatId,i,JSON.stringify(item),normalizeReferenceText(item.label+" "+item.content));
  }
  db.prepare("INSERT INTO chat_reference_state VALUES(?,?)").run(chatId,index.referenceVersion(db,chatId)!);
  db.exec("COMMIT");
 }catch(error){db.exec("ROLLBACK");throw error;}
 const candidates:unknown[]=[];
 index.indexedReferenceFiles(db,chatId,"Bounded files","needle",item=>candidates.push(item),()=>false,()=>{},8);
 assert.equal(candidates.length,8);
 assert.equal((candidates[0] as {label:string}).label,"Néedle plan.md");
 const all=await collectReferences({ownerId:owner,currentChatId:chatId,query:"needle"},()=>false);
 assert.equal(all.results.filter(item=>item.kind==="file").length,8);
 const files=await collectReferences({ownerId:owner,currentChatId:chatId,query:"needle",kind:"file"},()=>false);
 assert.equal(files.results.length,80);
 assert.equal((db.prepare("SELECT data FROM chats WHERE id=?").get(chatId) as {data:string}).data,raw);
});
