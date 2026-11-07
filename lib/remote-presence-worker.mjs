import {parentPort,workerData} from "node:worker_threads";
import {importWorkerModule} from "./worker-module.mjs";
process.env.CHAT_DB_PATH=workerData.databasePath;
const {initialize,writePresence}=await importWorkerModule("./remote-presence-worker.ts");
initialize();
parentPort.on("message",updates=>{
 try{writePresence(updates);parentPort.postMessage({sequences:updates.map(update=>update.sequence),ok:true});}
 catch{parentPort.postMessage({sequences:[],ok:false});}
});
