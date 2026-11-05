import { parentPort,workerData,Worker } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
process.env.CHAT_DB_PATH=workerData.databasePath;
const {collectReferences,initializeReferenceSearch}=await tsImport("./reference-search-engine.ts",import.meta.url);
initializeReferenceSearch();
const indexer=new Worker(new URL("./reference-index-worker.mjs",import.meta.url),{workerData,resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:16}});
indexer.on("error",error=>{throw error;});
indexer.on("message",()=>{});
const schedule=(chatId,title,part)=>indexer.postMessage({chatId,title,part});
const cancelled=new Set(),active=new Set(),queue=[];
let running=false;
async function pump(){
 if(running)return;
 running=true;
 try{
  while(queue.length){
   const task=queue.shift();
   try{
    const value=await collectReferences(task.input,()=>cancelled.has(task.id),schedule);
    parentPort.postMessage({id:task.id,value:workerData.referencePayload?value:value.results});
   }catch(error){parentPort.postMessage({id:task.id,error:error.message,errorName:error.name});}
   finally{active.delete(task.id);cancelled.delete(task.id);}
  }
 }finally{running=false;}
}
parentPort.on("message",task=>{
 if(task.cancel){if(active.has(task.id))cancelled.add(task.id);return;}
 active.add(task.id);queue.push(task);void pump();
});
