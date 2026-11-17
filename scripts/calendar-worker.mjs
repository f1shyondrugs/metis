// Dedicated native calendar polling; no MCP process, agent run or browser session required.
import {parentPort} from "node:worker_threads";
import {importWorkerModule} from "../lib/worker-module.mjs";
const calendar=await importWorkerModule("./calendar/sync.ts");
parentPort?.postMessage({type:"ready"});
let stopped=false;process.on("SIGTERM",()=>{stopped=true;});
while(!stopped){try{await calendar.syncAllCalendarAccounts();}catch{process.stderr.write("Calendar background sync failed; retrying later.\n");}for(let i=0;i<30&&!stopped;i++)await new Promise(r=>setTimeout(r,1000));}
