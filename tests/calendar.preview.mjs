// Isolated real Calendar API/UI with a synthetic account. No production or external calendar calls.
import fs from "node:fs";import os from "node:os";import path from "node:path";import http from "node:http";import {createRequire} from "node:module";
import postcss from "postcss";import tailwind from "@tailwindcss/postcss";import {importWorkerModule} from "../lib/worker-module.mjs";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"metis-calendar-ui-"));
Object.assign(process.env,{AI_CHAT_ROOT:temp,CHAT_DATA_DIR:temp,CHAT_DB_PATH:path.join(temp,"chat.sqlite"),PORT:"3282",AI_CHAT_SECRETS_KEY:Buffer.alloc(32,8).toString("hex")});
const auth=await importWorkerModule("./auth.ts"),store=await importWorkerModule("./calendar/store.ts"),api=await importWorkerModule("../app/api/calendar/route.ts");
const user=auth.createUser("calendar-preview","SYNTHETIC-LOCAL-ONLY"),token=auth.authenticateUser("calendar-preview","SYNTHETIC-LOCAL-ONLY").token;
const privateCalendar=store.ensureCalendar(user.id,"Privat","#6387cc"),workCalendar=store.ensureCalendar(user.id,"Work","#bc8b5e");
const now=new Date(),date=now.toISOString().slice(0,10);
store.saveCalendarEvent(user.id,{calendarId:privateCalendar.id,title:"Design review",start:date+"T10:00:00Z",end:date+"T11:00:00Z",timeZone:"UTC"});
store.saveCalendarEvent(user.id,{calendarId:workCalendar.id,title:"Focus time",start:date+"T13:00:00Z",end:date+"T14:30:00Z",timeZone:"UTC",recurrence:"FREQ=WEEKLY"});
const output=path.resolve("output/calendar-ui");fs.mkdirSync(output,{recursive:true});for(const width of [390,768,1440]){const file=path.join(output,"result-"+width+".json");if(fs.existsSync(file))fs.unlinkSync(file);}
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/calendar.browser.tsx"],outdir:output,entryNames:"app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1:3282");
 if(url.pathname==="/api/calendar"){
  const headers={"content-type":"application/json",origin:"http://127.0.0.1:3282",cookie:"ai_chat_auth="+token};let body="";for await(const part of req)body+=part;
  const request=new Request(url,{method:req.method,headers,...(req.method==="POST"?{body}:{})});
  const response=await api[req.method==="POST"?"POST":"GET"](request);res.writeHead(response.status,{"Content-Type":"application/json"});res.end(await response.text());return;
 }
 if(url.pathname==="/report"&&req.method==="POST"){let b="";for await(const part of req)b+=part;const r=JSON.parse(b);fs.writeFileSync(output+"/result-"+r.width+".json",JSON.stringify(r,null,2));res.end("saved");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metis Calendar test</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname),file=path.join(output,name);if(!/^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.setHeader("Cache-Control","no-store");res.end(fs.readFileSync(file));
});
server.listen(3282,"127.0.0.1",()=>console.log("CALENDAR_FIXTURE_READY"));process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(temp,{recursive:true,force:true});process.exit(0);}));
