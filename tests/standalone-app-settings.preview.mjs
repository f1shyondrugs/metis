import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const out=path.resolve("output/standalone-app-settings");fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/standalone-app-settings.browser.tsx"],tsconfig:"tsconfig.json",outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:path.resolve("app/globals.css")});
fs.writeFileSync(out+"/theme.css",css.css);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");
 const name=path.basename(url.pathname);
 if(name==="matrix"){
  res.setHeader("Content-Type","text/html");
  const widths=[390,768,1440,768];
  // Mount serially: focus assertions should never compete across frames.
  res.end(`<!doctype html><title>App settings fixture matrix</title><body><script>
   const widths=${JSON.stringify(widths)};let i=0;
   function next(){
    if(i>=widths.length)return;
    const frame=document.createElement("iframe"),n=i++;
    frame.width=widths[n];frame.height=900;
    frame.src="/?verify=1"+(n===3?"&web=1":"");
    frame.title="App settings at "+widths[n]+"px";
    document.body.append(frame);
    frame.onload=()=>{
     const timer=setInterval(()=>{
      if(frame.contentDocument?.body?.dataset.done==="true"){clearInterval(timer);next();}
     },100);
    };
   }
   next();
  </script>`);
  return;
 }
 if(name==="report" && req.method==="POST"){
  let body="";req.on("data",chunk=>{body+=chunk;if(body.length>16384)req.destroy();});
  req.on("end",()=>{try {
    const {width,results}=JSON.parse(body);
    if(![390,768,1440].includes(width)||!Array.isArray(results)){res.writeHead(400).end();return;}
    fs.writeFileSync(out+"/app-settings-"+width+(req.url.includes("?web")?"-web":"")+".json",JSON.stringify({width,results},null,2));
    res.end("saved");
  } catch {res.writeHead(400).end();}});return;
 }
 if(!name){res.setHeader("Content-Type","text/html");res.end('<html class="dark" lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Standalone App Settings fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module">window.addEventListener("error",e=>{document.body.innerText=String(e.error?.stack||e.message)});import("/app.js").catch(e=>{document.body.innerText=String(e.stack||e)})</script></body></html>');return;}
 if(!["app.js","theme.css","app.css"].includes(name)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(out+"/"+name));
});
server.listen(Number(process.env.FIXTURE_PORT || 3298),"127.0.0.1",()=>console.log("STANDALONE_APP_SETTINGS_READY"));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
