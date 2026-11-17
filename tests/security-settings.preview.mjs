import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const out=path.resolve("output/security-settings");fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/security-settings.browser.tsx"],tsconfig:"tsconfig.json",outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:path.resolve("app/globals.css")});
fs.writeFileSync(out+"/theme.css",css.css);
const server=http.createServer((req,res)=>{
 const name=path.basename(new URL(req.url,"http://localhost").pathname);
 if(!name){res.setHeader("Content-Type","text/html");res.end('<html class="dark" lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module">window.addEventListener("error",e=>{document.body.innerText=String(e.error?.stack||e.message)});import("/app.js").catch(e=>{document.body.innerText=String(e.stack||e)})</script></body></html>');return;}
 if(!["app.js","theme.css","app.css"].includes(name)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(out+"/"+name));
});
server.listen(3296,"127.0.0.1",()=>console.log("SECURITY_PREVIEW_READY"));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
