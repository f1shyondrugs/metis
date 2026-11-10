import {monitorEventLoopDelay,performance} from "node:perf_hooks";
import {mkdir,writeFile,rename} from "node:fs/promises";
import path from "node:path";
import {threadId} from "node:worker_threads";
import type {DatabaseSync} from "node:sqlite";

type Operation="prepare"|"exec"|"get"|"all"|"run"|"iterate.next";
type Counts={calls:number;totalMs:number;maxMs:number;over10Ms:number;over50Ms:number;busyErrors:number;buckets:number[]};
const boundaries=[0.1,0.5,1,2,5,10,25,50,100,250,1000,10000,Infinity];
function counts():Counts{return {calls:0,totalMs:0,maxMs:0,over10Ms:0,over50Ms:0,busyErrors:0,buckets:boundaries.map(()=>0)};}
const round=(n:number)=>Math.round(n*1000)/1000;
function percentile(row:Counts,p:number){let n=0;for(let i=0;i<row.buckets.length;i++){n+=row.buckets[i];if(n>=row.calls*p)return Number.isFinite(boundaries[i])?boundaries[i]:null;}return null;}
/** Opt-in, bounded timing only. No SQL text, bound values, result rows, URLs or stack traces are retained. */
export function createRuntimePerformance(until:number,outputDir:string,startAt=Date.now()) {
 let startedAt=Math.max(startAt,Date.now()),initial=performance.eventLoopUtilization(),began=false;
 const delay=monitorEventLoopDelay({resolution:20});
 const operations=new Map<Operation,Counts>();let finished=false;let written:Promise<void>|undefined;
 const begin=()=>{if(finished)return;began=true;startedAt=Date.now();initial=performance.eventLoopUtilization();delay.enable();};
 const beginTimer=setTimeout(begin,Math.max(0,startedAt-Date.now()));beginTimer.unref();
 function measure<T>(operation:Operation,fn:()=>T):T{
  if(!began||finished||Date.now()>=until)return fn();
  const start=performance.now();let busy=false;
  try{return fn();}catch(error){const e=error as {code?:unknown;errcode?:unknown};busy=e?.code==="SQLITE_BUSY"||e?.code==="SQLITE_LOCKED"||e?.errcode===5||e?.errcode===6;throw error;}
  finally{const elapsed=performance.now()-start,row=operations.get(operation)??counts();row.calls++;row.totalMs+=elapsed;row.maxMs=Math.max(row.maxMs,elapsed);if(elapsed>=10)row.over10Ms++;if(elapsed>=50)row.over50Ms++;if(busy)row.busyErrors++;row.buckets[boundaries.findIndex(max=>elapsed<=max)]++;operations.set(operation,row);}
 }
 function snapshot(){
  const loop=performance.eventLoopUtilization(initial);
  return {pid:process.pid,threadId,startedAt:new Date(startedAt).toISOString(),endedAt:new Date().toISOString(),durationMs:began?Date.now()-startedAt:0,
   eventLoop:{utilization:round(loop.utilization),activeMs:round(loop.active),idleMs:round(loop.idle),delaySamples:delay.count,p50Ms:delay.count?round(delay.percentile(50)/1e6):null,p95Ms:delay.count?round(delay.percentile(95)/1e6):null,p99Ms:delay.count?round(delay.percentile(99)/1e6):null,maxMs:delay.count?round(delay.max/1e6):null},
   database:Object.fromEntries([...operations].map(([op,row])=>[op,{calls:row.calls,totalMs:round(row.totalMs),maxMs:round(row.maxMs),p95UpperBoundMs:percentile(row,.95),over10Ms:row.over10Ms,over50Ms:row.over50Ms,busyErrors:row.busyErrors}])),
   note:"Database timings include synchronous execution and possible lock waits; they do not distinguish the two. No SQL or user payloads recorded."};
 }
 function finish(){
  if(written)return written;
  finished=true;delay.disable();clearTimeout(beginTimer);clearTimeout(timer);const data=snapshot();
  written=(async()=>{await mkdir(outputDir,{recursive:true,mode:0o700});const dest=path.join(outputDir,`runtime-${process.pid}-${threadId}.json`),temp=dest+".tmp";await writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});await rename(temp,dest);})();
  return written;
 }
 const timer=setTimeout(()=>{void finish().catch(()=>undefined);},Math.max(1,Math.min(10*60_000,until-startedAt)));timer.unref();
 return {measure,snapshot,finish};
}
type Sample=ReturnType<typeof createRuntimePerformance>;
const key=Symbol.for("metis.runtime-performance");
const globalSample=globalThis as typeof globalThis & {[key]?:Sample|null};
function settings(){
 const until=Number(process.env.METIS_PERFORMANCE_UNTIL),output=process.env.METIS_PERFORMANCE_OUTPUT_DIR;
 const start=Number(process.env.METIS_PERFORMANCE_START_AT)||Date.now();
 return Number.isFinite(until)&&until>Date.now()&&until-Date.now()<=10*60_000&&start<until&&output&&path.isAbsolute(output)?{until,output,start}:null;
}
export function startRuntimePerformance(){
 if(globalSample[key]!==undefined)return globalSample[key];
 const config=settings();return globalSample[key]=config?createRuntimePerformance(config.until,config.output,config.start):null;
}
export function instrumentDatabase(database:DatabaseSync):DatabaseSync{
 const sample=startRuntimePerformance();if(!sample)return database;
 const measured=new Set(["get","all","run"]);
 const statement=(value:ReturnType<DatabaseSync["prepare"]>)=>new Proxy(value,{get(target,prop){
  const fn=Reflect.get(target,prop,target);if(typeof fn!=="function")return fn;
  if(prop==="iterate")return (...args:unknown[])=>{
   const iterator=Reflect.apply(fn,target,args) as IterableIterator<unknown>;
   const wrapped:IterableIterator<unknown>=new Proxy(iterator,{get(item,method){
    if(method===Symbol.iterator)return ()=>wrapped;
    const action=Reflect.get(item,method,item);if(typeof action!=="function")return action;
    return (...next:unknown[])=>method==="next"?sample.measure("iterate.next",()=>Reflect.apply(action,item,next)):Reflect.apply(action,item,next);
   }});return wrapped;
  };
  return (...args:unknown[])=>measured.has(String(prop))?sample.measure(prop as Operation,()=>Reflect.apply(fn,target,args)):Reflect.apply(fn,target,args);
 }});
 return new Proxy(database,{get(target,prop){
  const fn=Reflect.get(target,prop,target);if(typeof fn!=="function")return fn;
  if(prop==="prepare")return (...args:unknown[])=>statement(sample.measure("prepare",()=>Reflect.apply(fn,target,args)));
  if(prop==="exec")return (...args:unknown[])=>sample.measure("exec",()=>Reflect.apply(fn,target,args));
  return fn.bind(target);
 }});
}
