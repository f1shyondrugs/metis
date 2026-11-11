import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-overlay-tool-"));
Object.assign(process.env,{AI_CHAT_ROOT:dir,AI_CHAT_MCP_STATE_DIR:dir,AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",MCP_BEARER_TOKEN:"fixture"});
test("MCP tool uses explicit account-scoped remote request and canonical display_id",async()=>{
  const gateway=await import("../lib/mcp-core/gateway-core.mjs");
  const original=globalThis.fetch;
  const requests:Array<{url:string;init?:RequestInit}>=[];
  globalThis.fetch=(async(url,init)=>{
    requests.push({url:String(url),init});
    return Response.json({result:{revision:2,monitors:[{id:"native-monitor",width:1280,height:720,scale:1.5}]}});
  }) as typeof fetch;
  const context={userId:"owner-a",jobId:"job-a",runtimeMode:"full-access",source:"agent"};
  const call=(args:Record<string,unknown>,ctx:Record<string,unknown>=context)=>gateway.dispatchGatewayTool("desktop_overlay",args,{context:ctx,auditCall:false});
  try{
    assert.ok(gateway.tools.find(t=>t.name==="desktop_overlay"));
    const result=await call({client_id:"exact-client",operation:"undo",display_id:"native-monitor"});
    assert.equal(result.isError,undefined);
    const req=requests.find(r=>r.url.endsWith("/api/internal/remote-client"))!;
    assert.ok(req);
    const body=JSON.parse(String(req.init?.body));
    assert.equal(body.clientId,"exact-client");
    assert.equal(body.action,"desktop_overlay");
    assert.deepEqual(body.params,{operation:"undo",display_id:"native-monitor"});
    assert.equal(new Headers(req.init?.headers).get("x-ai-chat-user-id"),"owner-a");
    assert.equal(new Headers(req.init?.headers).get("x-ai-chat-job-id"),"job-a");
    requests.length=0;
    const rejected=await call({client_id:"exact-client",operation:"status"},{runtimeMode:"full-access"});
    assert.equal(rejected.isError,true);assert.equal(requests.length,0);
    await assert.rejects(call({client_id:"exact-client",operation:"undo"}),/display_id/);
    await assert.rejects(call({client_id:"exact-client",operation:"status",ownerId:"owner-b"}),/unknown field/);
    assert.equal(requests.length,0);
  }finally{globalThis.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
});
