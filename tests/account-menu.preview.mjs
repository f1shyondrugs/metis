// Actual account menu with synthetic local DesktopBridge. No account/session/production data.
import fs from "node:fs";import path from "node:path";import http from "node:http";import {createRequire} from "node:module";
import postcss from "postcss";import tailwind from "@tailwindcss/postcss";
const output=path.resolve("output/account-menu-ui");fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/account-menu.browser.tsx"],outdir:output,entryNames:"app",bundle:true,platform:"browser",format:"esm",splitting:true,jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(output+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1:3278");
 if(url.pathname==="/report"&&req.method==="POST"){let body="";for await(const part of req)body+=part;const report=JSON.parse(body);fs.writeFileSync(output+"/result-"+report.width+".json",JSON.stringify(report,null,2));res.end("saved");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account menu preview</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname),file=path.join(output,name);if(!/^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.setHeader("Cache-Control","no-store");res.end(fs.readFileSync(file));
});server.listen(3278,"127.0.0.1",()=>console.log("ACCOUNT_MENU_FIXTURE_READY"));process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
