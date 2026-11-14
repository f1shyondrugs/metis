import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {SavedBrowserLogins} from "../services/browser-login/core";
import {requireProtectedInput} from "../lib/protected-login-contract";

test("actual React sign-in: protected preparation, JSON POST login and private screenshots without weakening target checks",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"metis-signin-protected-"));
 let script:string;
 if(process.env.METIS_SIGNIN_FIXTURE)script=fs.readFileSync(process.env.METIS_SIGNIN_FIXTURE,"utf8");
 else{
  const require=createRequire(import.meta.url),{build}=createRequire(require.resolve("tsx"))("esbuild");
  const result=await build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import{SignInScreen}from"./components/sign-in-screen";createRoot(document.getElementById("root")).render(<SignInScreen onSignedIn={()=>{document.body.innerHTML="<h1 id=signed-in>Authenticated fixture</h1>";}}/>);',resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
  script=result.outputFiles[0].text;
 }
 const cert=path.join(dir,"cert.pem"),key=path.join(dir,"key.pem");
 execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",cert,"-days","1","-subj","/CN=portal.test"],{stdio:"ignore"});
 const received:Array<{method:string;url:string;body:string}>=[];
 const portal=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;
  if(req.url==="/api/auth"){
   received.push({method:req.method||"",url:req.url,body});
   assert.equal(req.method,"POST");
   res.writeHead(200,{"Content-Type":"application/json","Set-Cookie":"test-session=PRIVATE-SYNTHETIC-SESSION; Secure; HttpOnly; SameSite=Strict"});
   res.end('{"ok":true}');return;
  }
  if(req.url==="/app.js"){res.writeHead(200,{"Content-Type":"text/javascript"});res.end(script);return;}
  res.setHeader("Content-Type","text/html");
  if(req.url==="/unsafe"){res.end('<form method="post" action="https://other.test/auth"><input type="password"></form>');return;}
  if(req.url==="/get"){res.end('<form><input type="password"></form>');return;}
  res.end('<html><head><style>input,button{display:block;height:32px;margin:8px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 });
 await new Promise<void>(resolve=>portal.listen(0,"127.0.0.1",resolve));
 const sockets=new Set<net.Socket>(),proxy=http.createServer();
 proxy.on("connect",(req,client,head)=>{
  const incoming=client as net.Socket;
  if(req.url!=="portal.test:443"){incoming.destroy();return;}
  sockets.add(incoming);incoming.on("close",()=>sockets.delete(incoming));
  const upstream=net.connect((portal.address() as net.AddressInfo).port,"127.0.0.1",()=>{incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");if(head.length)upstream.write(head);incoming.pipe(upstream);upstream.pipe(incoming);});
  upstream.on("error",()=>incoming.destroy());incoming.on("error",()=>upstream.destroy());incoming.on("close",()=>upstream.destroy());
 });
 await new Promise<void>(resolve=>proxy.listen(0,"127.0.0.1",resolve));
 const core=new SavedBrowserLogins(randomBytes(32),path.join(dir,"vault.sqlite"),"http://127.0.0.1:"+(proxy.address() as net.AddressInfo).port);
 t.after(async()=>{await core.close();for(const s of sockets)s.destroy();await new Promise<void>(r=>proxy.close(()=>r()));await new Promise<void>(r=>portal.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true});});
 const call=(operation:string,input:Record<string,unknown>={},management=false,chat="login")=>core.dispatch({owner:"synthetic-owner",chat,operation,input},management);
 await t.test("the rendered form is accepted by the unchanged secure target validator",async()=>{
  const reply=await call("prepare",{url:"https://portal.test/",fields:["username","password"],usernameSelector:"#metis-username",selector:"#metis-password"});
  assert.equal(reply.status,"input_required");
  await call("fill",{requestId:requireProtectedInput(reply).requestId,username:"synthetic-user",password:"SYNTHETIC-ONLY-TEST-SECRET",persist:false},true);
 });
 await t.test("private screenshots and live-frame capture work after protected input",async()=>{
  for(const action of [{action:"screenshot"},{action:"form_state",includeScreenshot:true}]){
   const result=await call("action",action);
   assert.equal(Buffer.from(String(result.screenshot),"base64").subarray(0,2).toString("hex"),"ffd8");
   assert.equal(result.tabId,"protected");
  }
 });
 await t.test("React submission remains exactly one same-origin JSON POST",async()=>{
  await call("action",{action:"click",selector:'button[type="submit"]'});
  await call("action",{action:"wait_for",selector:"#signed-in"});
  assert.deepEqual(received,[{method:"POST",url:"/api/auth",body:JSON.stringify({username:"synthetic-user",password:"SYNTHETIC-ONLY-TEST-SECRET"})}]);
  const result=await call("action",{action:"extract_text",includeScreenshot:true});
  assert.match(String(result.snapshot),/Authenticated fixture/);
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC-ONLY-TEST-SECRET"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE-SYNTHETIC-SESSION"));
  assert.ok(result.screenshot);
 });
 await t.test("GET and foreign destinations remain unsafe; unrestricted exports stay unavailable",async()=>{
  for(const url of ["/get","/unsafe"]){
   await assert.rejects(call("prepare",{url:"https://portal.test"+url},false,url),error=>error instanceof Error&&"code"in error&&error.code==="unsafe_target");
  }
  for(const action of ["download","batch","upload_file"]){
   await assert.rejects(call("action",{action}),error=>error instanceof Error&&"code"in error&&error.code==="protected_action_unavailable");
  }
 });
});
