import assert from "node:assert/strict";
import test from "node:test";
import type {DesktopCapture} from "../lib/desktop-assistant";
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test("screen uploads use canonical parallel pump and preserve monitor ordering",async()=>{
 const {uploadAssistantScreens}=await import("../lib/assistant-screen-uploads");
 const original=globalThis.fetch;let active=0,max=0,next=0;const names=new Map<string,string>();
 globalThis.fetch=(async(input,init)=>{
  const url=String(input);
  if(url.startsWith("data:"))return new Response(new Blob(["pixels"],{type:"image/png"}));
  if(url==="/api/file-uploads"){const id="parallel-"+next++;names.set(id,JSON.parse(String(init?.body)).name);return Response.json({id});}
  const id=url.split("/").pop()!;
  if(init?.method==="POST"){active++;max=Math.max(max,active);await pause(id.endsWith("0")?40:5);active--;return Response.json({id,name:names.get(id),kind:"image"});}
  return Response.json({offset:999999});
 }) as typeof fetch;
 try{
  const monitors=Array.from({length:6},(_,i)=>({id:"monitor-"+i,name:"m",primary:i===0,bounds:{x:i*100,y:0,width:100,height:100},scaleFactor:1,image:"data:image/png;base64,eA=="})) satisfies DesktopCapture["monitors"];
  const result=await uploadAssistantScreens(monitors,()=>false);
  assert.deepEqual(result.ids,Array.from({length:6},(_,i)=>"parallel-"+i));assert.equal(max,2);assert.equal(result.tasks.length,6);
  let cancelled=true;await assert.rejects(uploadAssistantScreens(monitors,()=>cancelled),/cancelled/);assert.equal(next,6);cancelled=false;
 }finally{globalThis.fetch=original;}
});
test("a failed upload drains the batch and cannot submit a partial monitor list",async()=>{
 const {uploadAssistantScreens}=await import("../lib/assistant-screen-uploads"),{getUploadSnapshot}=await import("../lib/background-uploads");
 const original=globalThis.fetch;let n=0;
 globalThis.fetch=(async(input,init)=>{
  const url=String(input);if(url.startsWith("data:"))return new Response("pixels");
  if(url==="/api/file-uploads")return Response.json({id:"failure-"+n++});
  if(init?.method==="DELETE")return Response.json({});
  if(url.endsWith("failure-0"))return Response.json({error:"fixture failure"},{status:500});
  if(init?.method==="POST")return Response.json({id:url.split("/").pop(),kind:"image"});
  return Response.json({offset:99999});
 }) as typeof fetch;
 try{
  const m={id:"m",name:"m",primary:true,bounds:{x:0,y:0,width:1,height:1},scaleFactor:1,image:"data:x"};
  await assert.rejects(uploadAssistantScreens([m,m,m],()=>false),/Screen upload failed/);
  const after=n;await pause(30);assert.equal(n,after);
  assert.ok(getUploadSnapshot().every(t=>!["queued","uploading"].includes(t.status)));
 }finally{globalThis.fetch=original;}
});
test("a cancelled asynchronous capture cannot start late uploads",async()=>{
 const {uploadAssistantScreens}=await import("../lib/assistant-screen-uploads");const original=globalThis.fetch;
 let cancel=false,created=0;
 globalThis.fetch=(async(input)=>{if(String(input).startsWith("data:")){await pause(10);cancel=true;return new Response("pixels");}created++;throw Error("unexpected upload");}) as typeof fetch;
 try{
  const m={id:"m",name:"m",primary:true,bounds:{x:0,y:0,width:1,height:1},scaleFactor:1,image:"data:x"};
  await assert.rejects(uploadAssistantScreens([m,m],()=>cancel),/cancelled/);await pause(20);assert.equal(created,0);
 }finally{globalThis.fetch=original;}
});
