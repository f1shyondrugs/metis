import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopShortcutFromEvent, desktopShortcutLabel } from "../lib/desktop-shortcuts";
import { settingsSearchEntries, visibleSettingsTabs } from "../lib/settings-navigation";
import { desktopCaptureContext, type DesktopCapture } from "../lib/desktop-assistant";
import { latestClientModelSelection, rememberClientModelSelection, MODEL_STORAGE_KEY, PARAMS_STORAGE_KEY } from "../lib/client-model-selection";
const availableModels=[
  {id:"first/account/model",displayName:"First",parameters:[],defaultParams:[]},
  {id:"recent/account/model",displayName:"Recent",legacyIds:["old/recent"],parameters:[{id:"effort",values:[{value:"high"},{value:"low"}]}],defaultParams:[{id:"effort",value:"low"}]},
];
function storage(values:Record<string,string>={}){return {getItem:(key:string)=>values[key]??null,setItem:(key:string,value:string)=>{values[key]=value;}};}
test("assistant uses New chat's latest local model and validates its own remembered parameters",()=>{
  const saved=storage({[MODEL_STORAGE_KEY]:"old/recent",[PARAMS_STORAGE_KEY]:JSON.stringify([{id:"effort",value:"high"},{id:"fast",value:"true"}])});
  assert.deepEqual(latestClientModelSelection(availableModels,{},saved),{modelId:"recent/account/model",modelParams:[{id:"effort",value:"high"}]});
});
test("explicit empty parameters stay empty and cannot borrow another model's values",()=>{
  const saved=storage({[MODEL_STORAGE_KEY]:"recent/account/model",[PARAMS_STORAGE_KEY]:JSON.stringify([{id:"effort",value:"high"}])});
  assert.deepEqual(latestClientModelSelection(availableModels,{modelParamsByModel:{"recent/account/model":[]}},saved)?.modelParams,[]);
  assert.deepEqual(latestClientModelSelection(availableModels,{},storage({[MODEL_STORAGE_KEY]:"removed",[PARAMS_STORAGE_KEY]:JSON.stringify([{id:"effort",value:"high"}])})),{modelId:"first/account/model",modelParams:[]});
});
test("empty discovery stays unavailable; latest selection is shared through the normal New chat keys",()=>{
  assert.equal(latestClientModelSelection([],{},storage()),null);
  const saved=storage();rememberClientModelSelection({modelId:"recent/account/model",modelParams:[]},saved);
  assert.equal(saved.getItem(MODEL_STORAGE_KEY),"recent/account/model");
  assert.equal(saved.getItem(PARAMS_STORAGE_KEY),"[]");
});

test("run status endpoint returns the submitted job's terminal state without exposing payloads or another account",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs");const os=await import("node:os");const path=await import("node:path");const {createHash}=await import("node:crypto");
  const root=mkdtempSync(path.join(os.tmpdir(),"metis-assistant-run-"));
  Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,METIS_AI_BOOTSTRAP_PASSWORD:""});
  const {getDatabase}=await import("../lib/sqlite");const db=getDatabase();
  for(const id of ["owner","other"]){
    db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)").run(id,id,"fixture",new Date().toISOString(),0);
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(id).digest("hex"),id,new Date(Date.now()+60000).toISOString());
  }
  try{
    const store=await import("../lib/db-store"),jobs=await import("../lib/db-jobs"),api=await import("../app/api/runs/route");
    const chat=store.createChat("Assistant test",undefined,"owner");
    const job=jobs.enqueueJob({chatId:chat.id,userId:"owner",message:"private fixture payload"});
    jobs.updateJob(job.id,{status:"error",error:"No model selected."});
    store.updateChat(chat.id,{runStatus:"running"},"owner");
    const req=(owner?:string,chatId=chat.id)=>new Request("http://localhost/api/runs?status=1&chatId="+chatId+"&jobId="+job.id,{headers:owner?{cookie:"ai_chat_auth="+owner}:{}});
    const response=await api.GET(req("owner"));assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.job.status,"error");assert.equal(body.job.error,"No model selected.");
    assert.equal(JSON.stringify(body).includes("private fixture payload"),false);assert.equal(body.job.leaseToken,undefined);
    assert.equal((await api.GET(req())).status,401);assert.equal((await api.GET(req("other"))).status,404);assert.equal((await api.GET(req("owner","wrong"))).status,404);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test("shortcut recording keeps physical keys and platform labels",()=>{
  const event={key:"M",code:"KeyM",ctrlKey:true,shiftKey:true,altKey:false,metaKey:false};
  assert.equal(desktopShortcutFromEvent(event),"Control+Shift+M");
  assert.equal(desktopShortcutFromEvent({...event,key:"Shift",code:"ShiftLeft"}),null);
  assert.equal(desktopShortcutFromEvent({...event,repeat:true}),null);
  assert.equal(desktopShortcutFromEvent({...event,isComposing:true}),null);
  assert.equal(desktopShortcutLabel("Super+Shift+Enter","win32"),"Win + Shift + Enter");
  assert.equal(desktopShortcutLabel("Super+Shift+Enter","darwin"),"Cmd + Shift + Enter");
});
test("local settings remain absent on the web and searchable in desktop for both roles",()=>{
  for(const admin of [true,false]){
    assert.ok(!visibleSettingsTabs(admin).some(tab=>tab.value==="remote-client"));
    assert.ok(!settingsSearchEntries(admin).some(tab=>tab.tab==="remote-client"));
    assert.equal(visibleSettingsTabs(admin,true).filter(tab=>tab.value==="remote-client").length,1);
    assert.equal(settingsSearchEntries(admin,true).filter(tab=>tab.tab==="remote-client").length,1);
  }
});
test("screen context preserves origin, negative monitor coordinates and image ordering without duplicating pixels",()=>{
  const capture:DesktopCapture={device:{clientId:"fixture-id",hostname:"Fixture PC",platform:"win32",version:"1.5.3"},capturedAt:"2026-11-10T20:00:00Z",monitors:[
    {id:"left",name:"Left",primary:false,bounds:{x:-1920,y:0,width:1920,height:1080},scaleFactor:1,image:"data:image/png;base64,secret-pixels"},
    {id:"main",name:"Main",primary:true,bounds:{x:0,y:0,width:2560,height:1440},scaleFactor:1.5,image:"data:image/png;base64,more-pixels"}
  ]};
  const context=desktopCaptureContext(capture);
  assert.ok(context.includes('"clientId":"fixture-id"'));
  const monitors=context.split("\n").filter(line=>line.startsWith('{"image":')).map(line=>JSON.parse(line));
  assert.deepEqual(monitors.map(item=>[item.image,item.id,item.bounds.x,item.scaleFactor]),[[1,"left",-1920,1],[2,"main",0,1.5]]);
  assert.ok(!context.includes("secret-pixels"));
  assert.ok(context.includes("untrusted observations"));
});
