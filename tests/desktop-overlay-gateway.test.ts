import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-overlay-gateway-"));
Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"test.sqlite"),AGENT_CWD:dir});
test("real remote gateway enforces account, policy, capability and owner-upload hydration",async t=>{
  const auth=await import("../lib/auth");
  const clients=await import("../lib/remote-clients");
  const gateway=await import("../lib/remote-client-gateway");
  const uploads=await import("../lib/file-upload-store");
  const owner=auth.createUser("overlay-owner","synthetic-password");
  const other=auth.createUser("overlay-other","synthetic-password");
  const sent:Array<{action:string;params:Record<string,unknown>;requestId:string}>=[];
  function fixture(capabilities=["desktop_gui","overlay_annotations"], permissions=["computer_use"], unsupported=false) {
    const registered=clients.registerRemoteClient(clients.createEnrollmentToken(owner.id,undefined,"admin").token,{name:"Overlay fixture",permissionMode:"admin",os:"linux",capabilities})!;
    const client=registered.client!;
    clients.updateRemoteClient(client.id,owner.id,{policy:{mode:"full_access",permissions:permissions as ["computer_use"]}});
    const socket=new EventEmitter() as EventEmitter & {readyState:number;send:(raw:string)=>void;close:()=>void};
    socket.readyState=1;socket.close=()=>{socket.readyState=3;socket.emit("close");};
    socket.send=raw=>{
      const r=JSON.parse(raw);if(r.type!=="request")return;sent.push(r);
      queueMicrotask(()=>socket.emit("message",JSON.stringify({type:"response",requestId:r.requestId,ok:!unsupported,...(unsupported?{error:"Unsupported remote action: desktop_overlay"}:{}),result:{revision:1,items:r.params.items||[],monitors:[{id:"real",width:1920,height:1080,scale:1.5}]}})));
    };
    gateway.attachRemoteClient(socket,client.id,owner.id);
    socket.emit("message",JSON.stringify({type:"heartbeat",overlayAnnotations:capabilities.includes("overlay_annotations")}));
    return {client,socket,call:(params:Record<string,unknown>,ownerId=owner.id)=>gateway.requestRemoteClient({clientId:client.id,ownerId,action:"desktop_overlay",source:"agent",params})};
  }
  const fixtures:ReturnType<typeof fixture>[]=[];
  const f=fixture();fixtures.push(f);
  try {
    await t.test("foreign account cannot address an otherwise online client",()=>{
      assert.throws(()=>f.call({operation:"status"},other.id),/not found/);assert.equal(sent.length,0);
    });
    await t.test("old clients and disabled GUI permission get no request or command fallback",()=>{
      for(const [caps,permissions,pattern] of [
        [["desktop_gui"],["computer_use"],/update needed/],
        [["overlay_annotations"],["computer_use"],/no interactive GUI/],
        [["desktop_gui","overlay_annotations"],[],/switched off/],
      ] as const) {
        const old=fixture([...caps],[...permissions]);fixtures.push(old);
        assert.throws(()=>old.call({operation:"status"}),pattern);
      }
      assert.equal(sent.length,0);
    });
    await t.test("canonical display_id and full items survive transport; audit strips HTML",async()=>{
      const result=await f.call({operation:"add",display_id:"real",items:[{id:"card",type:"card",x:1,y:2,width:300,height:200,content:{kind:"html",source:"PRIVATE-CONTENT"}}]}) as {revision:number};
      assert.equal(result.revision,1);assert.equal(sent.at(-1)?.action,"desktop_overlay");
      assert.equal(sent.at(-1)?.params.display_id,"real");
      const audit=clients.listRemoteAudit(owner.id,f.client.id);
      assert.equal(JSON.stringify(audit).includes("PRIVATE-CONTENT"),false);
    });
    await t.test("exact owner-upload is hydrated, foreign owner and URL routes rejected before transport",async()=>{
      const upload=uploads.createUpload(owner.id,{name:"owned.txt",mimeType:"text/plain",size:1});
      await uploads.appendUpload(owner.id,upload.id,0,new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));c.close();}}));
      uploads.completeUpload(owner.id,upload.id);
      const foreign=uploads.createUpload(other.id,{name:"private.txt",mimeType:"text/plain",size:1});
      const command=(file:unknown)=>({operation:"add",display_id:"real",items:[{id:"file",type:"card",x:0,y:0,width:100,height:100,content:{kind:"file",file}}]});
      const count=sent.length;
      for(const file of [{id:foreign.id},{url:"https://evil.invalid"},{id:upload.id,url:"/api/uploads/foreign/private"},{id:"/etc/passwd"}]) {
        assert.throws(()=>f.call(command(file)));
      }
      assert.equal(sent.length,count);
      await f.call(command({id:upload.id}));
      const items=sent.at(-1)!.params.items as Array<{content:{file:Record<string,unknown>}}>;
      assert.deepEqual(items[0].content.file,{url:"/api/file-uploads/"+upload.id+"/file",name:"owned.txt",mimeType:"text/plain",size:1});
    });
    await t.test("malformed/prototype inputs cannot reach remote transport",()=>{
      const count=sent.length;
      assert.throws(()=>f.call(JSON.parse('{"operation":"status","__proto__":{"polluted":true}}')));
      assert.throws(()=>f.call({operation:"clear"}));
      assert.equal(sent.length,count);
    });
    await t.test("advertised but unsupported native action reports update-needed without shell fallback",async()=>{
      const old=fixture(undefined,undefined,true);fixtures.push(old);
      const count=sent.length;
      await assert.rejects(old.call({operation:"status"}),/update needed/);
      assert.equal(sent.length,count+1);assert.equal(sent.at(-1)?.action,"desktop_overlay");
    });
    await t.test("offline connection and mismatched live socket owner are rejected",()=>{
      const off=fixture();fixtures.push(off);off.socket.close();
      assert.throws(()=>off.call({operation:"status"}),/offline/);
      const wrong=fixture();fixtures.push(wrong);
      gateway.attachRemoteClient(wrong.socket,wrong.client.id,other.id);
      assert.throws(()=>wrong.call({operation:"status"}),/offline/);
    });
    await t.test("revocation and restricted policy are honored",()=>{
      clients.updateRemoteClient(f.client.id,owner.id,{policy:{mode:"restricted",permissions:[]}});
      assert.throws(()=>f.call({operation:"status"}),/switched off/);
    });
  }finally{
    for(const fixture of fixtures)fixture.socket.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
