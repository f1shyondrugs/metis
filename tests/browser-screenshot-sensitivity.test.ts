import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {chromium,type Page} from "playwright";

const root=mkdtempSync(path.join(os.tmpdir(),"metis-screenshot-policy-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root});
const helpers=import("../lib/server-browser");
test.after(()=>rmSync(root,{recursive:true,force:true}));
const needsNonRoot=process.getuid?.()===0 ? "Chromium sandbox tests run on the non-root CI runner" : false;

test("Bing-style hidden search parameters do not block screenshots and stay redacted in form state",{skip:needsNonRoot},async t=>{
  const {screenshotPage,collectFormState}=await helpers;
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<h1>Search results</h1><form><input type="search" name="q" value="Metis AI"><input type="hidden" name="qs" value="SEARCH-MODE"><input type="hidden" name="form" value="QUERY-ORIGIN"><input type="hidden" name="cbir" value="SEARCH-FLAG"></form>');
  const image=await screenshotPage(page,{type:"png"});
  assert.equal(image.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  const form=await collectFormState(page);
  for(const control of form.controls.filter(item=>item.type==="hidden"))assert.equal(control.value,"[REDACTED]");
  assert.equal(form.controls.find(item=>item.name==="q")?.value,"Metis AI");
  assert.match(await page.locator("h1").innerText(),/Search results/);
});

test("filled credentials still block screenshots, including revealed and explicitly named hidden passwords",{skip:needsNonRoot},async t=>{
  const {screenshotPage}=await helpers;
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  for(const attributes of [
    'type="password"',
    'type="text" autocomplete="current-password"',
    'type="text" name="password"',
    'type="hidden" name="password"',
    'type="text" autocomplete="one-time-code"',
    'type="text" autocomplete="cc-number"',
  ]){
    await page.setContent('<input '+attributes+' value="TEST-SECRET"><p>TEST-SECRET</p>');
    await assert.rejects(screenshotPage(page,{type:"png"}),/sensitive form values/);
  }
  await page.setContent('<input type="password" value=""><input type="hidden" name="form" value="QUERY-ORIGIN">');
  assert.ok((await screenshotPage(page,{type:"jpeg",quality:60})).length>0,"Empty login fields alone are not a secret");
});

test("credentials inside an embedded frame still prevent capture",{skip:needsNonRoot},async t=>{
  const {screenshotPage}=await helpers;
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<iframe srcdoc="&lt;input type=password value=TEST-FRAME-SECRET&gt;"></iframe>');
  await page.frameLocator("iframe").locator("input").waitFor();
  await assert.rejects(screenshotPage(page,{type:"png"}),/sensitive form values/);
});

test("capture remains blocked when frame inspection fails",async()=>{
  const {screenshotPage}=await helpers;
  let captured=false;
  const page={
    frames:()=>[{locator:()=>({evaluateAll:async()=>{throw Error("Frame unavailable");}})}],
    screenshot:async()=>{captured=true;return Buffer.from("must not capture");},
  } as unknown as Page;
  await assert.rejects(screenshotPage(page,{type:"png"}),/sensitive form values/);
  assert.equal(captured,false);
});
