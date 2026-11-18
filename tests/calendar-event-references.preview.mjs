// Isolated synthetic account only; no production data or credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import {calendarNavigationHarnessSource} from "./calendar-navigation-harness.mjs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import {importWorkerModule} from "../lib/worker-module.mjs";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-mentions-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:process.cwd(),CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root});
const [auth,store,notes,references,previews]=await Promise.all(["../lib/auth.ts","../lib/db-store.ts","../lib/shared-context.ts","../app/api/references/route.ts","../app/api/internal-link-preview/route.ts"].map(file=>importWorkerModule(file)));
const owner=auth.createUser("mention-fixture","SYNTHETIC-LOCAL-ONLY").id,token=auth.authenticateUser("mention-fixture","SYNTHETIC-LOCAL-ONLY").token;
const chat=store.createChat("Mathe course",undefined,owner);store.saveChat(chat);
notes.createNote({ownerId:owner,title:"Exam notes",content:"Exam preparation content",icon:"lucide:calculator"});
const calendar=await importWorkerModule("../lib/calendar/store.ts"),calendarApi=await importWorkerModule("../app/api/calendar/route.ts");
const group=calendar.ensureCalendar(owner,"Synthetic work","#12a456");
const today=new Date().toISOString().slice(0,10);
const saved=calendar.saveCalendarEvent(owner,{calendarId:group.id,title:"Project planning",start:today+"T10:00:00Z",end:today+"T11:00:00Z",timeZone:"UTC",location:"Meeting room",description:"Discuss the project"});
const series=calendar.saveCalendarEvent(owner,{calendarId:group.id,title:"Weekly review",start:"2026-01-01T15:00:00Z",end:"2026-01-01T16:00:00Z",timeZone:"UTC",recurrence:"FREQ=WEEKLY",location:"Online"});
const output=path.resolve("output/calendar-event-ui");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({stdin:{contents:calendarNavigationHarnessSource()+'\nimport {runCalendarEventFixture} from "./tests/calendar-event-references.browser";runCalendarEventFixture(createCalendarNavigationHarness);',loader:"tsx",resolveDir:process.cwd()},outfile:output+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",loader:{".woff":"file",".woff2":"file",".ttf":"file"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const app='<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mention links fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://fixture");
 if(url.pathname==="/api/chats/fixture/tool-result"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({result:JSON.stringify({event:{id:saved.id}})}));return;}
 if(url.pathname==="/fixture"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({event:{id:saved.id,title:saved.title},series:{id:series.id,title:series.title}}));return;}
 if(url.pathname==="/api/calendar"||url.pathname==="/api/references"||url.pathname==="/api/internal-link-preview"){
  try{const response=await(url.pathname==="/api/calendar"?calendarApi:url.pathname==="/api/references"?references:previews).GET(new Request("http://fixture"+req.url,{headers:{cookie:"ai_chat_auth="+token}}));res.writeHead(response.status,{"Content-Type":"application/json"});res.end(await response.text());}catch{res.writeHead(500).end("{}");}return;
 }
 if(url.pathname==="/report"&&req.method==="POST"){let body="";for await(const chunk of req)body+=chunk;const report=JSON.parse(body);fs.writeFileSync(output+"/result-"+report.width+".json",JSON.stringify(report,null,2));res.end("saved");return;}
 if(url.pathname==="/"){const width=Number(url.searchParams.get("width")||1440);if(![390,768,1440].includes(width)){res.writeHead(400).end();return;}res.setHeader("Content-Type","text/html");res.end('<html><style>body{margin:0;background:#111}iframe{width:'+width+'px;height:1000px;display:block;margin:auto;border:0}</style><iframe src="/app.html"></iframe></html>');return;}
 if(url.pathname==="/app.html"){res.setHeader("Content-Type","text/html");res.end(app);return;}
 const name=path.basename(url.pathname);if(!/^(?:app\.(?:js|css)|theme\.css|[^/]+\.(?:woff2?|ttf))$/.test(name)){res.writeHead(404).end();return;}
 const file=path.join(output,name);if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"application/octet-stream");res.end(fs.readFileSync(file));
});
server.listen(3267,"127.0.0.1",()=>console.log("CALENDAR_EVENT_FIXTURE_READY"));
process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit(0);}));
