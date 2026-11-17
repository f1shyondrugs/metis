// Synthetic isolated account and actual authenticated conversion route; no production data.
import fs from "node:fs";import os from "node:os";import path from "node:path";import http from "node:http";import {createRequire} from "node:module";
import postcss from "postcss";import tailwind from "@tailwindcss/postcss";import {importWorkerModule} from "../lib/worker-module.mjs";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-document-ui-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:process.cwd(),CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root});
const[auth,store,notes,api]=await Promise.all(["../lib/auth.ts","../lib/db-store.ts","../lib/shared-context.ts","../app/api/documents/convert/route.ts"].map(p=>importWorkerModule(p)));
const owner=auth.createUser("document-fixture","SYNTHETIC-LOCAL-ONLY").id,token=auth.authenticateUser("document-fixture","SYNTHETIC-LOCAL-ONLY").token;
const chat=store.createChat("Document fixture",undefined,owner);const now=new Date().toISOString();
store.updateChat(chat.id,{workspaces:["canvas","plan"].map(type=>({id:type+"-source",type,name:type+" original",content:"# Editable document\n\nKeep this text.",createdAt:now,updatedAt:now,version:1}))},owner);
const note=notes.createNote({ownerId:owner,title:"Note original",content:"# Editable document\n\nKeep this text.",icon:"lucide:file-text"});
const output=path.resolve("output/document-conversion-ui");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/document-conversion.browser.tsx"],outdir:output,entryNames:"app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1:3277");
 if(url.pathname==="/api/fixture"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({owner,chatId:chat.id,noteId:note.id}));return;}
 if(url.pathname==="/api/documents/convert"){
  let body="";for await(const part of req)body+=part;
  const response=await api.POST(new Request("http://127.0.0.1:3277/api/documents/convert",{method:"POST",headers:{"Content-Type":"application/json",origin:req.headers.origin||"http://127.0.0.1:3277",cookie:"ai_chat_auth="+token},body}));
  res.writeHead(response.status,{"Content-Type":"application/json"});res.end(await response.text());return;
 }
 if(url.pathname==="/report"&&req.method==="POST"){let body="";for await(const part of req)body+=part;const report=JSON.parse(body);fs.writeFileSync(output+"/result-"+report.width+".json",JSON.stringify(report,null,2));console.log("DOCUMENT_UI_RESULT",report.width,report.results.filter(x=>x.startsWith("FAIL")));res.end("saved");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document actions fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname),file=path.join(output,name);if(!/^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.setHeader("Cache-Control","no-store");res.end(fs.readFileSync(file));
});
server.listen(3277,"127.0.0.1",()=>console.log("DOCUMENT_FIXTURE_READY"));
process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit(0);}));
