import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {chooseDesktopMonitor,desktopMonitorLabel,desktopMonitorLayout,type DesktopMonitor} from "../lib/remote-desktop-view";
const source=readFileSync("components/use-desktop-monitors.ts","utf8");
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const primary:DesktopMonitor={id:"p",name:"Main display",x:0,y:0,width:2560,height:1440,primary:true};
const left:DesktopMonitor={id:"left",name:"Left display",x:-1920,y:0,width:1920,height:1080,primary:false};
type Props={active:boolean;deviceId:string|null;unavailable:string|null;retry:number};
function harness(){
 const slots:any[]=[],effects=new Map<number,{deps:unknown[];cleanup?:()=>void}>(),timers=new Map<number,()=>unknown>();
 const listeners=new Set<()=>void>(),requests:Array<{deviceId:string;signal:AbortSignal}>=[];
 let cursor=0,nextTimer=0;
 const pending:Array<{id:number;run:()=>any;deps:unknown[]}>=[];
 let respond=(deviceId:string):Promise<Response>=>Promise.resolve(Response.json({monitors:deviceId==="a"?[left,primary]:[{...primary,id:"lcd",name:"Laptop"}],selectionSupported:true}));
 const react={
  useState:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return[slots[i],(value:any)=>{slots[i]=typeof value==="function"?value(slots[i]):value}]},
  useRef:(initial:any)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i]},
  useEffect:(run:()=>any,deps:unknown[])=>{pending.push({id:cursor++,run,deps})},
 };
 const document={hidden:false,addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)};
 const exports:any={};
 vm.runInNewContext(js,{exports,require:(name:string)=>name==="react"?react:{chooseDesktopMonitor},document,AbortController,JSON,Error,Array,
  setTimeout:(fn:()=>unknown)=>{const id=++nextTimer;timers.set(id,fn);return id},
  clearTimeout:(id:number)=>timers.delete(id),
  fetch:async(url:string,init:RequestInit)=>{const deviceId=decodeURIComponent(url.split("/")[3]);requests.push({deviceId,signal:init.signal as AbortSignal});return respond(deviceId)},
 });
 let props:Props={active:true,deviceId:"a",unavailable:null,retry:0},view:any;
 function render(next:Partial<Props>={}){
  props={...props,...next};cursor=0;pending.length=0;view=exports.useDesktopMonitors(props);
  for(const effect of pending){const previous=effects.get(effect.id);if(previous&&effect.deps.every((v,i)=>Object.is(v,previous.deps[i])))continue;previous?.cleanup?.();effects.set(effect.id,{deps:effect.deps,cleanup:effect.run()})}
  return view;
 }
 async function settle(){for(let i=0;i<15;i++)await Promise.resolve();return render()}
 function unmount(){for(const e of effects.values())e.cleanup?.()}
 render();
 return{render,settle,unmount,requests,timers,listeners,get view(){return view},respond:(next:typeof respond)=>{respond=next},refresh:async()=>{const [id,fn]=timers.entries().next().value!;timers.delete(id);await fn();return settle()}};
}
test("monitor selection uses stable native IDs and remembers each device separately",async()=>{
 const h=harness();try{
  assert.equal(h.view.ready,false);await h.settle();
  assert.equal(h.view.monitorId,"p","Primary takes precedence over returned ordering");
  h.view.selectMonitor("left");h.render();assert.equal(h.view.monitorId,"left");
  h.render({deviceId:"b"});assert.equal(h.view.ready,false);await h.settle();assert.equal(h.view.monitorId,"lcd");
  h.render({deviceId:"a"});await h.settle();assert.equal(h.view.monitorId,"left");
  assert.ok(h.requests.every(r=>r.deviceId==="a"||r.deviceId==="b"));
 }finally{h.unmount()}
 assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});
