import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDesktopOverlay, assertOverlayJson, summarizeDesktopOverlay, DESKTOP_OVERLAY_INPUT_SCHEMA } from "../lib/mcp-core/desktop-overlay.mjs";
import { hydrateDesktopOverlay, type OverlayItem, type OverlayState } from "../lib/desktop-overlay";
import { parseGraphDocument } from "../lib/graph-spec";
import { validateDesktopOverlayTarget } from "../lib/remote-security";

const rect = { id:"a",type:"rect",x:0,y:0,width:100,height:100 };
const card = (content: unknown) => ({ ...rect,type:"card",content });
const add = (items: unknown[] = [rect]) => ({operation:"add",display_id:"real-monitor",items});
const id = "12345678-1234-1234-1234-123456789abc";
test("canonical operations require explicit monitor IDs except status and clear-all", () => {
  assert.deepEqual(normalizeDesktopOverlay({operation:"status"}),{operation:"status"});
  assert.deepEqual(normalizeDesktopOverlay({operation:"clear",all:true}),{operation:"clear",all:true});
  for (const operation of ["add","replace","update","remove","clear","undo","interact"]) {
    assert.throws(() => normalizeDesktopOverlay({operation}),/display_id/);
  }
  for (const value of [
    {operation:"clear",all:true,display_id:"x"},
    {operation:"undo",display_id:"x",all:true},
    {operation:"remove",display_id:"x",ids:["a"],group:"g"},
    {operation:"remove",display_id:"x",ids:[]},
    {operation:"interact",display_id:"x"},
    {operation:"update",display_id:"x",items:[{id:"a",text:"patch"}]},
    {...add(),client_id:"other"},
  ]) assert.throws(() => normalizeDesktopOverlay(value));
  assert.deepEqual(normalizeDesktopOverlay({client_id:"exact-client",...add()}, {tool:true}), add());
  assert.throws(() => normalizeDesktopOverlay(add(),{tool:true}),/client_id/);
  for (const command of [
    {operation:"replace",display_id:"x",items:[]},
    {operation:"update",display_id:"x",items:[rect]},
    {operation:"remove",display_id:"x",group:"g"},
    {operation:"remove",display_id:"x",ids:["a"]},
    {operation:"interact",display_id:"x",interactive_id:null},
    {operation:"undo",display_id:"x"},
  ]) assert.deepEqual(normalizeDesktopOverlay(command),command);
  assert.ok(DESKTOP_OVERLAY_INPUT_SCHEMA.required.includes("client_id"));
});
test("bounds, full items, duplicate IDs and ttl are enforced without truncation", () => {
  for (const item of [
    {...rect,x:NaN},{...rect,width:-1},{...rect,opacity:1.1},{...rect,ttlMs:-1},
    {...rect,ttlMs:3600001},{...rect,ttlMs:0.1},{...rect,text:"x".repeat(100001)},
    {...rect,points:[{x:0,y:0}]},{...rect,points:Array(1025).fill({x:0,y:0})},
    {...rect,type:"path"},{...rect,type:"spotlight",holes:Array(17).fill({x:0,y:0,width:1,height:1,shape:"rect"})},
    {...rect,content:{kind:"html",source:"ignored"}},
    {...rect,url:"https://evil.invalid"},{...rect,fill:"url(https://evil.invalid)"},
  ]) assert.throws(() => normalizeDesktopOverlay(add([item])));
  assert.throws(() => normalizeDesktopOverlay(add([rect,rect])),/duplicate/);
  assert.throws(() => normalizeDesktopOverlay(add(Array.from({length:101},(_,i)=>({...rect,id:String(i)})))),/100/);
  assert.throws(() => normalizeDesktopOverlay(add(Array.from({length:12},(_,i)=>({...rect,id:String(i),text:"x".repeat(99000)})))),/1 MiB/);
  for (const ttlMs of [0,3600000]) assert.equal((normalizeDesktopOverlay(add([{...rect,ttlMs}])).items as OverlayItem[])[0].ttlMs,ttlMs);
  assert.equal(Object.hasOwn((normalizeDesktopOverlay(add()).items as OverlayItem[])[0],"ttlMs"),false);
});
test("malformed, prototype, accessor and deeply nested inputs fail closed", () => {
  let accessed = false;
  const getter = Object.defineProperty({}, "operation", {enumerable:true,get(){accessed=true;return "status";}});
  const cycle: Record<string,unknown> = {}; cycle.self=cycle;
  for (const value of [
    null,[],new Date(),add(new Array(1)),Object.assign(Object.create({bad:true}),{operation:"status"}),
    JSON.parse('{"operation":"status","__proto__":{}}'),
    JSON.parse('{"operation":"status","constructor":{}}'),getter,cycle,
    {operation:"status",value:undefined},{operation:"status",value:1n},
  ]) assert.throws(() => normalizeDesktopOverlay(value));
  assert.equal(accessed,false);
  let deep:unknown = {}; for(let i=0;i<35;i++)deep={nested:deep};
  assert.throws(()=>assertOverlayJson(deep),/nesting/);
});
test("file input only accepts exact upload IDs and hydration uses the supplied owner", () => {
  const calls: string[][] = [];
  const resolve = (owner:string,upload:string) => {
    calls.push([owner,upload]);
    if(owner !== "owner-a")throw new Error("Upload not found");
    return {id:upload,name:"owned.pdf",mimeType:"application/pdf",size:42,kind:"file" as const};
  };
  const command = add([card({kind:"file",file:{id}})]);
  const result = hydrateDesktopOverlay(command,"owner-a",resolve) as {items:OverlayItem[]};
  assert.deepEqual(calls,[["owner-a",id]]);
  assert.deepEqual(result.items[0].content?.file,{url:"/api/file-uploads/"+id+"/file",name:"owned.pdf",mimeType:"application/pdf",size:42});
  assert.throws(()=>hydrateDesktopOverlay(command,"owner-b",resolve),/not found/);
  assert.throws(()=>hydrateDesktopOverlay(command,"",resolve),/account/);
  for(const file of [
    {url:"https://evil.invalid/file"},{id,url:"/api/file-uploads/"+id+"/file"},
    {id:"/api/uploads/other/private.pdf"},{id:"file:///etc/passwd"},{id:"C:\\private.pdf"},
    {id:"https://evil.invalid"},{id,path:"/root/private"},{id,ownerId:"owner-b"},
  ]) assert.throws(()=>hydrateDesktopOverlay(add([card({kind:"file",file})]),"owner-a",resolve));
  assert.throws(()=>hydrateDesktopOverlay(command,"owner-a",()=>({...resolve("owner-a",id),id:"different"})),/mismatch/);
  // Hydration is not a route for already hydrated/foreign URLs.
  assert.throws(()=>hydrateDesktopOverlay(result,"owner-a",resolve));
});
test("graph/chart content uses existing parsers and strips unrecognized spec fields", () => {
  const resolve = () => {throw new Error("unexpected file");};
  const graph = hydrateDesktopOverlay(add([card({kind:"graph",spec:{elements:[{type:"function",fn:"sin(x)"}],url:"https://evil.invalid"}})]),"owner",resolve) as {items:OverlayItem[]};
  assert.deepEqual(graph.items[0].content?.spec,JSON.parse(JSON.stringify(parseGraphDocument(JSON.stringify({elements:[{type:"function",fn:"sin(x)"}]})))));
  assert.throws(()=>hydrateDesktopOverlay(add([card({kind:"graph",source:'{"elements":[]} '})]),"owner",resolve));
  assert.throws(()=>hydrateDesktopOverlay(add([card({kind:"chart",spec:{type:"invalid"}})]),"owner",resolve));
  const chart = hydrateDesktopOverlay(add([card({kind:"chart",source:JSON.stringify({type:"bar",x:["A"],series:[{name:"N",values:[1]}]})})]),"owner",resolve) as {items:OverlayItem[]};
  assert.ok(chart.items[0].content?.spec);
});
test("overlay target requires owner, GUI, capability and explicit Computer Use permission", () => {
  const client = {ownerId:"a",status:"online",capabilities:["desktop_gui","overlay_annotations"],policy:{permissions:["computer_use"]}};
  assert.equal(validateDesktopOverlayTarget(client,"a").allowed,true);
  for(const [target,owner] of [
    [client,"b"],[client,""],[{...client,status:"revoked"},"a"],
    [{...client,capabilities:["desktop_gui"]},"a"],[{...client,capabilities:["overlay_annotations"]},"a"],
    [{...client,policy:{permissions:[]}},"a"],
  ] as const) assert.equal(validateDesktopOverlayTarget(target,owner).allowed,false);
  assert.match(validateDesktopOverlayTarget({...client,capabilities:["desktop_gui"]},"a").reason!,/update needed/);
});
test("audits contain metadata, not HTML/file contents; web types expose canonical state", () => {
  const summary = summarizeDesktopOverlay(add([card({kind:"html",source:"PRIVATE HTML"})]));
  assert.equal(JSON.stringify(summary).includes("PRIVATE"),false);
  assert.deepEqual(summary,{operation:"add",display_id:"real-monitor",itemCount:1,ids:["a"]});
  const state:OverlayState={revision:1,items:[rect as OverlayItem],display:{id:"monitor",width:1920,height:1080},interactiveId:null};
  assert.equal(state.display.width,1920);
});
