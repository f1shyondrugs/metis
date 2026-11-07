import {Agent} from "@cursor/sdk";
import {payloadRecord} from "@/lib/agent-payload";
import {nativeIsolationEnabled} from "@/lib/native-isolation-policy";
import type {Agent as SdkFactory,SDKAgent as SdkAgent,SDKMessage,RunResult} from "@cursor/sdk";
import {StringDecoder} from "node:string_decoder";
import {realpathSync} from "node:fs";
import path from "node:path";
import {config} from "@/lib/config";
import {assertNativeMcpServers,createNativeRuntimeScope,spawnNative,type NativeRuntimeScope} from "./native-sandbox";

type CreateOptions=Parameters<typeof SdkFactory.create>[0];
type SendOptions=NonNullable<Parameters<SdkAgent["send"]>[1]>;
function revived(value:unknown):Error {
 const source=payloadRecord(value) ?? {};
 const cause=payloadRecord(source.cause);
 return Object.assign(new Error(typeof source.message==="string"?source.message:"Native runtime failed"),source,
  {cause:cause&&typeof cause.message==="string"?new Error(cause.message):undefined});
}
type HostMessage =
 | {type:"reply";id:number;value:unknown;error?:unknown}
 | {type:"delta";id:number;value:Parameters<NonNullable<SendOptions["onDelta"]>>[0]}
 | {type:"stream";id:number;value:SDKMessage;seq:number}
 | {type:"streamEnd";id:number;error?:unknown}
 | {type:"result";id:number;value:RunResult;error?:unknown};
