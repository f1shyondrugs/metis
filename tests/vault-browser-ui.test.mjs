import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import {mkdtempSync,readFileSync,mkdirSync,rmSync} from "node:fs";
import os from "node:os";
import {createRequire} from "node:module";
import {chromium} from "playwright";
const nonRoot=process.getuid?.()===0?"Real sandboxed browser fixtures run on the non-root CI runner":false;
const artifacts=path.join(process.cwd(),"output/vault-ui");

test("Vault UI: add, safe errors, retry, duplicate protection, cancellation and responsive layout",{skip:nonRoot},async t=>{
 const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
 const built=await build({absWorkingDir:process.cwd(),stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import {SavedWebsiteLogins} from "./components/saved-website-logins";createRoot(document.getElementById("root")).render(<SavedWebsiteLogins/>);',resolveDir:process.cwd(),loader:"jsx"},jsx:"automatic",bundle:true,write:false,platform:"browser",define:{"process.env.NODE_ENV":'"production"'}});
 const postcss=(await import("postcss")).default,tailwind=(await import("@tailwindcss/postcss")).default;
 const css=(await postcss([tailwind()]).process(readFileSync("app/globals.css","utf8"),{from:path.join(process.cwd(),"app/globals.css")})).css;
 const entries=[];let failOnce=true;
 const server=http.createServer(async(req,res)=>{
  if(req.url==="/bundle.js"){res.setHeader("Content-Type","application/javascript");return res.end(built.outputFiles[0].text);}
  if(req.url==="/theme.css"){res.setHeader("Content-Type","text/css");return res.end(css);}
  if(req.url==="/api/browser/saved-logins"){
   res.setHeader("Content-Type","application/json");
   if(req.method==="GET")return res.end(JSON.stringify({credentials:entries}));
   let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
   if(failOnce){failOnce=false;res.writeHead(503);return res.end(JSON.stringify({error:"The protected credential service is unavailable."}));}
   const origin=new URL(body.origin).origin;
   if(body.action==="create"&&entries.some(entry=>entry.origin===origin)){res.writeHead(409);return res.end(JSON.stringify({error:"A login already exists for this website. Edit the existing entry instead."}));}
   if(body.action==="create")entries.push({origin});
   return res.end(JSON.stringify({status:"created"}));
  }
  res.setHeader("Content-Type","text/html");res.end('<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"></head><body style="margin:0;background:var(--background);color:var(--foreground);font-family:system-ui"><main style="max-width:780px;margin:24px auto;padding:16px"><div id="root"></div></main><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 await page.goto("http://127.0.0.1:"+server.address().port);
 await page.getByText("No saved logins yet.",{exact:false}).waitFor();
 await page.getByRole("button",{name:"Add login",exact:true}).click();
 const dialog=page.getByRole("dialog");await dialog.waitFor();
 await dialog.getByLabel("Login website").fill("https://portal.test/login");
 await dialog.getByLabel("Username (optional)",{exact:true}).fill("TEST-VAULT-USER");
 const secret="SYNTHETIC-VAULT-FORM-9842";
 await dialog.getByLabel("Password",{exact:true}).fill(secret);
 await dialog.getByRole("button",{name:"Show password",exact:true}).click();
 assert.equal(await dialog.getByLabel("Password",{exact:true}).getAttribute("type"),"text");
 await dialog.getByRole("button",{name:"Hide password",exact:true}).click();
 await dialog.getByRole("button",{name:"Save login",exact:true}).click();
 await dialog.getByRole("alert").waitFor();
 assert.equal(await dialog.getByLabel("Password",{exact:true}).inputValue(),secret,"a failed request preserves the draft");
 await dialog.getByRole("button",{name:"Save login",exact:true}).click();await dialog.waitFor({state:"hidden"});
 await page.getByText("https://portal.test",{exact:true}).waitFor();assert.equal(entries.length,1);
 await page.getByRole("button",{name:"Add login",exact:true}).click();
 await dialog.getByLabel("Login website").fill("https://portal.test/another-path");
 await dialog.getByLabel("Password",{exact:true}).fill("SYNTHETIC-SECOND");
 await dialog.getByRole("button",{name:"Save login",exact:true}).click();await dialog.getByRole("alert").waitFor();
 assert.equal(entries.length,1);assert.match(await dialog.getByRole("alert").innerText(),/already exists/);
 await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
 mkdirSync(artifacts,{recursive:true});
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:width===768?1024:width===390?844:960});
  await page.getByRole("button",{name:"Add login",exact:true}).click();
  assert.equal(await dialog.getByLabel("Password",{exact:true}).inputValue(),"");
  assert.equal(await dialog.getByLabel("Username (optional)",{exact:true}).inputValue(),"");
  await dialog.getByLabel("Login website").fill("https://example.test/login");
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  await page.screenshot({path:path.join(artifacts,"vault-add-"+width+".png"),animations:"disabled"});
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
 }
 assert(!await page.evaluate(value=>JSON.stringify([localStorage,sessionStorage]).includes(value),secret));
});

test("Screenshot pixels: normal text stays readable, native password dots stay unchanged and revealed values are masked",{skip:nonRoot},async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"metis-vault-screen-"));
 Object.assign(process.env,{AI_CHAT_ROOT:dir,CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir});
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {screenshotPage,collectFormState}=await import("../lib/server-browser.ts");
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:700,height:420}});
 await page.setContent('<h1>Public form</h1><input id="search" value="Alpha text"><textarea id="notes">Public notes</textarea><div contenteditable="true">Editable text</div><input type="hidden" name="skin" value="1">');
 const first=await screenshotPage(page,{type:"png"});
 await page.locator("#search").fill("Other text");await page.locator("#search").evaluate(el=>el.blur());
 assert.notDeepEqual(await screenshotPage(page,{type:"png"}),first,"ordinary input text must change the visible image");
 const form=await collectFormState(page);assert.equal(form.controls.find(c=>c.id==="search").value,"Other text");
 assert.equal(form.controls.find(c=>c.name==="skin").value,"[REDACTED]");
 assert(form.controls.every(c=>!c.selector.includes("[REDACTED]")),"hidden routing flags do not corrupt selectors");
 await page.setContent('<h1>Native password</h1><input type="password" value="ABCD1234">');
 const native=await page.screenshot({type:"png"});
 assert.deepEqual(await screenshotPage(page,{type:"png"}),native,"the browser's native password bullets need no extra black box");
 await page.setContent('<h1>Revealed password</h1><input type="text" name="password" value="ABCD1234">');
 const plain=await page.screenshot({type:"png"}),masked=await screenshotPage(page,{type:"png"});
 assert.notDeepEqual(masked,plain);
 await page.locator("input").fill("WXYZ5678");await page.locator("input").evaluate(el=>el.blur());
 assert.deepEqual(await screenshotPage(page,{type:"png"}),masked,"revealed secrets never change the masked pixels");
 await page.setContent('<div id="shadow"></div>');
 await page.locator("#shadow").evaluate(el=>{el.attachShadow({mode:"open"}).innerHTML='<input type="text" name="password" value="SHADOW-TEST-9842"><span>SHADOW-TEST-9842</span>';});
 await assert.rejects(screenshotPage(page,{type:"png"}),/sensitive form values/);
 await page.setContent('<h1>Reflection after field removal</h1><p>ABCD1234</p>');
 await assert.rejects(screenshotPage(page,{type:"png"}),/sensitive form values/);
 mkdirSync(artifacts,{recursive:true});await page.setContent('<h1>Normal inputs remain visible</h1><label>Search <input value="Metis AI"></label><label>Notes <textarea>Public test text</textarea></label><label>Password <input type="password" value="TEST-ONLY-NATIVE"></label>');
 await screenshotPage(page,{type:"png"}).then(image=>import("node:fs").then(fs=>fs.writeFileSync(path.join(artifacts,"browser-input-masking.png"),image)));
});
