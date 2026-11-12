import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-inspect-image-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,MCP_BEARER_TOKEN:"fixture-image",AI_CHAT_TEST_BYPASS_LEASE:"0"});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test("image inspection is image content with exact crop geometry and lease/account/chat boundaries",async()=>{
 const {getDatabase}=await import("../lib/sqlite"),store=await import("../lib/db-store"),jobs=await import("../lib/db-jobs"),uploads=await import("../lib/uploads");
 const db=getDatabase();for(const id of ["owner","other"])db.prepare("INSERT INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,1)").run(id,id,"fixture",new Date().toISOString());
 const chat=store.createChat("Image",undefined,"owner"),foreign=store.createChat("Other",undefined,"other");
 const pixels=await sharp({create:{width:40,height:20,channels:3,background:"#00ff00"}}).png().toBuffer();
 const {stored}=uploads.saveAttachments(chat.id,[{name:"screen.png",mimeType:"image/png",data:pixels.toString("base64")}],"owner");
 store.appendMessage(chat.id,{id:"u",role:"user",content:"Look",attachments:stored},"owner");
 const job=jobs.enqueueJob({chatId:chat.id,userId:"owner",message:"Look",attachments:stored}),claimed=jobs.claimNextJob({workerId:"fixture-worker"})!;
 assert.equal(job.id,claimed.id);
 const {POST}=await import("../app/api/internal/mcp-file/route");
 function request(body:unknown,changes:Record<string,string>={}){
  return new Request("http://test/api/internal/mcp-file",{method:"POST",headers:{authorization:"Bearer fixture-image","content-type":"application/json","x-ai-chat-id":chat.id,"x-ai-chat-user-id":"owner","x-ai-chat-job-id":job.id,"x-ai-chat-worker-id":claimed.leaseOwner!,"x-ai-chat-lease-token":claimed.leaseToken!,...changes},body:JSON.stringify(body)});
 }
 const body={action:"inspect_image",attachment_id:stored[0].id,crop:{x:10,y:5,width:12,height:6}};
 const response=await POST(request(body));assert.equal(response.status,200);
 const result=await response.json();assert.deepEqual(result.content.map((b:{type:string})=>b.type),["text","image"]);
 const geometry=JSON.parse(result.content[0].text);assert.deepEqual(geometry.source,{width:40,height:20});assert.deepEqual(geometry.crop,body.crop);
 const decoded=await sharp(Buffer.from(result.content[1].data,"base64")).raw().toBuffer({resolveWithObject:true});
 assert.equal(decoded.info.width,12);assert.equal(decoded.info.height,6);assert.deepEqual([...decoded.data.subarray(0,3)],[0,255,0]);
 for(const crop of [{x:39,y:0,width:2,height:2},{x:0.5,y:0,width:2,height:2},{x:0,y:0,width:0,height:2}]){
  assert.equal((await POST(request({...body,crop}))).status,400);
 }
 assert.equal((await POST(request(body,{authorization:"Bearer wrong"}))).status,401);
 assert.equal((await POST(request(body,{"x-ai-chat-lease-token":"wrong"}))).status,401);
 assert.equal((await POST(request(body,{"x-ai-chat-user-id":"other"}))).status,404);
 assert.equal((await POST(request(body,{"x-ai-chat-id":foreign.id}))).status,404);
 assert.equal((await POST(request({action:"inspect_image",attachment_id:"/etc/passwd",path:"/etc/passwd"}))).status,400);
 const file=uploads.resolveUploadPath(chat.id,stored[0].storedName,"owner")!;
 fs.unlinkSync(file);fs.symlinkSync(path.join(root,"chat.sqlite"),file);
 assert.equal((await POST(request(body))).status,400);
});
test("MCP inspection returns image blocks unchanged and binds IDs to current context",async()=>{
 const {dispatchGatewayTool}=await import("../lib/mcp-core/gateway-core.mjs");
 const original=globalThis.fetch;let actual:RequestInit|undefined;
 globalThis.fetch=(async(_url,init)=>{actual=init;return Response.json({content:[{type:"text",text:"geometry"},{type:"image",mimeType:"image/png",data:"fixture-pixels"}]});}) as typeof fetch;
 try{
  const context={userId:"owner",chatId:"chat",jobId:"job",runtimeMode:"full-access",source:"agent"};
  const result=await dispatchGatewayTool("inspect_image",{attachment_id:"image"},{context,auditCall:false});
  assert.deepEqual(result.content.map((b:{type:string})=>b.type),["text","image"]);
  assert.equal(new Headers(actual?.headers).get("x-ai-chat-user-id"),"owner");
  assert.deepEqual(JSON.parse(String(actual?.body)),{action:"inspect_image",attachment_id:"image"});
  const rejected=await dispatchGatewayTool("inspect_image",{attachment_id:"image"},{context:{runtimeMode:"full-access"},auditCall:false});assert.equal(rejected.isError,true);
 }finally{globalThis.fetch=original;}
});
