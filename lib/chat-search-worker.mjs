import {parentPort,workerData} from "node:worker_threads";
import {DatabaseSync} from "node:sqlite";
import {register} from "tsx/esm/api";
import {register as registerCjs} from "tsx/cjs/api";
import {fileURLToPath} from "node:url";
// This worker already owns an isolated module graph. Use one loader and one
// graph, rather than per-import namespaces that break inherited tsx hooks.
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
registerCjs({tsconfig});
register({tsconfig});
const {runSearch}=await import("./chat-search-engine.ts");
const db=new DatabaseSync(workerData.databasePath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;");
const cancelled=new Set(),active=new Set(),queue=[];
let running=false,background;
async function pump(){
 if(running)return;
 running=true;
 try{
  while(queue.length||background){
   const task=queue.shift()||background,isBackground=task.background===true;
   try{
    const value=await runSearch(db,task.query,task.ownerId,task.limit,task.related,
     ()=>cancelled.has(task.id)||(isBackground&&queue.length>0),task.includeNotes);
    if(!isBackground)parentPort.postMessage({id:task.id,value});
    // Continue the one-time preparation while the client displays the first
    // slice. New requests take priority at the next record boundary.
    background=value.indexing?{...task,background:true}:undefined;
   }catch(error){
    if(!isBackground)parentPort.postMessage({id:task.id,error:error.message,errorName:error.name});
    background=undefined;
   }finally{
    active.delete(task.id);cancelled.delete(task.id);
   }
   await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{running=false;}
}
parentPort.on("message",task=>{
 if(task.cancel){if(active.has(task.id)||background?.id===task.id)cancelled.add(task.id);return;}
 active.add(task.id);queue.push(task);void pump();
});
