// Source entrypoint deliberately remains ESM in source installs and production builds.
import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
process.env.CHAT_DB_PATH=workerData.databasePath;
const { run }=await tsImport("./chat-page-worker.ts",import.meta.url);
let pending=Promise.resolve();
parentPort.on("message",task=>{
 pending=pending.then(async()=>{
  try { const value=await run(task);parentPort.postMessage({id:task.id,value}); }
  catch(error){parentPort.postMessage({id:task.id,error:String(error.message || error),errorName:error.name});}
 });
});
parentPort.postMessage({ready:true});
