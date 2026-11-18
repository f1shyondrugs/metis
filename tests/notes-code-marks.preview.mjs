import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createRequire} from "node:module";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const sourceRoot=process.env.METIS_CANVAS_SOURCE_ROOT || process.cwd();
const out=path.resolve(process.env.METIS_CANVAS_PREVIEW_OUT || "output/canvas-code-marks");
fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({entryPoints:["tests/notes-code-marks.browser.tsx"],tsconfig:path.join(sourceRoot,"tsconfig.json"),outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync(path.join(sourceRoot,"app/globals.css"),"utf8"),{from:path.join(sourceRoot,"app/globals.css")});
fs.writeFileSync(out+"/theme.css",css.css);
const port=Number(process.env.METIS_CANVAS_PREVIEW_PORT || 3297);
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,"http://127.0.0.1").pathname;
 if(pathname==="/report"&&req.method==="POST"){let body="";for await(const chunk of req)body+=chunk;const report=JSON.parse(body);fs.writeFileSync(out+"/browser-result.json",JSON.stringify(report,null,2));res.end("saved");return;}
 if(pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas editor regression</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(pathname);
 if(!["app.js","theme.css","app.css"].includes(name)){res.writeHead(404).end();return;}
 res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(path.join(out,name)));
});
server.listen(port,"127.0.0.1",()=>console.log("CANVAS_PREVIEW_READY "+port));
process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
