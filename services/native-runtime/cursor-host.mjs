// This module runs only inside the owner's native runtime namespace. It has no
// application imports, database, root bearer, or access to other owners' state.
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import path from 'node:path';
import {Console} from 'node:console';
globalThis.console=new Console({stdout:process.stderr,stderr:process.stderr});
const {Agent,JsonlLocalAgentStore}=await import('@cursor/sdk');
let agent;
const runs=new Map(),acknowledgements=new Map();let sequence=0,pendingDeltas=0;
const errorRecord=e=>({name:e?.name,message:e?.message||String(e),code:e?.code,status:e?.status,statusCode:e?.statusCode,retryAfter:e?.retryAfter,...(e?.cause?{cause:{message:e.cause.message,code:e.cause.code}}:{})});
const write=value=>process.stdout.write(JSON.stringify(value)+'\n');
const send=async value=>{if(!write(value))await once(process.stdout,'drain');};
async function stream(run,id){
 try{for await(const message of run.stream()){
   const seq=++sequence;const ack=new Promise(resolve=>acknowledgements.set(seq,resolve));
   await send({type:'stream',id,seq,value:message});await ack;
 }await send({type:'streamEnd',id});}
 catch(error){await send({type:'streamEnd',id,error:errorRecord(error)});}
}
async function handle(value){
 if(value.op==='ack'){const resolve=acknowledgements.get(value.seq);acknowledgements.delete(value.seq);resolve?.();return;}
 if(value.op==='deltaAck'){pendingDeltas=Math.max(0,pendingDeltas-1);return;}
 try{
  let result;
  if(value.op==='create'||value.op==='resume'){
   if(agent)throw Error('Native agent already initialized');
   const options={...value.options,local:{...value.options.local,store:new JsonlLocalAgentStore(path.join(process.env.HOME,'cursor-store'))}};
   agent=await (value.op==='create'?Agent.create(options):Agent.resume(value.agentId,options));result={agentId:agent.agentId};
  }else if(value.op==='send'){
   if(!agent)throw Error('Native agent unavailable');
   const run=await agent.send(value.prompt,{...value.options,onDelta:delta=>{
    if(++pendingDeltas>1024)throw Error('Native delta consumer stalled');
    write({type:'delta',id:value.id,value:delta});
   }});
   runs.set(value.id,run);await send({type:'reply',id:value.id,value:{}});
   void stream(run,value.id);
   void run.wait().then(result=>send({type:'result',id:value.id,value:result}),error=>send({type:'result',id:value.id,error:errorRecord(error)}));return;
  }else if(value.op==='cancel'){
   const run=runs.get(value.runId);if(!run)throw Error('Native run unavailable');await run.cancel();result={};
  }else if(value.op==='dispose'){
   for(const resolve of acknowledgements.values())resolve();acknowledgements.clear();
   await agent?.[Symbol.asyncDispose]();await send({type:'reply',id:value.id,value:{}});process.exit(0);
  }else throw Error('Unsupported native operation');
  await send({type:'reply',id:value.id,value:result});
 }catch(error){await send({type:'reply',id:value.id,error:errorRecord(error)});}
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{if(Buffer.byteLength(line)>16*1024*1024){process.exit(126);return;}try{void handle(JSON.parse(line));}catch{process.exit(126);}});
input.on('close',async()=>{try{await agent?.[Symbol.asyncDispose]();}finally{process.exit(0);}});
