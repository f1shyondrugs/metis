import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const out="output/notification-details";
fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/notification-details.browser.tsx"],tsconfig:"tsconfig.json",outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});
fs.writeFileSync(out+"/theme.css",css.css);
const page='<!doctype html><html class="dark" lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notification details fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end(page);return;}
  if(url.pathname==="/matrix"){
    res.setHeader("Content-Type","text/html");
    res.end(`<!doctype html><title>Notification settings matrix</title>${[390,768,1440].map(w=>'<iframe title="Notification settings at '+w+'px" width="'+w+'" height="550" src="/?verify=1"></iframe>').join("")}`);return;
  }
  if(url.pathname==="/report" && req.method==="POST"){
    let body="";req.on("data",chunk=>{body+=chunk;if(body.length>16384)req.destroy();});
    req.on("end",()=>{try {
      const data=JSON.parse(body);
      if(![390,768,1440].includes(data.width)||!Array.isArray(data.results)){res.writeHead(400).end();return;}
      fs.writeFileSync(out+"/report-"+data.width+".json",JSON.stringify(data,null,2));
      res.end("saved");
    } catch {res.writeHead(400).end();}});return;
  }
  if(["/app.js","/theme.css"].includes(url.pathname)){
    res.setHeader("Content-Type",url.pathname.endsWith(".js")?"text/javascript":"text/css");
    res.end(fs.readFileSync(out+url.pathname));return;
  }
  res.writeHead(404).end();
}).listen(Number(process.env.FIXTURE_PORT || 3301),"127.0.0.1",()=>console.log("NOTIFICATION_DETAILS_FIXTURE_READY"));
