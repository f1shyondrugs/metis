import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Worker} from "node:worker_threads";
test("native calendar worker loads its real module graph and initializes sync without MCP",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-worker-"));
 const worker=new Worker(new URL("../scripts/calendar-worker.mjs",import.meta.url),{execArgv:[],env:{...process.env,AI_CHAT_ROOT:process.cwd(),CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,2).toString("hex")},stdout:true,stderr:true});
 let errors="";worker.stderr.on("data",v=>{errors+=String(v);});
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Calendar worker did not initialize")),15000);worker.once("message",m=>{clearTimeout(timer);if(m?.type==="ready")resolve();else reject(Error("Invalid worker handshake"));});worker.once("error",e=>{clearTimeout(timer);reject(e);});});
  await new Promise(r=>setTimeout(r,500));assert.doesNotMatch(errors,/sync failed|Error:|Cannot find/i);assert.ok(fs.existsSync(path.join(dir,"chat.sqlite")));
 }finally{await worker.terminate();fs.rmSync(dir,{recursive:true,force:true});}
});
