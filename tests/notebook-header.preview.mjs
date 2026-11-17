import fs from "node:fs";import path from "node:path";import http from "node:http";import {createRequire} from "node:module";
import postcss from "postcss";import tailwind from "@tailwindcss/postcss";import {notebookBreadcrumbSource} from "./notebook-header-harness.mjs";
const out=path.resolve("output/notebook-header");fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
await build({stdin:{contents:notebookBreadcrumbSource()+'\nimport {runNotebookHeaderFixture} from "./tests/notebook-header.browser";runNotebookHeaderFixture(Breadcrumb);',loader:"tsx",resolveDir:process.cwd()},outfile:out+"/app.js",bundle:true,platform:"browser",format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},loader:{".woff2":"dataurl",".woff":"dataurl",".ttf":"dataurl"}});
const css=await postcss([tailwind()]).process(fs.readFileSync("app/globals.css","utf8"),{from:"app/globals.css"});fs.writeFileSync(out+"/theme.css",css.css);
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,"http://127.0.0.1:3283");
 if(url.pathname==="/report"&&req.method==="POST"){let b="";for await(const v of req)b+=v;const r=JSON.parse(b);fs.writeFileSync(out+"/result-"+r.width+".json",JSON.stringify(r,null,2));res.end("saved");return;}
 if(url.pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notebook presence and breadcrumb – isolated fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return;}
 const name=path.basename(url.pathname);if(!["app.js","theme.css"].includes(name)){res.writeHead(404).end();return;}res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(path.join(out,name)));
});server.listen(3283,"127.0.0.1",()=>console.log("NOTEBOOK_HEADER_FIXTURE_READY"));process.on("SIGTERM",()=>server.close(()=>process.exit(0)));
