import fs from "node:fs";import os from "node:os";import path from "node:path";import http from "node:http";import {createRequire} from "node:module";
import postcss from "postcss";import tailwind from "@tailwindcss/postcss";import {importWorkerModule} from "../lib/worker-module.mjs";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"metis-notebook-links-ui-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:process.cwd(),CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,AI_CHAT_SECRETS_KEY:Buffer.alloc(32,4).toString("hex")});
const [auth,notes,sharing,privatePreview,publicNotes]=await Promise.all(["./auth.ts","./shared-context.ts","./note-sharing.ts","../app/api/internal-link-preview/route.ts","../app/api/shared-notes/[token]/route.ts"].map(p=>importWorkerModule(p)));
const user=auth.createUser("notebook-links-preview","SYNTHETIC-LOCAL-ONLY"),session=auth.authenticateUser(user.username,"SYNTHETIC-LOCAL-ONLY").token;
const note=notes.createNote({ownerId:user.id,title:"Synthetic private note",content:"Private preview from the actual authenticated API."});
const shared=notes.createNote({ownerId:user.id,title:"Shared root preview",content:"A share-scoped notebook summary.",icon:"lucide:book-open"});
const publicLink=sharing.createNoteShare(shared.id,user.id);
const locked=notes.createNote({ownerId:user.id,title:"LOCKED_SECRET_TITLE",content:"LOCKED_SECRET_CONTENT"}),lockedLink=sharing.createNoteShare(locked.id,user.id);sharing.updateNoteShare(locked.id,user.id,{password:"SYNTHETIC-LOCK-ONLY"});
const expired=notes.createNote({ownerId:user.id,title:"Expired title",content:"expired"}),expiredLink=sharing.createNoteShare(expired.id,user.id);sharing.revokeNoteShare(expired.id,user.id);
const data={noteId:note.id,shareToken:publicLink.token,lockedToken:lockedLink.token,expiredToken:expiredLink.token};
const out=path.resolve("output/notebook-links");fs.mkdirSync(out,{recursive:true});const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/notebook-links.browser.tsx"],outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(out+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,"http://127.0.0.1:3283");
 if(url.pathname==="/fixture.json"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));return;}
 if(url.pathname==="/api/internal-link-preview"||url.pathname.startsWith("/api/shared-notes/")){
  const request=new Request(url,{headers:url.pathname==="/api/internal-link-preview"?{cookie:"ai_chat_auth="+session}:{}});
  const response=url.pathname==="/api/internal-link-preview"?await privatePreview.GET(request):await publicNotes.GET(request,{params:Promise.resolve({token:url.pathname.split("/").at(-1)})});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
 }
 if(url.pathname==="/api/link-preview"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({title:"Example website",description:"Synthetic web metadata; no external network."}));return;}
 if(url.pathname==="/report"&&req.method==="POST"){let b="";for await(const v of req)b+=v;const r=JSON.parse(b);fs.writeFileSync(out+"/result-"+r.width+".json",JSON.stringify(r,null,2));res.end("saved");return;}
 if(url.pathname==="/destination"){fs.writeFileSync(out+"/real-navigation.json",JSON.stringify({path:url.pathname,fetchMode:req.headers["sec-fetch-mode"],fetchDestination:req.headers["sec-fetch-dest"],method:req.method},null,2));res.setHeader("Content-Type","text/html");res.end("<title>Opened local link destination</title><h1>Local destination opened</h1>");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notebook link navigation – isolated fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script>addEventListener("error",e=>document.getElementById("root").textContent=e.message);</script><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname);if(!["app.js","theme.css","app.css"].includes(name)){res.writeHead(404).end();return;}res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(path.join(out,name)));
});server.listen(3283,"127.0.0.1",()=>console.log("NOTEBOOK_LINKS_FIXTURE_READY"));process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit(0);}));
