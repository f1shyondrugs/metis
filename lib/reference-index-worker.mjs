import { parentPort,workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
process.env.CHAT_DB_PATH=workerData.databasePath;
const {getDatabase}=await tsImport("./sqlite.ts",import.meta.url);
const {initializeReferenceIndex,prepareReferenceIndex,prepareReferenceMetadata,referenceVersion}=await tsImport("./reference-file-index.ts",import.meta.url);
const db=getDatabase();initializeReferenceIndex(db);
const metadata=new Map(),files=new Map();
let running=false,timer,preferMetadata=true;
async function pump(){
 if(running)return;
 running=true;
 try{
  while(metadata.size || files.size){
   const isMetadata=metadata.size>0 && (!files.size || preferMetadata),queue=isMetadata?metadata:files;
   preferMetadata=!isMetadata;
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
parentPort.on("message",({chatId,title,part})=>{
 const version=referenceVersion(db,chatId);
 if(!version)return;
 if(part!=="files" && db.prepare("SELECT version FROM chat_reference_metadata WHERE chat_id=?").get(chatId)?.version!==version)metadata.set(chatId,title);
 if(part!=="metadata" && db.prepare("SELECT version FROM chat_reference_state WHERE chat_id=?").get(chatId)?.version!==version)files.set(chatId,title);
 if(!timer)timer=setTimeout(()=>{timer=undefined;void pump();},100);
});
