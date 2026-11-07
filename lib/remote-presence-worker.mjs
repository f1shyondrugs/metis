import {parentPort,workerData} from "node:worker_threads";
import {tsImport} from "tsx/esm/api";
import {fileURLToPath} from "node:url";
import {register} from "tsx/cjs/api";
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
register({tsconfig});
process.env.CHAT_DB_PATH=workerData.databasePath;
const {initialize,writePresence}=await tsImport("./remote-presence-worker.ts",{parentURL:import.meta.url,tsconfig});
initialize();
parentPort.on("message",updates=>{
 try{writePresence(updates);parentPort.postMessage({sequences:updates.map(update=>update.sequence),ok:true});}
 catch{parentPort.postMessage({sequences:[],ok:false});}
});
