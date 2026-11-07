import {requireProtectedForm,requireProtectedInput} from "../lib/protected-login-contract";
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
import { chromium, type Page } from "playwright";
import { SavedBrowserLogins } from "../services/browser-login/core";

const origin = "https://portal.test";
const secret = "SYNTHETIC-REDIRECT-PASSWORD:/+";
type Arrival = { host: string; path: string; method: string; body: string; cookie: string };

async function fixture(t: TestContext, enteredPassword = secret) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-login-redirect-"));
  const keyFile = path.join(dir, "key.pem"), certFile = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=portal.test"], { stdio: "ignore" });
  const arrivals: Arrival[] = [];
  const portal = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const url = new URL(req.url || "/", origin);
    arrivals.push({ host: req.headers.host || "", path: url.pathname, method: req.method || "", body, cookie: req.headers.cookie || "" });
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/login") {
      const destination = url.searchParams.get("case") || "return302";
      const encoding = destination.split("-")[destination.startsWith("form-")?1:0];
      const enctype=destination.startsWith("form")?"application/x-www-form-urlencoded":"text/plain";
      const transformation = encoding === "assertion" ? "'SYNTHETIC-SSO-ASSERTION'" : encoding === "base64" ? "btoa(field.value)" : encoding === "hex" ?
        "Array.from(field.value).map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')" :
        encoding === "url" ? "encodeURIComponent(field.value)" : "field.value";
      res.setHeader("Content-Type", "text/html");
      res.end('<form method="post" enctype="' + enctype + '" action="/submit-' + destination + '" onsubmit="const field=document.querySelector(\'#password\');field.value=' + transformation + '"><input id="password" name="password" type="password"><button id="submit">Login</button></form>' +
        '<button id="spawn-blob" onclick="const data=new FormData();data.append(\'text\',\'safe-text\');data.append(\'file\',new Blob([document.querySelector(\'#password\').value]),\'synthetic.txt\');fetch(\'/child-submit307\',{method:\'POST\',body:data}).catch(()=>{}).finally(()=>document.body.insertAdjacentHTML(\'beforeend\',\'<p id=blob-finished>Blob finished</p>\'))">Blob</button>' +
        '<button id="spawn-frame" onclick="const frame=document.createElement(\'iframe\');frame.src=\'https://return.test/frame\';document.body.append(frame)">Frame</button>' +
        '<button id="spawn-worker" onclick="const worker=new Worker(\'/worker.js\');worker.onmessage=()=>document.body.insertAdjacentHTML(\'beforeend\',\'<p id=child-finished>Worker finished</p>\')">Worker</button>' +
        '<script>addEventListener("message",event=>{if(event.data==="FRAME_FINISHED")document.body.insertAdjacentHTML("beforeend","<p id=child-finished>Frame finished</p>")})</script>');
    } else if (url.pathname.startsWith("/submit-")) {
      const destination = url.pathname.slice("/submit-".length);
      let location = "https://return.test/accepted";
      if (destination === "foreign302") location = "https://foreign.test/final";
      else if (destination === "chain302") location = "https://return.test/foreign-hop";
      else if (destination === "same307") location = origin + "/credential-hop";
      else if (destination.endsWith("307") || destination.endsWith("308")) location = "https://return.test/final";
      else if (destination === "query302") location = "https://return.test/final?value=" + encodeURIComponent(secret);
      const status = destination.endsWith("307") ? 307 : destination.endsWith("308") ? 308 : destination.endsWith("303") ? 303 : 302;
      res.writeHead(status, { location, "set-cookie": "portal_session=SYNTHETIC-PORTAL-SESSION; Secure; Path=/" }); res.end();
    } else if (url.pathname === "/credential-hop") {
      res.writeHead(303,{location:"https://return.test/accepted"});res.end();
    } else if (url.pathname === "/accepted") {
      res.writeHead(302, { location: "/final", "set-cookie": "return_session=SYNTHETIC-RETURN-SESSION; Secure; Path=/" }); res.end();
    } else if (url.pathname === "/foreign-hop") {
      res.writeHead(302, { location: "https://foreign.test/final" }); res.end();
    } else if (url.pathname === "/final") {
      res.setHeader("Content-Type", "text/html");
      res.end('<h1>Authenticated destination</h1><script src="/task.js"></script>');
    } else if (url.pathname === "/task.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end("fetch('/task-data').then(r=>r.text()).then(text=>document.body.insertAdjacentHTML('beforeend','<p id=task-ready>'+text+'</p>'))");
    } else if (url.pathname === "/task-data") {
      res.end("SYNTHETIC_TASK_READY");
    } else if (url.pathname === "/frame") {
      res.setHeader("Content-Type", "text/html");
      res.end('<script>fetch("https://portal.test/child-submit307",{method:"POST",body:' + JSON.stringify(secret) + '}).catch(()=>{}).finally(()=>parent.postMessage("FRAME_FINISHED","*"))</script>');
    } else if (url.pathname === "/encoded-echo") {
      const encoded = [
        new URLSearchParams({value:enteredPassword}).toString().slice(6),
        new URLSearchParams({value:Buffer.from(enteredPassword).toString("base64")}).toString().slice(6),
        encodeURIComponent(encodeURIComponent(enteredPassword)),
      ];
      res.setHeader("Content-Type", "text/html");
      res.end("<title>"+encoded[0]+"</title><p>"+encoded.join(" ")+"</p><input value='"+encoded[1]+"'>");
    } else if (url.pathname === "/worker.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end('fetch("/child-submit307",{method:"POST",body:' + JSON.stringify(secret) + '}).catch(()=>{}).finally(()=>postMessage("WORKER_FINISHED"))');
    } else if (url.pathname === "/child-submit307") {
      res.writeHead(307, { location: "https://return.test/final" }); res.end();
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => portal.listen(0, "127.0.0.1", resolve));
  const port = (portal.address() as net.AddressInfo).port;
  const sockets = new Set<net.Socket>();
  const proxy = http.createServer();
  proxy.on("connect", (req, client, head) => {
    const incoming = client as net.Socket;
    sockets.add(incoming); incoming.on("close", () => sockets.delete(incoming));
    if (!["portal.test:443", "return.test:443", "foreign.test:443"].includes(req.url || "")) { incoming.destroy(); return; }
    const upstream = net.connect(port, "127.0.0.1", () => {
      incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      incoming.pipe(upstream); upstream.pipe(incoming);
    });
    upstream.on("error", () => incoming.destroy()); incoming.on("error", () => upstream.destroy()); incoming.on("close", () => upstream.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const core = new SavedBrowserLogins(randomBytes(32), path.join(dir, "logins.sqlite"), "http://127.0.0.1:" + (proxy.address() as net.AddressInfo).port);
  t.after(async () => {
    await core.close();
    for (const socket of sockets) socket.destroy();
    portal.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => portal.close(() => resolve()))]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = (operation: string, input: Record<string, unknown> = {}, management = false) =>
    core.dispatch({ owner: "redirect-owner", chat: "redirect-chat", operation, input }, management);
  const prepare = async (destination: string) => {
    const login = await call("prepare", { url: origin + "/login?case=" + destination + "&return_url=" + encodeURIComponent("https://return.test/"), selector: "#password" });
    await call("fill", { requestId: requireProtectedInput(login).requestId, password: enteredPassword, persist: false }, true);
  };
  const submit = async (destination: string) => { await prepare(destination); return call("action", { action: "click", selector: "#submit" }); };
  return { arrivals, submit, prepare, call, hasSession: () => (core as unknown as {sessions:Map<string,{page:Page}>}).sessions.size > 0, page: () => [...(core as unknown as {sessions:Map<string,{page:Page}>}).sessions.values()][0].page };
}

for (const destination of ["return302", "return303"]) {
  test("credential POST and native " + destination + " SSO preserve cookies, origin and fresh task assets", async t => {
    const { arrivals, submit, call, page } = await fixture(t);
    const state = await submit(destination);
    assert.equal(state.url, "https://return.test/final");
    await call("action", { action: "wait_for", selector: "#task-ready" });
    const task = await call("action", { action: "extract_text" });
    assert(task.snapshot?.includes("SYNTHETIC_TASK_READY"));
    assert.equal(arrivals.filter(request => request.method === "POST").length, 1, "credential POST must execute once");
    const final = arrivals.find(request => request.path === "/final");
    assert.equal(final?.method, "GET");
    assert.equal(final?.body, "");
    assert(final?.cookie.includes("return_session=SYNTHETIC-RETURN-SESSION"));
    assert(arrivals.find(request => request.path === "/task-data")?.cookie.includes("return_session=SYNTHETIC-RETURN-SESSION"));
    assert.equal(await page().evaluate(() => location.origin), "https://return.test");
    await assert.rejects(call("action", { action: "navigate", url: "https://foreign.test/" }));
  });
}

for (const destination of ["foreign302", "chain302", "query302", "return307", "return308", "url-307", "base64-307", "hex-307", "form-base64-307"]) {
  test("redirect policy blocks " + destination + " before destination egress", async t => {
    const { arrivals, submit } = await fixture(t);
    await submit(destination).catch(() => {});
    assert.equal(arrivals.filter(request => request.method === "POST").length, 1);
    assert.equal(arrivals.filter(request => request.host === "foreign.test").length, 0);
    assert.equal(arrivals.filter(request => request.path === "/final").length, 0);
    if (destination === "chain302") assert(arrivals.some(request => request.path === "/foreign-hop"));
  });
}

for (const child of ["frame"]) {
  test("a protected " + child + " cannot forward a password through a 307 redirect", async t => {
    const launch=chromium.launch.bind(chromium);
    if(child==="frame")t.mock.method(chromium,"launch",(options:Parameters<typeof chromium.launch>[0])=>launch({...options,args:[...(options?.args||[]),"--site-per-process"]}));
    const { arrivals, prepare, call, page } = await fixture(t);
    await prepare("return302");
    await call("action", { action: "click", selector: "#spawn-" + child });
    await call("action", { action: "wait_for", selector: "#child-finished" });
    assert(arrivals.some(request => request.path === "/child-submit307" && request.body === secret));
    assert.equal(arrivals.filter(request => request.path === "/final").length, 0);
    if (child === "frame") {
      // This reads only fixture target topology; the browser is the product's
      // existing isolated session, with no second browser or action channel.
      const inspection = await page().context().newCDPSession(page());
      const targets = await inspection.send("Target.getTargets");
      assert(targets.targetInfos.some(target => target.type === "iframe"), "fixture must actually exercise an out-of-process iframe");
      await inspection.detach();
    }
  });
}



test("unsupported worker fails closed before execution and releases the owner/chat session",async t=>{
  const {arrivals,prepare,call,page,hasSession}=await fixture(t);
  await prepare("return302");
  const protectedPage=page(),browser=protectedPage.context().browser()!;
  const closed=protectedPage.context().waitForEvent("close");
  const disconnected=new Promise<void>(resolve=>browser.once("disconnected",()=>resolve()));
  await call("action",{action:"click",selector:"#spawn-worker"}).catch(()=>{});
  await Promise.all([closed,disconnected]);
  assert.equal(arrivals.filter(request=>request.path==="/child-submit307").length,0,"unsupported worker must never execute its payload");
  assert.equal(hasSession(),false,"closed context must not retain an owner/chat session slot");
  await assert.rejects(call("action",{action:"form_state"}),error=>error instanceof Error&&"code" in error&&error.code==="session_unavailable");
  const fresh=await call("prepare",{url:origin+"/login",selector:"#password"});
  assert.equal(fresh.status,"filled_saved","chat-scoped credential reuse remains available in the fresh context");
});

test("multipart file bytes cannot bypass redirect password checks",async t=>{
  const {arrivals,prepare,call}=await fixture(t);
  await prepare("return302");
  await call("action",{action:"click",selector:"#spawn-blob"});
  await call("action",{action:"wait_for",selector:"#blob-finished"});
  assert(arrivals.some(request=>request.path==="/child-submit307"&&request.body.includes(secret)));
  assert.equal(arrivals.filter(request=>request.path==="/final").length,0);
});


test("standard HTML form encoding cannot conceal a password in a preserved redirect body",async t=>{
  const {arrivals,submit}=await fixture(t,"two words!");
  await submit("form307").catch(()=>{});
  assert.equal(arrivals.find(request=>request.method==="POST")?.body,"password=two+words%21");
  assert.equal(arrivals.filter(request=>request.path==="/final").length,0);
});


for(const status of [307,308])test("a password-free SSO assertion may retain POST through "+status,async t=>{
  const {arrivals,submit}=await fixture(t);
  const state=await submit("assertion-"+status);
  assert.equal(state.url,"https://return.test/final");
  assert.equal(arrivals.filter(request=>request.path.startsWith("/submit-")).length,1);
  const returned=arrivals.find(request=>request.host==="return.test"&&request.path==="/final");
  assert.equal(returned?.method,"POST");
  assert(returned?.body.includes("SYNTHETIC-SSO-ASSERTION"));
  assert(!returned?.body.includes(secret));
});

test("same-credential-origin 307 may retain the password before a safe 303 SSO return",async t=>{
  const {arrivals,submit}=await fixture(t);
  const state=await submit("same307");
  assert.equal(state.url,"https://return.test/final");
  assert.equal(arrivals.filter(request=>request.path==="/submit-same307").length,1);
  assert(arrivals.find(request=>request.path==="/credential-hop")?.body.includes(secret));
  assert.equal(arrivals.find(request=>request.path==="/final")?.method,"GET");
  assert.equal(arrivals.find(request=>request.path==="/final")?.body,"");
});


test("model-visible state and text redact the same encoded secrets as outbound checks",async t=>{
  const password="two words!";
  const {prepare,call}=await fixture(t,password);
  await prepare("return302");
  const state=await call("action",{action:"navigate",url:origin+"/encoded-echo"});
  const form=await call("action",{action:"form_state"});
  const text=await call("action",{action:"extract_text"});
  const encodings=[
    new URLSearchParams({value:password}).toString().slice(6),
    new URLSearchParams({value:Buffer.from(password).toString("base64")}).toString().slice(6),
    encodeURIComponent(encodeURIComponent(password)),
  ];
  for(const result of [state,form,text]){
    const serialized=JSON.stringify(result);
    for(const value of [password,...encodings])assert(!serialized.includes(value));
    assert(serialized.includes("[REDACTED]"));
  }
  assert(requireProtectedForm(form).controls[0].selector.startsWith("[data-metis-login-ref="));
  await call("action",{action:"wait_for",selector:requireProtectedForm(form).controls[0].selector});
});
