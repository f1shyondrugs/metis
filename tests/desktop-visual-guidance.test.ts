import assert from "node:assert/strict";
import test from "node:test";
import {DESKTOP_VISUAL_GUIDANCE_PROMPT,OVERLAY_PRIMITIVE_GUIDANCE} from "../lib/mcp-core/desktop-guidance.mjs";
import {DEVICE_ROUTING_PROMPT,DEVICE_TOOL_DESCRIPTIONS} from "../lib/mcp-core/device-routing.mjs";
import {METIS_SHARED_AGENT_CONTROL} from "../lib/agent-control";
import {DESKTOP_OVERLAY_INPUT_SCHEMA,normalizeDesktopOverlay} from "../lib/mcp-core/desktop-overlay.mjs";

test("one visual guidance contract reaches provider instructions and canonical tool metadata",async()=>{
 assert.ok(DEVICE_ROUTING_PROMPT.includes(DESKTOP_VISUAL_GUIDANCE_PROMPT));
 assert.ok(METIS_SHARED_AGENT_CONTROL.includes(DESKTOP_VISUAL_GUIDANCE_PROMPT));
 assert.equal(METIS_SHARED_AGENT_CONTROL.split(DESKTOP_VISUAL_GUIDANCE_PROMPT).length,2,"do not duplicate the long policy per prompt");
 const schema=DESKTOP_OVERLAY_INPUT_SCHEMA;
 const items=schema.properties.items as {items:{properties:{type:{enum:string[];description:string}}}};
 assert.deepEqual(new Set(Object.keys(OVERLAY_PRIMITIVE_GUIDANCE)),new Set(items.items.properties.type.enum));
 for(const [type,description]of Object.entries(OVERLAY_PRIMITIVE_GUIDANCE)){
  assert.ok(items.items.properties.type.description.includes(type+": "+description));
 }
 assert.ok(DEVICE_TOOL_DESCRIPTIONS.desktop_overlay.length<=500);
});
test("actual schema accepts small passive marks and a clutter spotlight without inventing new overlay types",()=>{
 const base={client_id:"fixture-origin",display_id:"real-display-from-status",operation:"add"};
 const scenes=[
  [{id:"choice",type:"rect",x:120,y:140,width:210,height:120,color:"currentColor",strokeWidth:2,ttlMs:9000}],
  [{id:"direction",type:"arrow",x:40,y:200,width:80,height:40,ttlMs:9000}],
  [{id:"clutter",type:"spotlight",x:0,y:0,width:1200,height:800,opacity:.35,holes:[{x:120,y:140,width:210,height:120,shape:"rect"}],ttlMs:9000},{id:"label",type:"text",x:120,y:105,width:210,height:25,text:"Suggested option",ttlMs:9000}],
 ];
 for(const items of scenes){
  const original={...base,items};assert.deepEqual(normalizeDesktopOverlay(original,{tool:true}),{operation:original.operation,display_id:original.display_id,items:original.items});
  assert.ok(items.every(item=>item.ttlMs>0));assert.ok(!("interactive_id" in original));
 }
 assert.throws(()=>normalizeDesktopOverlay({...base,items:[{id:"fake",type:"dim",x:0,y:0,width:10,height:10}]},{tool:true}),/item type/);
 assert.throws(()=>normalizeDesktopOverlay({...base,items:[{id:"bad",type:"spotlight",x:0,y:0,width:10,height:10}]},{tool:true}),/requires holes/);
});
test("model-facing TTL preference does not silently rewrite explicit lifetime or scene ownership",()=>{
 const input={client_id:"fixture-origin",display_id:"native-display",operation:"add",items:[{id:"requested-persistent",group:"owned-scene",type:"rect",x:10,y:10,width:20,height:20,ttlMs:0}]};
 assert.deepEqual(normalizeDesktopOverlay(input,{tool:true}),{operation:input.operation,display_id:input.display_id,items:input.items},"policy is guidance, not a new lifetime override");
 assert.throws(()=>normalizeDesktopOverlay({...input,items:[{...input.items[0],ttlMs:-1}]},{tool:true}),/ttlMs/);
});
test("building guide/schema has no intent executor or automatic desktop side effects",async(t)=>{
 const fetch=t.mock.method(globalThis,"fetch",async()=>{throw Error("Unexpected desktop/network action");});
 for(const value of Object.values(await import("../lib/mcp-core/desktop-guidance.mjs")))assert.notEqual(typeof value,"function");
 assert.equal(fetch.mock.callCount(),0);
});
