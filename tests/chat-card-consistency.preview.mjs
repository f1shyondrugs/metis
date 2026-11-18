// Synthetic display-only fixture: no production accounts, database or credentials.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const output=path.resolve("output/chat-card-consistency");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/chat-card-consistency.browser.tsx"],outfile:output+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",loader:{".woff":"file",".woff2":"file",".ttf":"file"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const app='<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat card consistency fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://fixture");
 if(url.pathname==="/api/internal-link-preview"){
  res.setHeader("Content-Type","application/json");
  const id=url.searchParams.get("id");
  if(id==="test"){res.end(JSON.stringify({icon:"lucide:file-text",title:"Test",description:"",details:[]}));return;}
  res.end(JSON.stringify({kind:"calendar-event",id,title:"Testevent",description:"Testtermin für den Kalenderlink.",color:"#b14bc9",details:[{label:"Calendar",value:"Erinnerungen"},{label:"Start",value:"17 Nov 2026"},{label:"End (exclusive)",value:"18 Nov 2026"},{label:"Time zone",value:"All day"}]}));return;
 }
 if(url.pathname==="/report"&&req.method==="POST"){let body="";for await(const chunk of req)body+=chunk;const report=JSON.parse(body);fs.writeFileSync(output+"/result-"+report.width+"-"+(report.theme||"dark")+".json",JSON.stringify(report,null,2));res.end("saved");return;}
 if(url.pathname==="/"){const width=Number(url.searchParams.get("width")||1440),theme=url.searchParams.get("theme")==="light"?"light":"dark";if(![390,768,1440].includes(width)){res.writeHead(400).end();return;}res.setHeader("Content-Type","text/html");res.end('<html><style>body{margin:0;background:#141414}iframe{width:'+width+'px;max-width:100%;height:1900px;display:block;margin:auto;border:0}</style><iframe src="/app.html?theme='+theme+'"></iframe></html>');return;}
 if(url.pathname==="/app.html"){res.setHeader("Content-Type","text/html");res.end(app);return;}
 const name=path.basename(url.pathname);if(!/^(?:app\.(?:js|css)|theme\.css|[^/]+\.(?:woff2?|ttf))$/.test(name)){res.writeHead(404).end();return;}
 const file=path.join(output,name);if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"application/octet-stream");res.end(fs.readFileSync(file));
});
server.listen(3294,"127.0.0.1",()=>console.log("CHAT_CARD_FIXTURE_READY"));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
