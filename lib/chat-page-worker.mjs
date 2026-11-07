// Source entrypoint deliberately remains ESM in source installs and production builds.
import { parentPort, workerData } from "node:worker_threads";
import {importWorkerModule} from "./worker-module.mjs";
process.env.CHAT_DB_PATH=workerData.databasePath;
const { run }=await importWorkerModule("./chat-page-worker.ts");
let pending=Promise.resolve();
parentPort.on("message",task=>{
 pending=pending.then(async()=>{
  try { const value=await run(task);parentPort.postMessage({id:task.id,value}); }
  catch(error){parentPort.postMessage({id:task.id,error:String(error.message || error),errorName:error.name});}
 });
});
parentPort.postMessage({ready:true});