test("inventory refresh preserves selection across reordering and recovers after unplugging",async()=>{
 const h=harness();try{
  await h.settle();h.view.selectMonitor("left");h.render();
  h.respond(async()=>Response.json({monitors:[primary,left],selectionSupported:true}));
  await h.refresh();assert.equal(h.view.monitorId,"left");
  h.respond(async()=>Response.json({monitors:[primary],selectionSupported:true}));
  await h.refresh();assert.equal(h.view.monitorId,"p");
  assert.equal(h.timers.size,1);assert.equal(h.listeners.size,1);
 }finally{h.unmount()}
});
test("late inventory from the previous device cannot populate the new device",async()=>{
 const h=harness();try{
  await h.settle();let finish!:(response:Response)=>void;
  h.respond(()=>new Promise(resolve=>{finish=resolve}));
  h.render({deviceId:"slow"});
  const slow=h.requests.at(-1)!;
  h.respond(async()=>Response.json({monitors:[{...primary,id:"new"}],selectionSupported:true}));
  h.render({deviceId:"new"});await h.settle();
  assert.equal(slow.signal.aborted,true);assert.equal(h.view.monitorId,"new");
  finish(Response.json({monitors:[left],selectionSupported:true}));await h.settle();
  assert.equal(h.view.monitorId,"new");
 }finally{h.unmount()}
});
test("legacy clients retain primary preview without inventing a monitor list",async()=>{
 const h=harness();try{
  await h.settle();h.respond(async()=>Response.json({monitors:[],selectionSupported:false}));
  h.render({retry:1});await h.settle();
  assert.equal(h.view.ready,true);assert.equal(h.view.monitorId,null);assert.equal(h.view.monitors.length,0);
  assert.equal(h.view.selectionSupported,false);assert.equal(h.view.error,"");
 }finally{h.unmount()}
});
test("monitor enumeration failure is visible and cannot start a guessed capture",async()=>{
 const h=harness();try{
  await h.settle();h.respond(async()=>Response.json({error:"Desktop access disabled"},{status:403}));
  h.render({retry:1});await h.settle();
  assert.match(h.view.error,/access disabled/);assert.equal(h.view.monitorId,null);
 }finally{h.unmount()}
});
test("all displays preserve negative coordinates, offsets and mixed orientations",()=>{
 const portrait={...left,x:-1080,y:-400,width:1080,height:1920};
 const layout=desktopMonitorLayout([portrait,primary])!;
 assert.equal(layout.mode,"arrangement");
 assert.equal(layout.width,3640);assert.equal(layout.height,1920);
 assert.deepEqual(layout.tiles.map(({left,top,width,height})=>({left,top,width,height})),[
  {left:0,top:0,width:1080,height:1920},{left:1080,top:400,width:2560,height:1440}
 ]);
 assert.equal(desktopMonitorLayout([primary,left])?.mode,"arrangement","Touching edges do not overlap");
 assert.equal(desktopMonitorLayout([]),null);
});
test("all displays fall back to a complete grid when positions overlap or are missing",()=>{
 for(const monitors of [
  [primary,{...left,x:0,y:0},{...left,id:"third",x:0,y:0}],
  [primary,{...left,x:NaN}]
 ]){
  const layout=desktopMonitorLayout(monitors)!;
  assert.equal(layout.mode,"grid");
  assert.equal(layout.tiles.length,monitors.length);
  assert.deepEqual(layout.tiles.map(tile=>tile.monitor.id),monitors.map(monitor=>monitor.id));
  for(const tile of layout.tiles){
   assert.ok(tile.left>=0&&tile.top>=0&&tile.left+tile.width<=layout.width&&tile.top+tile.height<=layout.height);
  }
 }
});
test("monitor labels expose identity, resolution and primary status",()=>{
 assert.equal(desktopMonitorLabel(primary),"Main display · 2560 × 1440 · Primary");
 assert.equal(chooseDesktopMonitor([left,primary],"missing")?.id,"p");
 assert.equal(chooseDesktopMonitor([],null),null);
});
