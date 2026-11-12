import fs from "node:fs";import path from "node:path";import http from "node:http";import os from "node:os";import {createRequire} from "node:module";import postcss from "postcss";import tailwind from "@tailwindcss/postcss";import {importWorkerModule} from "../lib/worker-module.mjs";
const data=fs.mkdtempSync(path.join(os.tmpdir(),"metis-passkey-ui-"));
Object.assign(process.env,{AI_CHAT_ROOT:data,CHAT_DATA_DIR:data,CHAT_DB_PATH:path.join(data,"chat.sqlite"),AI_CHAT_INSTALL_DIR:process.cwd(),AI_CHAT_PUBLIC_URL:"http://localhost:3283",AGENT_CWD:data});
const auth=await importWorkerModule("../lib/auth.ts"),pk=await importWorkerModule("../lib/passkeys.ts"),login=await importWorkerModule("../app/api/auth/route.ts");
auth.createUser("synthetic-demo","Synthetic-local-test-only-2026");
const session=auth.authenticateUser("synthetic-demo","Synthetic-local-test-only-2026");
const out="data/artifacts/assistant-passkeys-20261112/browser";fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/assistant-passkeys.browser.tsx"],outdir:out,entryNames:"app",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff": "dataurl",".woff2":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(out+"/theme.css",css.css);
const app='<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metis UI verification</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost:3283");let body="";for await(const part of req){body+=part;if(body.length>40000){res.writeHead(413).end();return;}}
  if(url.pathname==="/fixture/sign-in"){res.setHeader("Set-Cookie","ai_chat_auth="+session.token+"; Path=/; HttpOnly; SameSite=Lax");res.end("ready");return;}
  if(url.pathname==="/fixture/session"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({authenticated:!!(await auth.getAuthenticatedUser(new Request(url,{headers:req.headers})))}));return;}
  if(url.pathname.startsWith("/api/")){
   const request=new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{} )});
   const response=url.pathname==="/api/auth"?await login.POST(request):await pk.passkeyRequest(request,url.pathname.slice("/api/passkeys/".length));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  if(url.pathname==="/metis-wordmark.svg"){res.setHeader("Content-Type","image/svg+xml");res.end(fs.readFileSync("public/metis-wordmark.svg"));return;}
  if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end(app);return;}
  const name=path.basename(url.pathname);if(!["app.js","app.css","theme.css"].includes(name)){res.writeHead(404).end();return;}
  res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(out+"/"+name));
 }catch(e){console.error(e);res.writeHead(500).end("Fixture error");}
});
server.listen(3283,"127.0.0.1",()=>console.log("PASSKEY_UI_FIXTURE_READY"));
process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(data,{recursive:true,force:true});process.exit(0);}));
