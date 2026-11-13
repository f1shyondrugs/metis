// Real authenticated assistant-session API behind a simulated proxy; synthetic data only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import {importWorkerModule} from "../lib/worker-module.mjs";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"metis-assistant-origin-"));
Object.assign(process.env,{AI_CHAT_ROOT:directory,AI_CHAT_INSTALL_DIR:process.cwd(),CHAT_DATA_DIR:directory,CHAT_DB_PATH:path.join(directory,"chat.sqlite"),AGENT_CWD:directory,AI_CHAT_PUBLIC_URL:"http://127.0.0.1:3267"});
const [auth,store,remote,api,sessions]=await Promise.all(["../lib/auth.ts","../lib/db-store.ts","../lib/remote-clients.ts","../app/api/desktop-assistant/session/route.ts","../lib/desktop-assistant-session-store.ts"].map(file=>importWorkerModule(file)));
const owner=auth.createUser("assistant-origin-fixture","SYNTHETIC-LOCAL-ONLY").id,token=auth.authenticateUser("assistant-origin-fixture","SYNTHETIC-LOCAL-ONLY").token;
const enrolled=remote.createEnrollmentToken(owner),registered=remote.registerRemoteClient(enrolled.token,{name:"Fixture PC",hostname:"fixture",os:"windows",architecture:"x64",version:"fixture"});
const deviceId=registered.client.id,chat=store.createChat("Synthetic assistant",undefined,owner);
let legacy=true;
const output=path.resolve("output/assistant-origin-ui");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/desktop-assistant.browser.tsx"],outfile:output+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",loader:{".woff":"file",".woff2":"file",".ttf":"file"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
await build({entryPoints:["tests/desktop-assistant-queue.browser.tsx"],outfile:output+"/queue.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",loader:{".woff":"file",".woff2":"file",".ttf":"file"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const app='<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Assistant origin fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body style="background:#18181b"><div id="root"></div><script>window.addEventListener("error",event=>{fetch("/browser-error",{method:"POST",body:String(event.message)+"\\n"+String(event.error?.stack||"")});});window.fixtureDeviceId='+JSON.stringify(deviceId)+';window.fixtureChatId='+JSON.stringify(chat.id)+';</script><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://fixture");
 if(url.pathname==="/queue"){const width=Number(url.searchParams.get("width")||1440);if(![390,768,1440].includes(width)){res.writeHead(400).end();return;}res.setHeader("Content-Type","text/html");res.end('<html><style>body{margin:0;background:#111}iframe{width:'+width+'px;height:900px;display:block;margin:auto;border:0}</style><iframe src="/queue-app.html"></iframe></html>');return;}
 if(url.pathname==="/queue-app.html"){res.setHeader("Content-Type","text/html");res.end(app.replaceAll("/app.css","/queue.css").replaceAll("/app.js","/queue.js"));return;}
 if(url.pathname==="/api/desktop-assistant/session"){
  const headers={"Content-Type":"application/json",cookie:"ai_chat_auth="+token,...(req.headers.origin?{origin:req.headers.origin}:{})};
  let body="";if(req.method==="PUT")for await(const chunk of req)body+=chunk;
  const internal=new Request("http://internal.invalid:3100"+req.url,{method:req.method,headers,...(body?{body}:{})});
  const response=req.method==="PUT"&&legacy?Response.json({error:"Invalid origin."},{status:403}):await(req.method==="PUT"?api.PUT(internal):api.GET(internal));
  res.writeHead(response.status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(await response.text());return;
 }
 if(url.pathname==="/enable-origin-fix"&&req.method==="POST"){legacy=false;res.end("enabled");return;}
 if(url.pathname==="/browser-error"&&req.method==="POST"){let message="";for await(const chunk of req)message+=chunk;fs.writeFileSync(output+"/browser-error.log",message.slice(0,12000));res.end("saved");return;}
 if(url.pathname==="/result"&&req.method==="POST"){let body="";for await(const chunk of req)body+=chunk;const value=JSON.parse(body);fs.writeFileSync(output+"/result-"+value.mode+"-"+value.width+".json",JSON.stringify(value,null,2));res.end("saved");return;}
 if(url.pathname==="/"){const width=Number(url.searchParams.get("width")||1440),mode=url.searchParams.get("mode")||"origin";if(![390,768,1440].includes(width)||!["origin","text","error","queue","options","tools","voice","voice-edit","realtime","realtime-edit","delayed-edit","permission","models-pending"].includes(mode)){res.writeHead(400).end();return;}res.setHeader("Content-Type","text/html");res.end('<html><style>body{margin:0;background:#111}iframe{width:'+width+'px;height:900px;display:block;margin:auto;border:0}</style><iframe src="/app.html?mode='+mode+'"></iframe></html>');return;}
 if(url.pathname==="/app.html"){legacy=true;const current=sessions.getAssistantSession(owner,deviceId);sessions.saveAssistantSession(owner,deviceId,current.version,{chatId:null,draftText:"",clearContext:true});res.setHeader("Content-Type","text/html");res.end(app);return;}
 const name=path.basename(url.pathname);if(!/^(?:(?:app|queue)\.(?:js|css)|theme\.css|[^/]+\.(?:woff2?|ttf))$/.test(name)){res.writeHead(404).end();return;}const file=path.join(output,name);if(!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"application/octet-stream");res.end(fs.readFileSync(file));
});
server.listen(3267,"127.0.0.1",()=>console.log("ASSISTANT_ORIGIN_FIXTURE_READY"));
process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(directory,{recursive:true,force:true});process.exit(0);}));
