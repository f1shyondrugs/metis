/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic isolated database must be selected before imports. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-production-"));
 const port=await new Promise<number>(resolve=>{const server=net.createServer();server.listen(0,"127.0.0.1",()=>{const p=(server.address() as net.AddressInfo).port;server.close(()=>resolve(p));});});
 const url="http://127.0.0.1:"+port;
 const env={...process.env,AI_CHAT_ROOT:process.cwd(),AI_CHAT_SERVER_SOURCE_DIR:process.cwd(),AI_CHAT_INSTALL_DIR:"/legacy-install-must-not-load",AI_CHAT_PUBLIC_URL:url,AI_CHAT_INTERNAL_ORIGIN:url,PORT:String(port),CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"test.sqlite"),AI_CHAT_SECRETS_KEY:Buffer.alloc(32,4).toString("hex"),METIS_CALENDAR_SYNC_DISABLED:"1",NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||".next-b"};
 Object.assign(process.env,env);
 const auth=require("../lib/auth") as typeof import("../lib/auth");
 const store=require("../lib/calendar/store") as typeof import("../lib/calendar/store");
 const owner=auth.createUser("production-calendar-test","Synthetic-Production-Calendar").id;
 const token=auth.authenticateUser("production-calendar-test","Synthetic-Production-Calendar")!.token;
 const calendar=store.ensureCalendar(owner);
 const child=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});
 let output="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);
 try{
  let ready=false;
  for(let i=0;i<150;i++){try{const r=await fetch(url+"/api/calendar");if(r.status===401){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,"Isolated production server did not start: "+output);
  const headers={cookie:"ai_chat_auth="+token,origin:url,"content-type":"application/json"};
  const event={calendarId:calendar.id,title:"Production DST and alarm regression",start:"2026-03-23T20:00:00+01:00",end:"2026-03-23T20:10:00+01:00",timeZone:"Europe/Berlin",recurrence:"FREQ=WEEKLY;BYDAY=MO;COUNT=3",reminderMinutes:[0],idempotencyKey:"production-regression"};
  const save=await fetch(url+"/api/calendar",{method:"POST",headers,body:JSON.stringify({action:"save",event})});
  const data=await save.json();assert.equal(save.status,201,JSON.stringify(data));
  assert.equal(data.event.timeZone,"Europe/Berlin");assert.deepEqual(data.event.reminderMinutes,[0]);
  const again=await fetch(url+"/api/calendar",{method:"POST",headers,body:JSON.stringify({action:"save",event})});
  assert.equal((await again.json()).event.id,data.event.id);
  const list=await fetch(url+"/api/calendar?start=2026-03-23T00:00:00Z&end=2026-04-07T00:00:00Z",{headers});
  assert.equal(list.status,200);
  const events=(await list.json()).events;
  assert.deepEqual(events.map((e:{start:string})=>e.start),["2026-03-23T19:00:00.000Z","2026-03-30T18:00:00.000Z","2026-04-06T18:00:00.000Z"]);
  assert.ok(events.every((e:{reminderMinutes:number[]})=>e.reminderMinutes[0]===0));
  const stored=store.getCalendarEvent(owner,data.event.id);
  assert.match(stored.ics,/BEGIN:VTIMEZONE/);assert.match(stored.ics,/ACTION:DISPLAY/);
  const search=await fetch(url+"/api/references?kind=calendar-event&q=Production",{headers});assert.equal(search.status,200);
  const found=(await search.json()).results;assert.equal(found[0]?.id,data.event.id);assert.equal(found[0]?.kind,"calendar-event");
  const preview=await fetch(url+"/api/internal-link-preview?kind=calendar-event&id="+data.event.id,{headers});assert.equal(preview.status,200);const projected=await preview.json();assert.equal(projected.title,event.title);assert.match(projected.color,/^#[a-f0-9]{6}$/i);
  const focused=await fetch(url+"/api/calendar?reference="+data.event.id+"&timeZone=Europe%2FBerlin",{headers});assert.equal(focused.status,200);assert.equal((await focused.json()).recurring,true);
  const autoResponse=await fetch(url+"/api/automations",{method:"POST",headers,body:JSON.stringify({name:"Production icon regression",prompt:"Synthetic fixture only",schedule:{kind:"interval",everyMinutes:1440},icon:"lucide:star:#30a070"})});assert.equal(autoResponse.status,201);const automation=(await autoResponse.json()).automation;assert.equal(automation.icon,"lucide:star:#30a070");
  const iconChange=await fetch(url+"/api/automations/"+automation.id,{method:"PATCH",headers,body:JSON.stringify({icon:"✅"})});assert.equal(iconChange.status,200);assert.equal((await iconChange.json()).automation.icon,"✅");
  const automationRefs=await fetch(url+"/api/references?kind=automation&q=Production",{headers});assert.equal(automationRefs.status,200);assert.equal((await automationRefs.json()).results[0]?.icon,"✅");
  console.log("AUTOMATION_ICON_PRODUCTION_OK: create; icon-only update; real worker metadata");
  console.log("CALENDAR_EVENT_REFERENCE_PRODUCTION_OK: real worker source pin; search; preview; event focus");
  console.log("CALENDAR_PRODUCTION_OK: Europe/Berlin; DST; start-time VALARM; idempotent create; authenticated HTTP 201/200");
 }finally{
  if(child.exitCode===null){const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGTERM");await exited;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
