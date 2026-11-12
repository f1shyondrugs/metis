import fs from "node:fs";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
const directory="data/artifacts/onboarding-20261112/browser";fs.mkdirSync(directory,{recursive:true});
await build({entryPoints:["tests/onboarding.browser.tsx"],outdir:directory,entryNames:"app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(directory+"/theme.css",css.css);
fs.writeFileSync(directory+"/index.html",'<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metis onboarding fixture</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><script type="module" src="/app.js"></script></body></html>');
console.log("ONBOARDING_FIXTURE_BUILT");
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==="/report"&&request.method==="POST"){let data="";request.on("data",part=>{data+=part;if(data.length>200000)request.destroy();});request.on("end",()=>{const report=JSON.parse(data);fs.writeFileSync(directory+"/result-"+report.width+".json",JSON.stringify(report,null,2));console.log("ONBOARDING_BROWSER_RESULT",report.width,report.results.filter(x=>x.startsWith("FAIL")));response.end("saved");});return;}
 if(url.pathname==="/metis-wordmark.svg"){response.setHeader("Content-Type","image/svg+xml");response.end(fs.readFileSync("public/metis-wordmark.svg"));return;}
 const file=url.pathname==="/"?"index.html":url.pathname.slice(1);
 if(!["index.html","app.js","app.css","theme.css"].includes(file)&&!(/^[a-zA-Z0-9_-]+\.js$/.test(file)&&fs.existsSync(directory+"/"+file))){response.writeHead(404).end();return;}
 response.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");response.setHeader("Cache-Control","no-store");response.end(fs.readFileSync(directory+"/"+file));
});
server.listen(3270,"127.0.0.1",()=>console.log("ONBOARDING_FIXTURE_READY http://127.0.0.1:3270"));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
