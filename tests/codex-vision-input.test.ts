import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createServer} from "node:http";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-native-vision-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
async function fixture(){
 const {getDatabase}=await import("../lib/sqlite");const store=await import("../lib/db-store"),uploads=await import("../lib/uploads");
 const db=getDatabase();for(const id of ["owner","other"])db.prepare("INSERT OR IGNORE INTO users(id,username,password_hash,created_at,is_admin) VALUES(?,?,?,?,1)").run(id,id,"fixture",new Date().toISOString());
 const chat=store.createChat("Vision",undefined,"owner");
 const pixels=await (await import("sharp")).default({create:{width:20,height:10,channels:3,background:"#ff0000"}}).png().toBuffer();
 const {stored}=uploads.saveAttachments(chat.id,[{name:"screen.png",mimeType:"image/png",data:pixels.toString("base64")}],"owner");
 store.appendMessage(chat.id,{id:"question",role:"user",content:"Explain this",attachments:stored},"owner");
 return {chat,stored,pixels,uploads};
}
test("authorized native images are immutable private snapshots, ordered and cleaned",async()=>{
 const f=await fixture(),{prepareCodexInput}=await import("../lib/providers/codex-input");
 const job={chatId:f.chat.id,userId:"owner",attachments:[...f.stored,...f.stored]};
 const turn=prepareCodexInput("Question",job,{capabilities:{vision:true}},root);
 assert.ok(Array.isArray(turn.input));assert.deepEqual(turn.input.map(x=>x.type),["text","local_image","local_image"]);
 const images=turn.input.filter(x=>x.type==="local_image");
 for(const image of images){assert.deepEqual(fs.readFileSync(image.path),f.pixels);assert.equal(fs.statSync(image.path).mode&0o777,0o600);}
 fs.writeFileSync(f.uploads.resolveUploadPath(f.chat.id,f.stored[0].storedName,"owner")!,"changed");
 assert.deepEqual(fs.readFileSync(images[0].path),f.pixels);
 turn.dispose();turn.dispose();assert.ok(images.every(i=>!fs.existsSync(i.path)));
});
test("unknown/non-vision models stay explicit, text-only turns do not allocate files",async()=>{
 const f=await fixture(),{prepareCodexInput}=await import("../lib/providers/codex-input");
 for(const model of [undefined,{capabilities:{}},{capabilities:{vision:false}}]){
  const turn=prepareCodexInput("Question",{chatId:f.chat.id,userId:"owner",attachments:f.stored},model,root);
  assert.equal(typeof turn.input,"string");assert.match(turn.input as string,/unavailable or unconfirmed/);turn.dispose();
 }
 const turn=prepareCodexInput("Text",{chatId:f.chat.id,userId:"owner",attachments:[]},{capabilities:{vision:true}},root);
 assert.equal(turn.input,"Text");turn.dispose();
});
test("foreign chat and symlink image inputs fail closed and remove partial snapshots",async()=>{
 const f=await fixture(),{prepareCodexInput}=await import("../lib/providers/codex-input");
 assert.throws(()=>prepareCodexInput("x",{chatId:f.chat.id,userId:"other",attachments:f.stored},{capabilities:{vision:true}},root),/authorized/);
 const before=fs.readdirSync(root).filter(n=>n.startsWith("metis-vision-"));
 const file=f.uploads.resolveUploadPath(f.chat.id,f.stored[0].storedName,"owner")!;
 fs.unlinkSync(file);fs.symlinkSync(path.join(root,"chat.sqlite"),file);
 assert.throws(()=>prepareCodexInput("x",{chatId:f.chat.id,userId:"owner",attachments:f.stored},{capabilities:{vision:true}},root));
 assert.deepEqual(fs.readdirSync(root).filter(n=>n.startsWith("metis-vision-")),before);
});
test("real Codex SDK/CLI transmits image pixels initially and on resume with native tools disabled",{timeout:30000,skip:process.platform==="win32"},async(t)=>{
 const f=await fixture(),{prepareCodexInput}=await import("../lib/providers/codex-input"),{Codex}=await import("@openai/codex-sdk");
 const requests:Array<Record<string,unknown>>=[];
 const server=createServer(async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  if(!req.url?.endsWith("/responses")){res.writeHead(404).end();return;}
  requests.push(JSON.parse(body));
  const message={type:"message",id:"msg-"+requests.length,role:"assistant",status:"completed",content:[{type:"output_text",text:"fixture",annotations:[]}]};
  const response={id:"response-"+requests.length,object:"response",created_at:0,status:"completed",output:[message],usage:{input_tokens:100,output_tokens:5,total_tokens:105,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
  res.writeHead(200,{"content-type":"text/event-stream",connection:"close"});
  for(const event of [{type:"response.created",response:{...response,status:"in_progress",output:[]}},{type:"response.output_item.added",output_index:0,item:{...message,status:"in_progress",content:[]}},{type:"response.output_item.done",output_index:0,item:message},{type:"response.completed",response}])res.write("event: "+event.type+"\ndata: "+JSON.stringify(event)+"\n\n");res.end();
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const home=path.join(root,"cli-home");fs.mkdirSync(home);
 const codex=new Codex({codexPathOverride:path.resolve("node_modules/.bin/codex"),env:{PATH:process.env.PATH||"",CODEX_HOME:home,OPENAI_API_KEY:"fixture-only"},config:{model_provider:"fixture",model_providers:{fixture:{name:"Fixture",base_url:"http://127.0.0.1:"+(server.address() as {port:number}).port+"/v1",wire_api:"responses",requires_openai_auth:false}},web_search:"disabled",features:{shell_tool:false,view_image:false}}});
 const opts={model:"fixture-model",workingDirectory:root,skipGitRepoCheck:true,sandboxMode:"danger-full-access" as const,approvalPolicy:"never" as const};
 const first=codex.startThread(opts);
 for(let index=0;index<2;index++){
  const turn=prepareCodexInput("Question "+index,{chatId:f.chat.id,userId:"owner",attachments:f.stored},{capabilities:{vision:true}},home);
  try{await (index?codex.resumeThread(first.id!,opts):first).run(turn.input,{signal:AbortSignal.timeout(10000)});}finally{turn.dispose();}
 }
 assert.equal(requests.length,2);
 for(const req of requests){const raw=JSON.stringify(req.input);assert.match(raw,/input_image/);assert.match(raw,/data:image\/png;base64,/);assert.match(raw,/Question /);}
 console.log("REAL_CODEX_NATIVE_IMAGE_INITIAL_AND_RESUME_OK");
});
