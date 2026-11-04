import { parentPort,workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
import { register as registerCjs } from "tsx/cjs/api";
import { fileURLToPath } from "node:url";
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
registerCjs({tsconfig});
register({tsconfig});
process.env.CHAT_DB_PATH=workerData.databasePath;
const {getDatabase}=await import("./sqlite.ts");
const {initializeReferenceIndex,prepareReferenceIndex,prepareReferenceMetadata,referenceVersion}=await import("./reference-file-index.ts");
const db=getDatabase();initializeReferenceIndex(db);
const metadata=new Map(),files=new Map();
let running=false,timer;
async function pump(){
 if(running)return;
 running=true;
 try{
  while(metadata.size || files.size){
   const isMetadata=metadata.size>0,queue=isMetadata?metadata:files;
   const [chatId,title]=queue.entries().next().value;
   try{
    if(isMetadata)await prepareReferenceMetadata(db,chatId);
    else await prepareReferenceIndex(db,chatId,title);
   }catch(error){parentPort.postMessage({error:String(error.message)});}
   queue.delete(chatId);
   await new Promise(resolve=>setImmediate(resolve));
  }
 }finally{running=false;}
}
parentPort.on("message",({chatId,title})=>{
 const version=referenceVersion(db,chatId);
 if(!version)return;
 if(db.prepare("SELECT version FROM chat_reference_metadata WHERE chat_id=?").get(chatId)?.version!==version)metadata.set(chatId,title);
 if(db.prepare("SELECT version FROM chat_reference_state WHERE chat_id=?").get(chatId)?.version!==version)files.set(chatId,title);
 if(!timer)timer=setTimeout(()=>{timer=undefined;void pump();},100);
});
