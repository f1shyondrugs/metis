// Read-only component fixture; no app server, account database or credentials.
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import http from "node:http";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve("tsx"))("esbuild");
const tmp=await mkdtemp(path.join(os.tmpdir(),"metis-mobile-ux-"));
const reportDir=process.env.METIS_FIXTURE_REPORT_DIR;
try{
 await build({entryPoints:["tests/mobile-input-ux.browser.tsx"],tsconfig:path.resolve("tsconfig.json"),outfile:path.join(tmp,"fixture.js"),bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
 const css=await postcss([tailwind()]).process(await readFile("app/globals.css","utf8"),{from:"app/globals.css"});
 const notes=await readFile("components/notes/block-editor.css","utf8");
 const html='<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metis Mobile UX fixture</title><link rel="stylesheet" href="/theme.css"><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
 const assets=new Map([["/",["text/html",html]],["/theme.css",["text/css",css.css+"\n"+notes]],["/fixture.js",["text/javascript",await readFile(path.join(tmp,"fixture.js"))]]]);
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/report"&&req.method==="POST"){let data="";for await(const c of req){data+=c;if(data.length>30000){res.writeHead(413).end();return;}}try{const report=JSON.parse(data);if(reportDir&&Number.isInteger(report.width))await writeFile(path.join(reportDir,"browser-"+report.width+".json"),JSON.stringify(report,null,2));res.writeHead(204).end();}catch{res.writeHead(400).end();}return;}
  const asset=assets.get(url.pathname);if(!asset){res.writeHead(404).end();return;}res.setHeader("Content-Type",asset[0]);res.end(asset[1]);
 });
 server.listen(Number(process.env.PORT||3272),"127.0.0.1",()=>console.log("MOBILE_UX_FIXTURE_READY"));
 await new Promise((resolve,reject)=>{server.on("error",reject);process.once("SIGTERM",()=>server.close(resolve));process.once("SIGINT",()=>server.close(resolve));});
}finally{await rm(tmp,{recursive:true,force:true});}