function json(value:unknown){return JSON.stringify(value,(_key,v)=>{if(typeof v==="function")throw Error("Native options must be serializable");return v;});}
class NativeRun {
 private items:Array<{value:SDKMessage;seq:number}>=[];private wake?:()=>void;private ended=false;private abandoned=false;private failure?:Error;
 private resolveResult!:(value:RunResult)=>void;private rejectResult!:(error:Error)=>void;
 private result=new Promise<RunResult>((resolve,reject)=>{this.resolveResult=resolve;this.rejectResult=reject;});
 constructor(private host:NativeCursorAgent,readonly id:number){void this.result.catch(()=>{});}
 push(value:SDKMessage,seq:number){if(this.abandoned){this.host.notify({op:"ack",seq});return;}if(this.items.length>=2)throw Error("Native stream overflow");this.items.push({value,seq});this.wake?.();}
 end(error?:unknown){this.ended=true;if(error)this.failure=revived(error);this.wake?.();}
 complete(value:RunResult,error?:unknown){if(error)this.rejectResult(revived(error));else this.resolveResult(value);}
 fail(error:Error){this.failure=error;this.ended=true;this.rejectResult(error);this.wake?.();}
 async *stream():AsyncGenerator<SDKMessage>{
  try{while(true){const item=this.items.shift();if(item){this.host.notify({op:"ack",seq:item.seq});yield item.value;continue;}if(this.ended){if(this.failure)throw this.failure;return;}await new Promise<void>(resolve=>this.wake=resolve);this.wake=undefined;}}
  finally{this.abandoned=true;for(const item of this.items)this.host.notify({op:"ack",seq:item.seq});this.items=[];}
 }
 wait(){return this.result;}
 async cancel(){await this.host.request({op:"cancel",runId:this.id});}
}
class NativeCursorAgent {
 agentId="";private nextId=0;private closed=false;
 private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private runs=new Map<number,NativeRun>();private deltas=new Map<number,SendOptions["onDelta"]>();
 private child;private lines;
 constructor(private scope:NativeRuntimeScope){
  this.child=spawnNative(process.execPath,[realpathSync(path.join(config.root,"services/native-runtime/cursor-host.mjs"))],{stdio:["pipe","pipe","pipe"]},[],scope);
  if(!this.child.stdin||!this.child.stdout||!this.child.stderr)throw Error("Native stdio unavailable");
  this.child.stderr.resume();
  this.child.stdin.on("error",error=>this.fail(error));this.child.on("error",error=>this.fail(error));
  this.child.on("exit",()=>{if(!this.closed)this.fail(Error("Isolated Cursor host exited"));});
  const handleLine=(line:string)=>{try{
   if(Buffer.byteLength(line)>16*1024*1024)throw Error("Native response too large");const v=JSON.parse(line) as HostMessage;
   if(v.type==="reply"){const p=this.pending.get(v.id);if(!p)return;this.pending.delete(v.id);clearTimeout(p.timer);if(v.error)p.reject(revived(v.error));else p.resolve(v.value);}
   else if(v.type==="delta"){const pending=this.pending.get(v.id);if(pending)clearTimeout(pending.timer);this.deltas.get(v.id)?.(v.value);this.notify({op:"deltaAck"});}
   else if(v.type==="stream")this.runs.get(v.id)?.push(v.value,v.seq);
   else if(v.type==="streamEnd")this.runs.get(v.id)?.end(v.error);
   else if(v.type==="result")this.runs.get(v.id)?.complete(v.value,v.error);
  }catch(error){this.fail(error instanceof Error?error:Error("Native protocol failed"));}};
  const decoder=new StringDecoder("utf8");let buffered="",total=0;
  const read=(chunk:Buffer)=>{if(this.closed)return;total+=chunk.length;if(total>64*1024*1024){this.fail(Error("Native output budget exceeded"));return;}buffered+=decoder.write(chunk);let at:number;while((at=buffered.indexOf("\n"))!==-1){const line=buffered.slice(0,at);buffered=buffered.slice(at+1);handleLine(line);if(this.closed)return;}if(Buffer.byteLength(buffered)>16*1024*1024)this.fail(Error("Native response too large"));};
  this.child.stdout.on("data",read);this.lines={close:()=>this.child.stdout.off("data",read)};
 }
 notify(value:unknown){if(!this.closed){if(this.child.stdin.writableLength>16*1024*1024)throw Error("Native input budget exceeded");this.child.stdin!.write(json(value)+"\n");}}
 request(value:Record<string,unknown>,id=++this.nextId):Promise<unknown>{
  if(this.closed)return Promise.reject(Error("Native host closed"));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error("Native host request timed out"));this.fail(Error("Native host timed out"));},90000);this.pending.set(id,{resolve,reject,timer});try{this.notify({...value,id});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
 }
 private fail(error:Error){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();for(const run of this.runs.values())run.fail(error);this.child.kill("SIGKILL");this.lines.close();}
 async initialize(op:"create"|"resume",options:CreateOptions,agentId?:string){
  assertNativeMcpServers(options.mcpServers,this.scope.owner);
  try{const reply=payloadRecord(await this.request({op,options,agentId}));if(typeof reply?.agentId!=="string"||!reply.agentId)throw Error("Invalid native agent identity");this.agentId=reply.agentId;return this;}catch(error){this.fail(error instanceof Error?error:Error("Native agent failed"));throw error;}
 }
 async send(prompt:Parameters<SdkAgent["send"]>[0],options?:SendOptions){
  if(options?.mcpServers)assertNativeMcpServers(options.mcpServers,this.scope.owner);
  const id=++this.nextId,run=new NativeRun(this,id);this.runs.set(id,run);this.deltas.set(id,options?.onDelta);
  const {onDelta:_,...serialized}=options??{};
  try{await this.request({op:"send",prompt,options:serialized},id);return run;}catch(error){run.fail(error instanceof Error?error:Error("Native send failed"));throw error;}
 }
 async [Symbol.asyncDispose](){if(this.closed)return;try{await this.request({op:"dispose"});}finally{this.closed=true;this.child.kill("SIGKILL");this.lines.close();}}
}
export function isolatedCursor(owner:string,workspace:string): {
 create: (options: CreateOptions) => Promise<NativeCursorAgent | SdkAgent>;
 resume: (id: string, options: CreateOptions) => Promise<NativeCursorAgent | SdkAgent>;
} {
 if (!nativeIsolationEnabled()) return Agent;
 if (process.platform !== "linux") throw Error("Native isolation requires Linux");
 const scope=createNativeRuntimeScope(owner,workspace);
 return {create:(options:CreateOptions)=>new NativeCursorAgent(scope).initialize("create",options),resume:(id:string,options:CreateOptions)=>new NativeCursorAgent(scope).initialize("resume",options,id)};
}
