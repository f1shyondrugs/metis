import assert from "node:assert/strict";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,readFile,rm,readdir} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createRuntimePerformance,instrumentDatabase,startRuntimePerformance} from "../lib/runtime-performance";
const key=Symbol.for("metis.runtime-performance"),globals=globalThis as typeof globalThis & {[key]?:ReturnType<typeof createRuntimePerformance>|null};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
test("disabled instrumentation preserves the native database object",()=>{
 delete globals[key];const db=new DatabaseSync(":memory:");
 try{assert.equal(instrumentDatabase(db),db);assert.equal(startRuntimePerformance(),null);}finally{db.close();delete globals[key];}
});
test("native SQLite methods, errors and iterators retain behavior; saved diagnostics contain no SQL or bound data",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"metis-perf-")),old={until:process.env.METIS_PERFORMANCE_UNTIL,output:process.env.METIS_PERFORMANCE_OUTPUT_DIR};
 Object.assign(process.env,{METIS_PERFORMANCE_UNTIL:String(Date.now()+5000),METIS_PERFORMANCE_OUTPUT_DIR:dir});delete globals[key];
 const raw=new DatabaseSync(path.join(dir,"fixture.sqlite")),db=instrumentDatabase(raw);let other:DatabaseSync|undefined;
 try{
  await pause(25);db.exec("CREATE TABLE private_table(value TEXT)");db.prepare("INSERT INTO private_table VALUES (?)").run("sensitive-marker-0x");
  assert.equal((db.prepare("SELECT * FROM private_table").get() as {value:string}).value,"sensitive-marker-0x");
  assert.equal(db.prepare("SELECT * FROM private_table").all().length,1);
  assert.equal([...db.prepare("SELECT * FROM private_table").iterate()].length,1);
  for(const row of db.prepare("SELECT * FROM private_table").iterate()){assert(row);break;}
  other=new DatabaseSync(path.join(dir,"fixture.sqlite"));other.exec("BEGIN IMMEDIATE");db.exec("PRAGMA busy_timeout=30");
  assert.throws(()=>db.prepare("INSERT INTO private_table VALUES (?)").run("not-recorded"),/locked/);other.exec("ROLLBACK");
  await pause(30);const sample=startRuntimePerformance()!;await sample.finish();
  const file=(await readdir(dir)).find(name=>name.endsWith(".json"))!,text=await readFile(path.join(dir,file),"utf8"),report=JSON.parse(text);
  assert(report.database.get.calls>=1);assert(report.database.run.busyErrors>=1);assert(report.database.run.maxMs>=20);assert(report.database["iterate.next"].calls>=2);assert(report.eventLoop.delaySamples>0);
  assert(!text.includes("private_table")&&!text.includes("sensitive-marker")&&!text.includes("SELECT"));
  const before=JSON.stringify(sample.snapshot().database);db.prepare("SELECT 1").get();assert.equal(JSON.stringify(sample.snapshot().database),before);
 }finally{other?.close();db.close();delete globals[key];for(const [name,value]of [["METIS_PERFORMANCE_UNTIL",old.until],["METIS_PERFORMANCE_OUTPUT_DIR",old.output]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}await rm(dir,{recursive:true,force:true});}
});
test("a delayed bounded sample ignores startup work and automatically stops",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"metis-perf-window-")),sample=createRuntimePerformance(Date.now()+100,dir,Date.now()+30);
 try{
  sample.measure("get",()=>42);await pause(45);sample.measure("get",()=>42);await pause(90);await sample.finish();
  assert.equal(sample.snapshot().database.get.calls,1);
  sample.measure("get",()=>42);assert.equal(sample.snapshot().database.get.calls,1);
 }finally{await sample.finish();await rm(dir,{recursive:true,force:true});}
});
