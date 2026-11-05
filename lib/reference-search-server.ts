import { Worker } from "node:worker_threads";
import path from "node:path";
import { databasePath,getDatabase } from "./sqlite";
import type { ReferenceKind,ReferenceResult } from "./reference-search";

type Input={ownerId:string;query:string;kind?:ReferenceKind|null;kinds?:readonly ReferenceKind[];currentChatId:string};
export type ReferencePayload={results:ReferenceResult[];indexing:boolean};
type Task={resolve:(value:ReferencePayload)=>void;reject:(error:Error)=>void;cleanup:()=>void};
type Pool={worker?:Worker;serial:number;tasks:Map<number,Task>;idle?:ReturnType<typeof setTimeout>};
const key=Symbol.for("metis.reference-search-worker");
const globals=globalThis as typeof globalThis & {[key]?:Pool};
const pool:Pool=globals[key]??={serial:0,tasks:new Map()};
const aborted=()=>Object.assign(new Error("Search cancelled"),{name:"AbortError"});

/** A bounded, cancellable worker keeps all legacy JSON and SQLite scans off HTTP's event loop. */
export function searchReferences(input:Input,signal?:AbortSignal):Promise<ReferencePayload>{
 if(signal?.aborted)return Promise.reject(aborted());
 if(pool.tasks.size>=16)return Promise.reject(new Error("Reference search is busy. Retry shortly."));
 getDatabase();
 if(pool.idle)clearTimeout(pool.idle);
 if(!pool.worker){
  const worker=pool.worker=new Worker(path.join(process.env.AI_CHAT_INSTALL_DIR||process.cwd(),"lib/reference-search-worker.mjs"),{
   workerData:{databasePath,referencePayload:true},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:16},
  });
  const failed=(error:Error)=>{
   if(pool.worker!==worker)return;
   pool.worker=undefined;
   for(const task of pool.tasks.values()){task.cleanup();task.reject(error);}
   pool.tasks.clear();
  };
  worker.on("error",failed);
  worker.on("exit",code=>failed(new Error("Reference worker exited ("+code+")")));
  worker.on("message",(reply:{id:number;value:ReferencePayload;error?:string;errorName?:string})=>{
   const task=pool.tasks.get(reply.id);
   if(!task)return;
   task.cleanup();pool.tasks.delete(reply.id);
   if(reply.error)task.reject(Object.assign(new Error(reply.error),{name:reply.errorName}));
   else task.resolve(reply.value);
   if(!pool.tasks.size){
    worker.unref();
    pool.idle=setTimeout(()=>{if(pool.worker===worker){pool.worker=undefined;void worker.terminate();}},300000);
    pool.idle.unref();
   }
  });
 }
 const worker=pool.worker,id=++pool.serial;
 worker.ref();
 return new Promise((resolve,reject)=>{
  // Keep cancelled requests in the bounded pool until the worker acknowledges them.
  const cancel=()=>{worker.postMessage({id,cancel:true});reject(aborted());};
  const timeout=setTimeout(()=>{worker.postMessage({id,cancel:true});reject(new Error("Reference search timed out."));},30000);
  const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener("abort",cancel);};
  pool.tasks.set(id,{resolve,reject,cleanup});
  signal?.addEventListener("abort",cancel,{once:true});
  worker.postMessage({id,input});
  if(signal?.aborted)cancel();
 });
}
