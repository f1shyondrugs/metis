import assert from "node:assert/strict";
import test from "node:test";
import {randomBytes} from "node:crypto";
import {SavedBrowserLogins} from "../services/browser-login/core";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {BrowserContext,Page} from "playwright";
import {createBrowserTextRedactor} from "../lib/browser-redaction";
import {browserInputSecrets,browserUrlSecrets,retainBrowserSecrets} from "../lib/browser-secure-input";
import {browserSecretRepresentations} from "../services/browser-login/navigation-policy";

function pageFor(context={} as BrowserContext) {
  return {context:()=>context} as Page;
}
function redactor(page:Page) {
  return createBrowserTextRedactor(browserInputSecrets(page).flatMap(browserSecretRepresentations),browserUrlSecrets(page).flatMap(browserSecretRepresentations));
}

test("public profile URLs survive login identities and hidden return paths, with no domain exception",()=>{
  const page=pageFor();
  retainBrowserSecrets(page,["public-handle","/public-handle"],true);
  const redact=redactor(page);
  for(const url of ["https://github.com/public-handle","https://social.example/@public-handle","https://code.example/public-handle/repos"]){
    assert.equal(redact(url),url);
    assert.equal(redact('Profile: "'+url+'"'), 'Profile: "'+url+'"');
  }
  assert.equal(redact("Login: public-handle"),"Login: [REDACTED]");
  assert.equal(redact("https://github.com/public-handle?login=public-handle#public-handle"),"https://github.com/public-handle?login=[REDACTED]#[REDACTED]");
});

test("passwords and tokens stay redacted everywhere even when equal to a public profile value",()=>{
  const page=pageFor();
  retainBrowserSecrets(page,["shared-handle"],true);
  retainBrowserSecrets(page,["shared-handle","SESSION-TOKEN"]);
  retainBrowserSecrets(page,["shared-handle"],true);
  const redact=redactor(page);
  assert.equal(redact("https://github.com/shared-handle"),"https://github.com/[REDACTED]");
  assert.equal(redact("https://profile.example/SESSION-TOKEN"),"https://profile.example/[REDACTED]");
  assert.equal(redact("https://profile.example/u?token=SESSION-TOKEN#SESSION-TOKEN"),"https://profile.example/u?token=[REDACTED]#[REDACTED]");
  assert.equal(redact("https://shared-handle@github.com/public"),"https://[REDACTED]@github.com/public");
});

test("encoded passwords remain filtered while encoded profile names remain usable",()=>{
  const page=pageFor(),password="two words!+/";
  retainBrowserSecrets(page,["public-handle"],true);
  retainBrowserSecrets(page,[password]);
  const redact=redactor(page);
  for(const secret of browserSecretRepresentations(password)){
    assert.equal(redact("https://profile.example/"+secret),"https://profile.example/[REDACTED]");
  }
  assert.equal(redact("https://github.com/"+encodeURIComponent("public-handle")),"https://github.com/public-handle");
});

test("navigation targets do not expose embedded tokens and never cross browser contexts",()=>{
  const page=pageFor(),other=pageFor();
  retainBrowserSecrets(page,["https://github.com/public-handle?code=AUTH-CODE#SESSION-TOKEN"],true);
  const redact=redactor(page);
  assert.equal(redact("https://github.com/public-handle?code=AUTH-CODE#SESSION-TOKEN"),"https://github.com/public-handle?code=[REDACTED]#[REDACTED]");
  assert.equal(redact("https://github.com/AUTH-CODE"),"https://github.com/[REDACTED]");
  assert.equal(redactor(other)("https://github.com/AUTH-CODE"),"https://github.com/AUTH-CODE");
});

test("literal matching handles regex characters, overlapping values and existing marker text",()=>{
  const redact=createBrowserTextRedactor(["a.b","long-a.b","REDACTED"]);
  assert.equal(redact("long-a.b a.b axb REDACTED"),"[REDACTED] [REDACTED] axb [REDACTED]");
});

test("ordinary browser snapshots and form results preserve profile links but conceal actual field values",async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-profile-redaction-"));
  Object.assign(process.env,{CHAT_DATA_DIR:dir,CHAT_DB_PATH:path.join(dir,"chat.sqlite"),AGENT_CWD:dir,AI_CHAT_ROOT:dir});
  try {
    const {collectFrameText,collectFormState}=await import("../lib/server-browser");
    const url="https://github.com/public-handle";
    const groups={all:["public-handle","/public-handle","SESSION-TOKEN"],urlSecrets:["SESSION-TOKEN"],credentials:["SESSION-TOKEN"],identities:["public-handle"],navigation:["/public-handle"]};
    const frame={
      url:()=>url,
      locator:()=>({evaluateAll:async()=>groups,innerText:async()=>url+" SESSION-TOKEN public-handle",ariaSnapshot:async()=>'- link "'+url+'"'}),
      evaluate:async()=>({text:url+" SESSION-TOKEN",controls:[{tag:"input",type:"hidden",value:"[REDACTED]",selector:"#return_to"},{tag:"a",label:url,selector:"#profile"}]}),
    };
    const context={} as BrowserContext;
    const page={context:()=>context,frames:()=>[frame]} as unknown as Page;
    assert.equal(await collectFrameText(page,"text"),url+" [REDACTED] [REDACTED]");
    assert.equal(await collectFrameText(page,"snapshot"),'- link "'+url+'"');
    const form=await collectFormState(page);
    assert.equal(form.text,url+" [REDACTED]");
    assert.equal(form.controls[0].value,"[REDACTED]");
    assert.equal(form.controls[1].label,url);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("protected browser dispatch preserves profile metadata and links, while filtering cookies and passwords",async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"metis-private-profile-"));
  const core=new SavedBrowserLogins(randomBytes(32),path.join(dir,"vault.sqlite"));
  const url="https://github.com/public-handle";
  const context={cookies:async()=>[{value:"SESSION-TOKEN"}]} as unknown as BrowserContext;
  const page={
    context:()=>context,isClosed:()=>false,url:()=>url,title:async()=>url,viewportSize:()=>({width:960,height:720}),
    locator:()=>({
      evaluateAll:async()=>({secrets:[],navigation:["/public-handle"]}),
      innerText:async()=>url+" FIXTURE-PASSWORD SESSION-TOKEN",
    }),
  } as unknown as Page;
  retainBrowserSecrets(page,["public-handle"],true);
  retainBrowserSecrets(page,["FIXTURE-PASSWORD"]);
  // Seed a browser-engine transport fixture; dispatch and its output filtering
  // remain real, without needing an external site or the Chromium sandbox.
  (core as unknown as {sessions:Map<string,unknown>}).sessions.set("profile-owner:profile-chat",{
    page,context,browser:{close:async()=>{}},used:Date.now(),
  });
  try{
    const result=await core.dispatch({owner:"profile-owner",chat:"profile-chat",operation:"action",input:{action:"extract_text"}},false);
    assert.equal(result.url,url);
    assert.equal(result.title,url);
    assert.equal(result.tabs?.[0].url,url);
    assert.equal(result.snapshot,url+" [REDACTED] [REDACTED]");
    await assert.rejects(core.dispatch({owner:"other-owner",chat:"profile-chat",operation:"action",input:{action:"extract_text"}},false),/session|browser/i);
  }finally{
    await core.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
