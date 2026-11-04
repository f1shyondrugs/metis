import {parentPort,workerData} from "node:worker_threads";
import {register} from "tsx/esm/api";
import {register as registerCjs} from "tsx/cjs/api";
import {fileURLToPath} from "node:url";
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
// Keep one module graph within this already isolated worker.
registerCjs({tsconfig});
register({tsconfig});
process.env.CHAT_DB_PATH=workerData.databasePath;
const {initialize,writePresence}=await import("./remote-presence-worker.ts");
initialize();
parentPort.on("message",updates=>{
 try{writePresence(updates);parentPort.postMessage({sequences:updates.map(update=>update.sequence),ok:true});}
 catch{parentPort.postMessage({sequences:[],ok:false});}
});
