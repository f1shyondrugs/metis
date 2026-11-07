import {requireProtectedInput} from "../lib/protected-login-contract";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {SavedBrowserLogins} from "../services/browser-login/core";
import {signBrowserUserAction,verifyBrowserUserAction} from "../lib/browser-user-capability";
import {browserLoginSameOrigin} from "../lib/browser-login-client";

test("real HTTPS browser: secure input, encrypted save, automatic per-owner/per-origin reuse, update/delete and no model secret",async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-saved-login-test-"));
  const cert=path.join(dir,"cert.pem"),keyFile=path.join(dir,"cert.key");
  execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyFile,"-out",cert,"-days","1","-subj","/CN=portal.test"],{stdio:"ignore"});
  let received="",receivedFields:Record<string,string>={},publicReads=0;
  const portal=https.createServer({key:fs.readFileSync(keyFile),cert:fs.readFileSync(cert)},async(req,res)=>{
    res.setHeader("Content-Type","text/html");
    if(req.method==="POST") {
      let body="";for await(const chunk of req)body+=chunk;
      received=new URLSearchParams(body).get("password")||"";
      receivedFields=Object.fromEntries(new URLSearchParams(body));
      if(req.url==="/sso-login"){res.writeHead(302,{Location:"https://other.test/after-sso?code=TEST-SSO-AUTH-CODE"});res.end();return;}
      if(req.url==="/continue"){res.end('<form action="/login" method="post"><input id="password" type="password" name="password"><button id="submit">Login</button></form>');return;}
      res.setHeader("Set-Cookie","auth=TEST-ONLY-SESSION-COOKIE; HttpOnly; Secure");
      res.end(`<h1>Logged in</h1><p>${received}</p><p>TEST-ONLY-SESSION-COOKIE</p>`);
    }else if(req.url?.startsWith('/school-data.js')){publicReads++;res.setHeader('Content-Type','application/javascript');res.end('window.schoolDataReady=true');}
    else if(req.url?.startsWith('/sso-app.js')){res.setHeader('Content-Type','application/javascript');res.end('if(window.schoolDataReady)document.body.innerHTML="<h1 id=task-ready>SSO_TASK_READY</h1>"');}
    else if(req.url?.startsWith('/after-sso'))res.end('<h1>SSO_LOADING</h1><script src="https://public.test/school-data.js"></script><script src="/sso-app.js"></script>');
    else if(req.url?.startsWith('/sso-choose'))res.end('<button id="select-campus" onclick="location.href=\'/sso-login\'+location.search">Select test campus</button><form hidden action="/sso-login" method="post"><input name="username"><input name="password" type="password"></form>');
    else if(req.url?.startsWith('/sso-login'))res.end('<script src="https://public.test/school-data.js"></script><form action="/sso-login" method="post"><input name="username"><input name="password" type="password"><button id="submit">Login</button></form>');
    else if(req.url?.startsWith('/delayed-login'))res.end('<form id="login_form" style="display:none" action="/login" method="post"><input id="username2" name="user2"><input id="inputPassword" name="password" type="password"><button id="submit">Login</button></form><script>setTimeout(()=>document.getElementById("login_form").style.display="block",600)</script>');
    else if(req.url?.startsWith('/identifier-step'))res.end('<form action="/continue" method="post"><input id="email" name="email" type="email"><button id="next">Next</button></form>');
    else if(req.url?.startsWith('/identity'))res.end('<form action="/login" method="post"><input id="username" name="username"><input id="email" name="email" type="email"><input id="password" name="password" type="password"><button id="submit">Login</button></form>');
    else if(req.url?.startsWith('/step-one'))res.end('<form action="/login"><input id="username" name="username"><button id="next">Next</button></form>');
    else if(req.url?.startsWith('/unsafe'))res.end('<form action="https://other.test/login" method="post"><input id="password" type="password"></form>');
    else res.end('<form action="/login" method="post"><input id="username" name="username"><input id="password" name="password" type="password"><button id="submit">Login</button></form>');
  });
  await new Promise<void>(resolve=>portal.listen(0,"127.0.0.1",resolve));
  const targetPort=(portal.address() as net.AddressInfo).port;
  const proxy=http.createServer();
  const sockets=new Set<net.Socket>();
  proxy.on("connect",(req,client,head)=>{
    const incoming=client as net.Socket;sockets.add(incoming);incoming.on("close",()=>sockets.delete(incoming));
    if(!["portal.test:443","other.test:443","public.test:443"].includes(req.url!)){incoming.destroy();return;}
    const upstream=net.connect(targetPort,"127.0.0.1",()=>{incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");if(head.length)upstream.write(head);incoming.pipe(upstream);upstream.pipe(incoming);});
    upstream.on("error",()=>incoming.destroy());incoming.on("error",()=>upstream.destroy());incoming.on("close",()=>upstream.destroy());
  });
  await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
  const proxyUrl=`http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
  const key=randomBytes(32),database=path.join(dir,"logins.sqlite"),password="TEST-ONLY-Never-In-The-Model-9842";
  let core=new SavedBrowserLogins(key,database,proxyUrl);
  t.after(async()=>{await core.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));await new Promise<void>(resolve=>portal.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});});
  const call=(operation:string,input:Record<string,unknown>={},management=false,owner="alice",chat="chat")=>core.dispatch({owner,chat,operation,input},management);
  const first=await call("prepare",{url:"https://portal.test/login",selector:"#password"});
  assert.equal(first.status,"input_required");assert.equal(requireProtectedInput(first).origin,"https://portal.test");
  await assert.rejects(call("fill",{requestId:requireProtectedInput(first).requestId,password},true,"bob"));
  await assert.rejects(call("fill",{requestId:requireProtectedInput(first).requestId,password},false));
  assert.equal((await call("fill",{requestId:requireProtectedInput(first).requestId,password,persist:true},true)).status,"filled_and_saved");
  await assert.rejects(call("fill",{requestId:requireProtectedInput(first).requestId,password},true));
  const form=await call("action",{action:"form_state"});assert(!JSON.stringify(form).includes(password));assert(JSON.stringify(form).includes("REDACTED"));
  await assert.rejects(call("action",{action:"screenshot"}));await assert.rejects(call("action",{action:"download",url:"https://portal.test/login"}));
  await assert.rejects(call("user_frame",{},true),'No screenshot export, even through an impersonated browser session');
  await call("action",{action:"click",selector:"#submit"});assert.equal(received,password);
  const text=await call("action",{action:"extract_text"});assert(!JSON.stringify(text).includes(password));assert(!JSON.stringify(text).includes("TEST-ONLY-SESSION-COOKIE"));
  assert.deepEqual((await call("list",{},true)).credentials?.map((site:{origin:string})=>site.origin),["https://portal.test"]);
  await core.close();core=new SavedBrowserLogins(key,database,proxyUrl);
  assert(!fs.readFileSync(database).includes(Buffer.from(password)));
  assert.equal((await call("prepare",{url:"https://portal.test/login",selector:"#password"})).status,"filled_saved");
  assert.equal((await call("prepare",{url:"https://portal.test/login",selector:"#password"},false,"bob")).status,"input_required");
  assert.equal((await call("prepare",{url:"https://other.test/login",selector:"#password"},false,"alice","other-chat")).status,"input_required");
  await call("update",{origin:"https://portal.test",password:"TEST-ONLY-NEW-PASSWORD"},true);
  assert.equal((await call("prepare",{url:"https://portal.test/login",selector:"#password"})).status,"filled_saved");
  await call("action",{action:"click",selector:"#submit"});assert.equal(received,"TEST-ONLY-NEW-PASSWORD");
  await call("delete",{origin:"https://portal.test"},true);
  assert.equal((await call("prepare",{url:"https://portal.test/login",selector:"#password"})).status,"input_required");
  assert.deepEqual((await call("list",{},true)).credentials,[]);
  await call("close");
  assert.equal((await call("prepare",{url:"https://portal.test/step-one"})).status,"protected_browser_ready");
  await call("action",{action:"type",selector:"#username",text:"alice"});
  await call("action",{action:"click",selector:"#next"});
  const stepped=await call("prepare",{selector:"#password"});assert.equal(stepped.status,"input_required");
  await assert.rejects(call("action",{action:"navigate",url:"https://other.test/login"}));
  const realNow=Date.now;t.mock.method(Date,"now",()=>realNow()+6*60_000);
  await assert.rejects(call("fill",{requestId:requireProtectedInput(stepped).requestId,password},true));
  t.mock.restoreAll();
  await assert.rejects(call("prepare",{url:"https://portal.test/unsafe",selector:"#password"},false,"carol","unsafe-chat"));
  const identity={password:"TEST-IDENTITY-PASSWORD",username:"TEST-IDENTITY-NAME",email:"TEST-IDENTITY@example.test"};
  const identityRequest=await call("prepare",{url:"https://portal.test/identity",fields:["password","username","email"]},false,"dave","identity-chat");
  await call("fill",{requestId:requireProtectedInput(identityRequest).requestId,...identity,persist:true},true,"dave","identity-chat");
  const identityForm=await call("action",{action:"form_state"},false,"dave","identity-chat");
  for(const value of Object.values(identity))assert(!JSON.stringify(identityForm).includes(value));
  await call("action",{action:"click",selector:"#submit"},false,"dave","identity-chat");assert.deepEqual(receivedFields,identity);
  const email="TEST-CHAT-IDENTIFIER@example.test";
  const emailRequest=await call("prepare",{url:"https://portal.test/identifier-step",fields:["email"]},false,"fred","steps");
  assert.equal(emailRequest.status,"input_required");assert.deepEqual(requireProtectedInput(emailRequest).fields,["email"]);
  await call("fill",{requestId:requireProtectedInput(emailRequest).requestId,email,persist:false},true,"fred","steps");
  await call("action",{action:"click",selector:"#next"},false,"fred","steps");assert.equal(receivedFields.email,email);
  const nextPassword=await call("prepare",{},false,"fred","steps");
  await call("fill",{requestId:requireProtectedInput(nextPassword).requestId,password:"TEST-STEP-PASSWORD",persist:true},true,"fred","steps");
  await core.close();core=new SavedBrowserLogins(key,database,proxyUrl);
  assert.equal((await call("prepare",{url:"https://portal.test/identity",fields:["password","username","email"]},false,"dave","new-chat")).status,"filled_saved");
  assert.equal((await call("prepare",{url:"https://portal.test/identity",fields:["password","username","email"]},false,"eve","foreign-chat")).status,"input_required");
  assert.equal((await call("prepare",{url:"https://portal.test/identifier-step",fields:["email"]},false,"fred","new-steps")).status,"input_required");
  const dynamic=await call("prepare",{url:"https://portal.test/delayed-login",fields:["username","password"]},false,"alice","dynamic");
  assert.equal(dynamic.status,"input_required");
  await call("fill",{requestId:requireProtectedInput(dynamic).requestId,username:"TEST-DYNAMIC-USER",password:"TEST-DYNAMIC-PASSWORD",persist:false},true,"alice","dynamic");
  await call("action",{action:"click",selector:"#submit"},false,"alice","dynamic");
  assert.deepEqual(receivedFields,{user2:"TEST-DYNAMIC-USER",password:"TEST-DYNAMIC-PASSWORD"});
  assert.equal((await call("prepare",{url:"https://portal.test/delayed-login"},false,"alice","dynamic-password-only")).status,"input_required");
  const redirect=Buffer.from("https://other.test/after-sso").toString("base64");
  const ssoStart=`https://portal.test/sso-choose?url=${encodeURIComponent(redirect)}`;
  const ssoChooser=await call("prepare",{url:ssoStart,fields:["username","password"]},false,"sso","sso-chat");
  assert.equal(ssoChooser.status,"protected_browser_ready");
  assert.deepEqual([...(ssoChooser.missingFields ?? [])].sort(),["password","username"]);
  assert.equal(ssoChooser.secureInput,undefined);
  await call("action",{action:"click",selector:"#select-campus"},false,"sso","sso-chat");
  // Retrying with the stale ordinary URL must preserve both private school
  // selection and the return origins declared when this session was created.
  const sso=await call("prepare",{url:ssoStart,fields:["username","password"]},false,"sso","sso-chat");
  assert.equal(sso.status,"input_required");
  assert.equal(publicReads,1);
  const ssoPassword="TEST-SSO-PASSWORD:/+";
  await call("fill",{requestId:requireProtectedInput(sso).requestId,username:"TEST-SSO-USER",password:ssoPassword,persist:false},true,"sso","sso-chat");
  const signedIn=await call("action",{action:"click",selector:"#submit"},false,"sso","sso-chat");
  assert.equal(signedIn.url,"https://other.test/after-sso");assert(!JSON.stringify(signedIn).includes("TEST-SSO-AUTH-CODE"));
  await call("action",{action:"wait_for",selector:"#task-ready"},false,"sso","sso-chat");
  const task=await call("action",{action:"extract_text"},false,"sso","sso-chat");
  assert.match(task.snapshot ?? "",/SSO_TASK_READY/);assert(!JSON.stringify(task).includes(ssoPassword));
  assert.equal(publicReads,1,"public resource must be replayed locally after password entry, never requested again");
  await assert.rejects(call("action",{action:"navigate",url:"https://unapproved.test/"},false,"sso","sso-chat"));
  for(const leaked of [ssoPassword,encodeURIComponent(ssoPassword),Buffer.from(ssoPassword).toString("base64"),Buffer.from(ssoPassword).toString("hex")]){
    await assert.rejects(call("action",{action:"navigate",url:`https://other.test/leak?password=${leaked}`},false,"sso","sso-chat"));
  }
  await call("close",{},false,"sso","sso-chat");
  const lateChooser=await call("prepare",{url:"https://portal.test/sso-choose",fields:["username","password"]},false,"unseeded","late-selection");
  assert.equal(lateChooser.status,"protected_browser_ready");
  await call("action",{action:"navigate",url:`https://portal.test/sso-login?url=${encodeURIComponent(redirect)}`},false,"unseeded","late-selection");
  assert.equal((await call("prepare",{url:ssoStart,fields:["username","password"]},false,"unseeded","late-selection")).status,"input_required");
  // Neither a later selection URL nor a new prepare handoff may expand the
  // origins approved when the private context was first created.
  await assert.rejects(call("action",{action:"navigate",url:"https://other.test/after-sso"},false,"unseeded","late-selection"));
  for(const value of [...Object.values(identity),email])assert(!fs.readFileSync(database).includes(Buffer.from(value)));
});

test("internal bearer is insufficient to forge authenticated user browser actions",()=>{
  const action={action:"click",selector:"#submit",source:"user"};
  const signature=signBrowserUserAction("alice","chat",action);
  assert(verifyBrowserUserAction("alice","chat",action,signature));
  assert(!verifyBrowserUserAction("bob","chat",action,signature));
  assert(!verifyBrowserUserAction("alice","other",action,signature));
  assert(!verifyBrowserUserAction("alice","chat",{...action,selector:"#different"},signature));
  assert(!verifyBrowserUserAction("alice","chat",action,"TEST-BEARER"));
});

test("secure form CSRF uses actual Host behind the custom Next server without trusting forwarded headers",()=>{
  const request=(origin:string,host="192.0.2.10:3100",forwarded="")=>new Request("http://localhost:3100/api/browser/secure-input",{headers:{origin,host,"x-forwarded-host":forwarded}});
  assert(browserLoginSameOrigin(request("http://192.0.2.10:3100")));
  assert(!browserLoginSameOrigin(request("https://attacker.example")));
  assert(!browserLoginSameOrigin(request("https://attacker.example","192.0.2.10:3100","attacker.example")));
  assert(!browserLoginSameOrigin(request("null")));
});
