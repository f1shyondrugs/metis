#!/usr/bin/env node
// Static component preview only. It never starts a browser, worker or production API.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
const req=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),directory=path.join(root,"output","ui-audit-preview");
const {build}=createRequire(req.resolve("tsx"))("esbuild");
async function main(){
 fs.mkdirSync(directory,{recursive:true});
 await build({entryPoints:[path.join(root,"tests/ui-consistency.browser.jsx")],outfile:path.join(directory,"app.js"),bundle:true,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":'{}'},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
 const css=await postcss([tailwindcss()]).process(fs.readFileSync(path.join(root,"app/globals.css"),"utf8"),{from:path.join(root,"app/globals.css")});
 fs.writeFileSync(path.join(directory,"theme.css"),css.css);
 fs.writeFileSync(path.join(directory,"index.html"),'<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metis component audit</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
 console.log("UI_AUDIT_BUILT");
 if(process.argv.includes("--build-only"))return;
 const portArg=process.argv.find(arg=>arg.startsWith("--port=")),port=Number(portArg?.slice(7)||3248);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error("Choose a valid unprivileged preview port.");
 http.createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/__audit/report"&&req.method==="POST"){
   let body="";for await(const part of req){body+=part;if(body.length>200000)return res.writeHead(413).end();}
   try{const file=path.join(directory,"results.json"),reports=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):[];reports.push(JSON.parse(body));fs.writeFileSync(file,JSON.stringify(reports.slice(-100),null,2));res.end("saved");}catch{res.writeHead(400).end();}return;
  }
  const file=path.resolve(directory,"."+(url.pathname==="/"?"/index.html":url.pathname));
  if(!file.startsWith(directory+path.sep))return res.writeHead(403).end();
  try{res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type",file.endsWith(".css")?"text/css":file.endsWith(".js")?"text/javascript":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
 }).listen(port,"127.0.0.1",()=>console.log("UI_AUDIT_READY http://127.0.0.1:"+port));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
