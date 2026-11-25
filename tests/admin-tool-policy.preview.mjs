// Local-only, synthetic policy fixture. The browser drives it through Metis.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const output = await build({
  entryPoints:["tests/admin-tool-policy.browser.tsx"], tsconfig:path.resolve("tsconfig.json"),
  bundle:true, platform:"browser", format:"esm", jsx:"automatic", write:false,
  define:{"process.env.NODE_ENV":'"production"'},
});
assert.equal(output.outputFiles.length,1);
const css=await postcss([tailwind()]).process(await readFile("app/globals.css","utf8"),{from:"app/globals.css"});
const routes=new Map([
  ["/",["text/html; charset=utf-8",'<!doctype html><html lang="en" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin tool policy fixture</title><link rel="stylesheet" href="/theme.css"><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>']],
  ["/theme.css",["text/css",css.css]],
  ["/fixture.js",["text/javascript",output.outputFiles[0].contents]],
]);
const server=http.createServer((req,res)=>{
  const route=routes.get(new URL(req.url,"http://localhost").pathname);
  if (req.method!=="GET" || !route) return res.writeHead(404).end();
  res.writeHead(200,{"Content-Type":route[0],"Cache-Control":"no-store"}).end(route[1]);
});
server.listen(18148,"127.0.0.1",()=>console.log("ADMIN_TOOL_POLICY_FIXTURE_READY"));
