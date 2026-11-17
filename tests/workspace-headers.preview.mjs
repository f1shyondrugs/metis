import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import {workspaceHeadersSource} from "./workspace-headers-harness.mjs";
const output=path.resolve("output/workspace-headers");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({stdin:{contents:workspaceHeadersSource()+'\nimport {runHeaderFixture} from "./tests/workspace-headers.browser";runHeaderFixture({AccountHeader,CalendarHeader,PrimaryHeader});',loader:"tsx",resolveDir:process.cwd()},outfile:output+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1:3283");
 if(url.pathname==="/report"&&req.method==="POST"){let body="";for await(const b of req)body+=b;const r=JSON.parse(body);fs.writeFileSync(output+"/result-"+r.width+".json",JSON.stringify(r,null,2));res.end("saved");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compact workspace headers – isolated preview</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname);if(!["app.js","theme.css"].includes(name)){res.writeHead(404).end();return;}res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(path.join(output,name)));
});
server.listen(3283,"127.0.0.1",()=>console.log("WORKSPACE_HEADERS_FIXTURE_READY"));process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
