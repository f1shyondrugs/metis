import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("monitor discovery and selected desktop frames preserve identity, compatibility and account boundaries", async t => {
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-desktop-monitors-"));
 Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:root,CHAT_DATA_DIR:root,
  CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_MCP_STATE_DIR:path.join(root,"mcp-state"),
  AI_CHAT_SECRETS_KEY:"desktop-monitors-only",NODE_ENV:"test",MCP_BEARER_TOKEN:"desktop-monitors-only"});
 const [auth,clients,gateway,capture,api,{getDatabase}]=await Promise.all([
  import("../lib/auth"),import("../lib/remote-clients"),import("../lib/remote-client-gateway"),
  import("../lib/remote-desktop-capture"),import("../app/api/remote-clients/[id]/desktop/route"),import("../lib/sqlite")]);
 const owner=auth.createUser("monitors-owner","test-password"),other=auth.createUser("monitors-other","test-password");
 const token=auth.authenticateUser("monitors-owner","test-password")!.token;
 const otherToken=auth.authenticateUser("monitors-other","test-password")!.token;
 const client=clients.registerRemoteClient(clients.createEnrollmentToken(owner.id,undefined,"admin").token,
  {name:"Monitor fixture",permissionMode:"admin",os:"windows",capabilities:["desktop_gui"]})!.client!;
 const monitors=[
  {id:"left",name:"Left display",x:-1920,y:0,width:1920,height:1080,primary:false},
  {id:"main",name:"Main display",x:0,y:0,width:2560,height:1440,primary:true},
 ];
 const image=await sharp({create:{width:64,height:32,channels:3,background:"#336699"}}).jpeg().toBuffer();
 const frame=(monitorId?:string)=>({image_base64:image.toString("base64"),mimeType:"image/jpeg",...(monitorId?{monitorId}:{})});
 const sent:Array<{action:string;params:Record<string,unknown>}>= [];
 let dispatch=(request:{action:string;params:Record<string,unknown>}):unknown=>{
  if(request.params.operation==="monitors")return {monitors};
  const id=request.params.monitorId;
  if(id!==undefined&&!monitors.some(m=>m.id===id))throw new Error("Monitor not found");
  return frame(typeof id==="string"?id:undefined);
 };
 const socket=new EventEmitter() as EventEmitter&{readyState:number;send(data:string):void;close():void};
 socket.readyState=1;socket.close=()=>{socket.readyState=3;socket.emit("close")};
 socket.send=data=>{
  const request=JSON.parse(data);sent.push(request);
  queueMicrotask(()=>{
   try {socket.emit("message",JSON.stringify({type:"response",requestId:request.requestId,ok:true,result:dispatch(request)}));}
   catch(error){socket.emit("message",JSON.stringify({type:"response",requestId:request.requestId,ok:false,error:error instanceof Error?error.message:String(error)}));}
  });
 };
 gateway.attachRemoteClient(socket,client.id,owner.id);
 const context={params:Promise.resolve({id:client.id})};
 const request=(method="GET",body?:unknown,session=token)=>new Request("http://localhost/api/remote-clients/"+client.id+"/desktop",
  {method,headers:session?{cookie:"ai_chat_auth="+session}:{},...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})});
 try {
  await t.test("GET requires the owner and uses passive Computer Use only",async()=>{
   assert.equal((await api.GET(request("GET",undefined,""),context)).status,401);
   assert.equal((await api.GET(request("GET",undefined,otherToken),context)).status,404);
   assert.equal(sent.length,0);
   const response=await api.GET(request(),context);
   assert.equal(response.status,200);assert.match(response.headers.get("cache-control")!,/private, no-store/);
   assert.deepEqual(await response.json(),{monitors,selectionSupported:true});
   assert.deepEqual(sent[0],{...sent[0],action:"computer_use",params:{operation:"monitors"}});
   assert.equal(clients.listRemoteAudit(owner.id).length,0);
  });
  await t.test("POST forwards only the selected ID and confirms that exact frame",async()=>{
   const response=await api.POST(request("POST",{monitorId:"left"}),context);
   assert.equal(response.status,200);assert.equal(response.headers.get("X-Desktop-Monitor-Id"),"left");
   assert.equal(response.headers.get("Content-Type"),"image/jpeg");
   assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width,64);
   assert.deepEqual(sent.at(-1)!.params,{operation:"preview",monitorId:"left"});
   const primary=await api.POST(request("POST"),context);
   assert.equal(primary.status,200,"An empty request remains the original primary-preview contract");
   assert.deepEqual(sent.at(-1)!.params,{operation:"preview"});
  });
  await t.test("malformed or oversized requests cannot reach a remote operation",async()=>{
   const before=sent.length;
   for(const body of [{monitorId:""},{monitorId:" left "},{monitorId:"bad\u0000id"},{monitorId:3},{monitorId:null},
    {monitorId:["left"]},{operation:"click"},{monitorId:"left",command:"ignored"},[],null,"{invalid","x".repeat(4097)]){
    assert.equal((await api.POST(request("POST",body),context)).status,400,JSON.stringify(body).slice(0,80));
   }
   assert.equal(sent.length,before);
   const controller=new AbortController();controller.abort();
   const aborted=new Request(request("POST",{monitorId:"left"}),{signal:controller.signal});
   assert.equal((await api.POST(aborted,context)).status,499);
  });
  await t.test("a disconnected monitor returns a recoverable error and never falls back to the primary",async()=>{
   const before=sent.length,response=await api.POST(request("POST",{monitorId:"removed"}),context);
   assert.equal(response.status,409);
   assert.match((await response.json()).error,/selected monitor.*no longer available/i);
   assert.equal(sent.length,before+1);assert.equal(sent.at(-1)!.action,"computer_use");
  });
  await t.test("same-monitor viewers coalesce while different monitors remain distinct",async()=>{
   const called:string[]=[];
   const selected=capture.createDesktopCapture(async input=>{
    const id=String(input.params?.monitorId);called.push(id);
    assert.equal(input.ephemeralPreview,true);assert.equal(input.source,"user");
    await new Promise(resolve=>setTimeout(resolve,10));return frame(id);
   });
   const result=await Promise.all([selected(client.id,owner.id,"left"),selected(client.id,owner.id,"main"),selected(client.id,owner.id,"left")]);
   assert.deepEqual(called,["left","main"]);assert.equal(result[0],result[2]);assert.notEqual(result[0],result[1]);
   assert.equal(result[0].monitorId,"left");assert.equal(result[1].monitorId,"main");
  });
  await t.test("legacy Windows capture can select a monitor only through the authorized fixed command",async()=>{
   const calls:Array<{action:string;command?:string}>=[];
   const selected=capture.createDesktopCapture(async input=>{
    calls.push({action:input.action,command:typeof input.params?.command==="string"?input.params.command:undefined});
    if(input.action==="computer_use")return frame(); // Older preview silently ignores monitorId.
    assert.equal(input.ephemeralPreview,true);
    return {stdout:JSON.stringify(frame("left"))};
   });
   assert.equal((await selected(client.id,owner.id,"left")).monitorId,"left");
   assert.deepEqual(calls.map(c=>c.action),["computer_use","execute_command"]);
   assert.match(calls[1].command!,/^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
  });
  await t.test("ignoring or misreporting a selected monitor never exposes an unconfirmed frame",async()=>{
   clients.updateRemoteClient(client.id,owner.id,{policy:{mode:"restricted",permissions:["computer_use"]}});
   let calls=0;
   const blocked=capture.createDesktopCapture(async()=>{calls++;return frame()});
   await assert.rejects(blocked(client.id,owner.id,"left"),error=>error instanceof capture.DesktopPreviewError&&error.status===409);
   assert.equal(calls,1,"Restricted clients cannot gain a command fallback");
   clients.updateRemoteClient(client.id,owner.id,{policy:{mode:"full_access",permissions:["computer_use","execute_command"]}});
   const wrong=capture.createDesktopCapture(async input=>input.action==="computer_use"?frame("main"):{stdout:JSON.stringify(frame("main"))});
   await assert.rejects(wrong(client.id,owner.id,"left"),/selected monitor/);
  });
  await t.test("old native clients can keep primary preview with selection explicitly unsupported",async()=>{
   clients.updateRemoteClient(client.id,owner.id,{policy:{mode:"restricted",permissions:["computer_use"]}});
   const list=capture.createDesktopMonitorList(async()=>{throw new Error("Unsupported computer use operation")});
   assert.deepEqual(await list(client.id,owner.id),{monitors:[],selectionSupported:false});
   const primary=capture.createDesktopCapture(async()=>frame());
   assert.equal((await primary(client.id,owner.id)).width,64);
   clients.updateRemoteClient(client.id,owner.id,{policy:{mode:"full_access",permissions:["computer_use","execute_command"]}});
   const legacyList=capture.createDesktopMonitorList(async input=>{
    if(input.action==="computer_use")throw new Error("Unsupported computer use operation");
    return {stdout:JSON.stringify({monitors})};
   });
   assert.deepEqual(await legacyList(client.id,owner.id),{monitors,selectionSupported:true});
  });
  await t.test("Linux without RandR discovery keeps only its working default preview",async()=>{
   const linux=clients.registerRemoteClient(clients.createEnrollmentToken(owner.id,undefined,"admin").token,
    {name:"Linux monitor fixture",permissionMode:"admin",os:"linux",capabilities:["desktop_gui"]})!.client!;
   const missing="Monitor discovery needs xrandr with RandR 1.5 support on this Linux X11 desktop.";
   const linuxSocket=new EventEmitter() as typeof socket;
   const calls:Array<Record<string,unknown>>=[];
   linuxSocket.readyState=1;
   linuxSocket.close=()=>{linuxSocket.readyState=3;linuxSocket.emit("close")};
   linuxSocket.send=data=>{
    const r=JSON.parse(data);calls.push(r.params);
    queueMicrotask(()=>{
     const error=r.params.operation==="monitors"?missing:r.params.monitorId?"Selected monitor is unavailable":undefined;
     linuxSocket.emit("message",JSON.stringify({type:"response",requestId:r.requestId,ok:!error,
      ...(error?{error}:{result:frame()})}));
    });
   };
   gateway.attachRemoteClient(linuxSocket,linux.id,owner.id);
   const ctx={params:Promise.resolve({id:linux.id})};
   const req=(method="GET",body?:unknown)=>new Request("http://localhost/api/remote-clients/"+linux.id+"/desktop",
    {method,headers:{cookie:"ai_chat_auth="+token},...(body===undefined?{}:{body:JSON.stringify(body)})});
   try {
    const discovery=await api.GET(req(),ctx);
    assert.equal(discovery.status,200);
    assert.deepEqual(await discovery.json(),{monitors:[],selectionSupported:false,
     reason:"Install xrandr on this Linux device to choose a monitor."});
    assert.equal((await api.POST(req("POST"),ctx)).status,200);
    assert.equal((await api.POST(req("POST",{monitorId:"left"}),ctx)).status,409);
    assert.deepEqual(calls,[{operation:"monitors"},{operation:"preview"},{operation:"preview",monitorId:"left"}]);
    for(const message of ["Screen recording permission denied","Desktop is locked",missing+" Additional failure"]){
     await assert.rejects(capture.createDesktopMonitorList(async()=>{throw new Error(message)})(linux.id,owner.id),
      error=>error instanceof Error&&error.message===message);
    }
    await assert.rejects(capture.createDesktopMonitorList(async()=>{throw new Error(missing)})(client.id,owner.id),
     error=>error instanceof Error&&error.message===missing,"A Windows client must not gain a Linux-only fallback");
   } finally {linuxSocket.close();}
  });
  await t.test("monitor discovery rejects invalid native inventories instead of inventing choices",async()=>{
   for(const result of [{},null,{monitors:null},{monitors:[monitors[0],monitors[0]]},
    {monitors:[{...monitors[0],width:0}]},{monitors:[{...monitors[0],primary:undefined}]}]){
    const invalid=capture.createDesktopMonitorList(async()=>result);
    await assert.rejects(invalid(client.id,owner.id),error=>error instanceof capture.DesktopPreviewError&&error.status===502);
   }
   assert.deepEqual(await capture.createDesktopMonitorList(async()=>({monitors:[]}))(client.id,owner.id),{monitors:[],selectionSupported:true});
  });
  await t.test("permissions revoked during an asynchronous capture or monitor lookup suppress its result",async()=>{
   for(const kind of ["frame","monitors"] as const){
    let finish!:(result:unknown)=>void;
    const waiting=new Promise<unknown>(resolve=>{finish=resolve});
    const read=kind==="frame"
     ?capture.createDesktopCapture(async()=>waiting)
     :capture.createDesktopMonitorList(async()=>waiting);
    const first=read(client.id,owner.id),second=read(client.id,owner.id);
    clients.updateRemoteClient(client.id,owner.id,{policy:{permissions:[]}});
    finish(kind==="frame"?frame():{monitors});
    const results=await Promise.allSettled([first,second]);
    assert.ok(results.every(r=>r.status==="rejected"&&r.reason instanceof capture.DesktopPreviewError&&r.reason.status===403));
    clients.updateRemoteClient(client.id,owner.id,{policy:{permissions:["computer_use","execute_command"]}});
   }
  });
  await t.test("monitor lists and frames recheck permissions even if an earlier request is cached",async()=>{
   const inventory=capture.createDesktopMonitorList(async()=>({monitors}));
   await inventory(client.id,owner.id);
   clients.updateRemoteClient(client.id,owner.id,{policy:{permissions:[]}});
   assert.equal((await api.GET(request(),context)).status,403);
   await assert.rejects(inventory(client.id,owner.id),error=>error instanceof capture.DesktopPreviewError&&error.status===403);
   clients.updateRemoteClient(client.id,owner.id,{policy:{permissions:["computer_use"]}});
   assert.equal(clients.listRemoteAudit(owner.id).length,0,"No monitor inventories or image payloads are persisted as audit records");
  });
 } finally {socket.close();getDatabase().close();rmSync(root,{recursive:true,force:true});}
});
