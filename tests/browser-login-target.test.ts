import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {chromium,type BrowserContext,type Page} from "playwright";

const dir=mkdtempSync(path.join(os.tmpdir(),"metis-login-target-"));
Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir});
test.after(()=>rmSync(dir,{recursive:true,force:true}));

test("trusted login target survives hidden return-URL redaction without exposing another user's page",async t=>{
  const {performBrowserAction,getBrowserLoginTarget,closeBrowserSession}=await import("../lib/server-browser");
  const server=http.createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end(`<form><input type="hidden" name="return_to" value="http://${req.headers.host}/login"><input name="username"><input type="password"></form>`);});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await closeBrowserSession("owner-a","chat-a");await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});});
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/login`;
  const result=await performBrowserAction("owner-a","chat-a",{action:"navigate",url,source:"agent",includeScreenshot:false});
  assert.equal(result.url,"[REDACTED]");
  assert.equal(getBrowserLoginTarget("owner-a","chat-a",result.tabId),url);
  assert.throws(()=>getBrowserLoginTarget("owner-b","chat-a",result.tabId));
  assert.throws(()=>getBrowserLoginTarget("owner-a","chat-b",result.tabId));
  assert.throws(()=>getBrowserLoginTarget("owner-a","chat-a","missing-tab"));
});

test("trusted HTTPS target preserves query and fragment while form metadata distinguishes visible fields",async t=>{
  const launch=chromium.launchPersistentContext.bind(chromium);
  const contexts:BrowserContext[]=[];
  const pages:Page[]=[];
  t.mock.method(chromium,"launchPersistentContext",async(...[profile,options]:Parameters<typeof launch>)=>{
    const context=await launch(profile,options);
    contexts.push(context);
    const newPage=context.newPage.bind(context);
    t.mock.method(context,"newPage",async()=>{
      const page=await newPage();pages.push(page);
      await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:'<input type="hidden" value="example"><div hidden><input id="hidden-user"></div><input id="visible-user"><input id="invisible" style="visibility:hidden">'}));
      await page.goto("https://portal.test/login?campus=example&state=TEST-STATE#TEST-FRAGMENT");
      return page;
    });
    return context;
  });
  t.after(async()=>{for(const context of contexts)await context.close();});
  const {performBrowserAction,getBrowserLoginTarget,collectFormState}=await import("../lib/server-browser");
  // Create the ordinary tab through its existing public action contract. The
  // trusted getter itself never creates sessions for a missing owner or chat.
  const result=await performBrowserAction("https-owner","https-chat",{action:"select_tab",source:"agent",includeScreenshot:false});
  assert.equal(getBrowserLoginTarget("https-owner","https-chat",result.tabId),"https://portal.test/login?campus=example&state=TEST-STATE#TEST-FRAGMENT");
  assert.throws(()=>getBrowserLoginTarget("missing-owner","https-chat",result.tabId));
  assert.throws(()=>getBrowserLoginTarget("https-owner","missing-chat",result.tabId));
  assert.equal(pages.length,1);
  const form=await collectFormState(pages[0]);
  assert.equal(form.controls.find(control=>control.id==="hidden-user")?.visible,false);
  assert.equal(form.controls.find(control=>control.id==="visible-user")?.visible,true);
  assert.equal(form.controls.find(control=>control.id==="invisible")?.visible,false);
});
