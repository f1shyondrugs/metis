import assert from "node:assert/strict";
import test,{after,mock} from "node:test";
import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import {EventEmitter} from "node:events";
import {PassThrough,Writable} from "node:stream";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";

const directory=mkdtempSync(path.join(os.tmpdir(),"metis-cursor-proxy-")),workspace=path.join(directory,"workspace");mkdirSync(workspace);mkdirSync(path.join(directory,"host-home"));
Object.assign(process.env,{HOME:path.join(directory,"host-home"),METIS_NATIVE_ISOLATION:"1",AI_CHAT_ROOT:process.cwd(),CHAT_DATA_DIR:path.join(directory,"data"),AI_CHAT_MCP_STATE_DIR:path.join(directory,"mcp-state"),AGENT_CWD:workspace});
after(()=>{mock.restoreAll();syncBuiltinESMExports();rmSync(directory,{recursive:true,force:true});});
type WireMessage =
 | {op:"create"|"resume"|"send"|"cancel"|"dispose";id:number}
 | {op:"ack";seq:number}
 | {op:"deltaAck"};
type Reply=(value:Record<string,unknown>)=>void;
class FixtureChild extends EventEmitter {
 stdout=new PassThrough();stderr=new PassThrough();stdin:Writable=new PassThrough();killed=false;
 kill(){this.killed=true;queueMicrotask(()=>this.emit("exit",null,"SIGKILL"));return true;}
}
function fixture(handle:(value:WireMessage,reply:Reply)=>void){
 const child=new FixtureChild();
 const emit:Reply=(value)=>{child.stdout.write(JSON.stringify(value)+"\n");};let buffer="";
 child.stdin=new Writable({write(chunk,_encoding,done){buffer+=chunk.toString();let at:number;while((at=buffer.indexOf("\n"))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);handle(JSON.parse(line) as WireMessage,emit);}done();}});
 child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit("exit",null,"SIGKILL"));return true;};
 mock.method(childProcess,"spawn",()=>child as unknown as ReturnType<typeof childProcess.spawn>);syncBuiltinESMExports();return child;
}
const token=`metis-v1.${Buffer.from(JSON.stringify({userId:"alice"})).toString("base64url")}.fixture`;
const options={apiKey:"synthetic-own-provider-key",model:"fixture-model",local:{cwd:workspace},tools:["mcp"],mcpServers:{gateway:{type:"http",url:"http://127.0.0.1:1/mcp",headers:{Authorization:`Bearer ${token}`}}}} as unknown as Parameters<typeof import("@cursor/sdk").Agent.create>[0];

test("Cursor proxy preserves early progress, abandoned streams, independent wait and cancellation",async()=>{
 let sendId=0,sendReply:Reply|undefined,cancelled=false;const deltas:unknown[]=[];
 const child=fixture((value,emit)=>{
  if(value.op==="create")emit({type:"reply",id:value.id,value:{agentId:"owned-session"}});
  else if(value.op==="send"){sendId=value.id;sendReply=emit;emit({type:"delta",id:value.id,value:{text:"early"}});}
  else if(value.op==="ack"){
   if(value.seq===1)emit({type:"stream",id:sendId,seq:2,value:{type:"fixture",text:"second"}});
   else if(value.seq===2){emit({type:"streamEnd",id:sendId});emit({type:"result",id:sendId,value:{text:"done"}});}
  }else if(value.op==="cancel"){cancelled=true;emit({type:"reply",id:value.id,value:{}});}
  else if(value.op==="dispose")emit({type:"reply",id:value.id,value:{}});
 });
 const {isolatedCursor}=await import("../lib/providers/cursor-runtime");
 const agent=await isolatedCursor("alice",workspace).create(options);assert.equal(agent.agentId,"owned-session");
 mock.timers.enable({apis:["setTimeout"]});
 try{
  const pending=agent.send("fixture",{onDelta:value=>{deltas.push(value);}});
  assert.deepEqual(deltas,[{text:"early"}]);mock.timers.tick(90001);assert.equal(child.killed,false,"valid progress disarms send startup deadline");
  sendReply!({type:"reply",id:sendId,value:{}});const run=await pending;
  sendReply!({type:"stream",id:sendId,seq:1,value:{type:"fixture",text:"first"}});
  for await(const message of run.stream()){assert.equal((message as unknown as {text:string}).text,"first");break;}
  assert.deepEqual(await run.wait(),{text:"done"});await run.cancel();assert.equal(cancelled,true);
  await agent[Symbol.asyncDispose]();assert.equal(child.killed,true);
 }finally{mock.timers.reset();mock.restoreAll();syncBuiltinESMExports();}
});

test("Cursor proxy rejects oversized unterminated stdout before parsing or unbounded accumulation",async()=>{
 const child=fixture(value=>{if(value.op==="create")child.stdout.write(Buffer.alloc(17*1024*1024,97));});
 const {isolatedCursor}=await import("../lib/providers/cursor-runtime");
 try{await assert.rejects(isolatedCursor("alice",workspace).create(options),/response too large/);assert.equal(child.killed,true);}
 finally{mock.restoreAll();syncBuiltinESMExports();}
});

test("Cursor proxy preserves structured provider errors for rate-limit and session recovery",async()=>{
 fixture((value,emit)=>{if(value.op==="resume")emit({type:"reply",id:value.id,error:{name:"RateLimitError",message:"provider limit",code:"rate_limit_exceeded",status:429,retryAfter:12}});});
 const {isolatedCursor}=await import("../lib/providers/cursor-runtime");
 try{await assert.rejects(isolatedCursor("alice",workspace).resume("existing-session",options),(error:unknown)=>{const details=error as {status?:number;code?:string;retryAfter?:number};return details.status===429&&details.code==="rate_limit_exceeded"&&details.retryAfter===12;});}
 finally{mock.restoreAll();syncBuiltinESMExports();}
});
