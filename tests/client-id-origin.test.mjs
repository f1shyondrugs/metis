import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {chromium} from "playwright";

// Repository regression fixture only: intercepted test origins, no external
// website/account and no connection to the production Metis browser or data.
test("native HTTP LAN origin generates client UUIDs without a secure context",{
 skip:process.getuid?.()===0?"Real browser contexts run on the non-root CI runner":false,
 timeout:30_000,
},async t=>{
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 t.after(()=>browser.close());
 const context=await browser.newContext({serviceWorkers:"block"});
 const code=ts.transpileModule(fs.readFileSync(new URL("../lib/client-id.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText;
 const html='<h1>HTTP UUID regression fixture</h1><script>const exports={};'+code+
 ';window.result={secureContext:isSecureContext,native:typeof crypto.randomUUID,ids:Array.from({length:100},()=>exports.createClientId())};</script>';
 await context.route("**/*",route=>route.fulfill({contentType:"text/html",body:html}));
 const page=await context.newPage();
 for(const protocol of ["http","https"]){
  await page.goto(protocol+"://metis-lan.test/");
  const result=await page.evaluate(()=>window.result);
  assert.equal(result.secureContext,protocol==="https");
  assert.equal(result.native,protocol==="https"?"function":"undefined");
  assert.equal(new Set(result.ids).size,100);
  for(const id of result.ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  console.log("NATIVE_"+protocol.toUpperCase()+"_IDS_PASS secureContext="+result.secureContext+" randomUUID="+result.native+" ids="+result.ids.length);
 }
});
