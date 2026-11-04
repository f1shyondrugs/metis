import { parentPort,workerData,Worker } from "node:worker_threads";
import { register } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";
import { fileURLToPath } from "node:url";
// A worker has its own module graph; shared SQLite/config imports must resolve
// once in that graph, including when its parent already registered tsx.
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
registerCjs({tsconfig});
register({tsconfig});
process.env.CHAT_DB_PATH=workerData.databasePath;
const {collectReferences}=await import("./reference-search-engine.ts");
const {getDatabase}=await import("./sqlite.ts");
const {initializeReferenceIndex}=await import("./reference-file-index.ts");
initializeReferenceIndex(getDatabase());
const indexer=new Worker(new URL("./reference-index-worker.mjs",import.meta.url),{workerData,resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:16}});
indexer.on("error",error=>{throw error;});
indexer.on("message",()=>{});
const schedule=(chatId,title)=>indexer.postMessage({chatId,title});
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
