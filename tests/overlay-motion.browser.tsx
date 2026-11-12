/** Actual components, synthetic bridge/data only. No native or account actions. */
import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopOverlay,type OverlayItem,type OverlayState} from "../components/desktop-overlay";

// Exercise live accessibility changes without changing the host OS preference.
// The same hook drives the renderer's CSS flag and the graph RAF cancellation.
const nativeMatchMedia=window.matchMedia.bind(window),mediaEvents=new EventTarget();
let reduced=false;
const media={get matches(){return reduced;},media:"(prefers-reduced-motion: reduce)",onchange:null,
 addEventListener:mediaEvents.addEventListener.bind(mediaEvents),removeEventListener:mediaEvents.removeEventListener.bind(mediaEvents),
 dispatchEvent:mediaEvents.dispatchEvent.bind(mediaEvents),addListener:()=>{},removeListener:()=>{}} as MediaQueryList;
window.matchMedia=query=>query===media.media?media:nativeMatchMedia(query);
const setReduced=(value:boolean)=>{reduced=value;mediaEvents.dispatchEvent(new Event("change"));};
const width=innerWidth,height=innerHeight;
const appearance={version:1,mode:"dark",variables:{"--background":"#151719","--foreground":"#f4f4f5","--border":"#555b64","--muted":"#272b30","--primary":"#60a5fa"}};
const box:OverlayItem={id:"box",type:"rect",x:28,y:110,width:Math.min(290,width-80),height:90,radius:12,color:"#60a5fa",strokeWidth:3};
const shapes:OverlayItem[]=[
 {id:"dim",type:"spotlight",x:0,y:0,width,height,opacity:.6,holes:[{x:18,y:100,width:Math.min(310,width-60),height:110,shape:"rect",radius:14}]},
 box,
 {id:"circle",type:"ellipse",x:35,y:230,width:70,height:60,color:"#34d399",strokeWidth:3},
 {id:"arrow",type:"arrow",x:130,y:250,width:150,height:55,points:[{x:130,y:250},{x:280,y:305}],color:"#fb923c",strokeWidth:3},
 {id:"line",type:"line",x:28,y:340,width:240,height:1,color:"#fbbf24",strokeWidth:3},
 {id:"path",type:"path",x:28,y:380,width:270,height:30,points:[{x:28,y:395},{x:70,y:380},{x:120,y:405},{x:210,y:385},{x:298,y:395}],color:"#c4b5fd",strokeWidth:3},
 {id:"highlight",type:"highlight",x:28,y:440,width:Math.min(290,width-60),height:34,color:"#fbbf24",opacity:.3},
 {id:"label",type:"text",x:36,y:447,width:260,height:45,fontSize:16,text:"One clear next step",color:"#f4f4f5"},
];
function graph(a:number,fn="a*x^2"):OverlayItem {
 return {id:"graph",type:"card",x:16,y:80,width:Math.min(680,width-32),height:Math.min(500,height-130),text:"Live curve transition",
 content:{kind:"graph",spec:{title:"y = a × x²",bounds:[-4,4,-1,10],elements:[{type:"slider",name:"a",min:.25,max:3,value:a,step:.25},{type:"function",fn,color:"#60a5fa",width:3}]}}};
}
const note:OverlayItem={id:"note",type:"card",x:16,y:80,width:Math.min(540,width-32),height:260,text:"Gentle entrance",opacity:.75,content:{kind:"markdown",source:"# A calm transition\n\nOnly new content enters. Existing content stays in place."}};
let scene:OverlayState={revision:1,items:[],display:{id:"synthetic",width,height},interactiveId:null,appearance};
let listener:((state:OverlayState)=>void)|undefined,clearDelay=0;
const publish=(items:OverlayItem[],interactiveId:string|null=null)=>{scene={...scene,items,interactiveId,revision:scene.revision+1};listener?.(scene);};
Object.assign(window,{metisOverlay:{
 state:async()=>scene,onState:(callback:(state:OverlayState)=>void)=>{listener=callback;return()=>{listener=undefined;};},
 clear:async()=>{await pause(clearDelay);publish([]);},interact:async(id:string|null)=>publish(scene.items,id),
 remove:async(id:string)=>publish(scene.items.filter(item=>item.id!==id)),undo:async()=>{},
}});
const background=document.createElement("div");background.style.cssText="position:fixed;inset:0;background:#20262f;color:#e5e7eb;padding:26px;font:14px system-ui";
background.innerHTML='<h1 style="font-size:18px">Overlay motion · synthetic preview</h1><div style="position:absolute;top:110px;left:28px;padding:24px;background:#303b49;border-radius:12px">Focus stays on the next action</div>';
document.body.append(background);
const host=document.createElement("div");document.body.append(host);createRoot(host).render(<DesktopOverlay/>);
const report=document.createElement("pre");report.id="motion-results";report.style.cssText="position:fixed;right:12px;bottom:12px;max-width:calc(100vw - 24px);max-height:145px;overflow:auto;background:#151719;color:#d1fae5;padding:10px;font:11px monospace;z-index:1000;pointer-events:none";document.body.append(report);
const results:string[]=[],samples:Record<string,unknown>={};
function check(ok:unknown,label:string){results.push((ok?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!ok)document.body.dataset.failed="true";}
function pause(ms=60){return new Promise(resolve=>setTimeout(resolve,ms));}
async function frames(n=2){for(let i=0;i<n;i++)await new Promise(requestAnimationFrame);}
const shape=(id:string)=>document.querySelector<SVGSVGElement>('[data-overlay-shape="'+id+'"]')!;
const curve=()=>document.querySelector<SVGPathElement>('[data-overlay-card="graph"] path[stroke="#60a5fa"]');
async function waitCurve(){for(let i=0;i<100&&!curve();i++)await pause(30);samples.graphDrawAnimations=curve()?.getAnimations().length;await pause(600);return curve();}
function seek(el:Element,time:number){
 const animations=el.getAnimations();for(const animation of animations){animation.pause();animation.currentTime=time;}return animations;
}
function finishAnimations(){for(const animation of document.getAnimations()){animation.pause();animation.currentTime=Number(animation.effect?.getComputedTiming().endTime)||1000;}}
function opacity(el:Element){return Number(getComputedStyle(el).opacity);}
async function run(){
 await pause(250);
 publish(shapes);await frames(3);
 const rect=shape("box").querySelector("rect")!,ellipse=shape("circle").querySelector("ellipse")!,arrow=shape("arrow").querySelector("line")!;
 for(const [el,label] of [[rect,"box"],[ellipse,"ellipse"],[arrow,"arrow"],[shape("line").querySelector("line")!,"underline"],[shape("path").querySelector("polyline")!,"freehand"]] as const){
  const animations=seek(el,0),start=parseFloat(getComputedStyle(el).strokeDashoffset);seek(el,230);const mid=parseFloat(getComputedStyle(el).strokeDashoffset);seek(el,460);const end=parseFloat(getComputedStyle(el).strokeDashoffset);
  samples[label]={start,mid,end};check(animations.length===1&&start>.99&&mid>0&&mid<1&&end===0,label+" progressively draws its actual stroke");
 }
 const head=shape("arrow").querySelector("marker path")!;
 seek(head,0);const headStart=opacity(head);seek(head,460);check(headStart===0&&opacity(head)===1,"arrow head waits for the drawn shaft");
 for(const [el,label,endTime,target] of [[shape("dim").querySelector("g")!,"dimming",420,.6],[shape("highlight").querySelector("rect")!,"highlight",280,.3],[shape("label").querySelector("text")!,"text",180,1]] as const){
  seek(el,0);const start=opacity(el);seek(el,endTime/2);const mid=opacity(el);seek(el,endTime);const end=opacity(el);
  samples[label]={start,mid,end};check(start===0&&mid>0&&mid<target&&Math.abs(end-target)<.001,label+" softly fades to its configured opacity");
 }
 check(getComputedStyle(shape("box")).pointerEvents==="none"&&!document.querySelector("[data-overlay-interactive]"),"motion never adds passive hit regions");
 const animation=rect.getAnimations()[0];
 const current=animation?.currentTime;
 scene={...scene,revision:scene.revision+1};listener?.(scene);await frames();
 check(rect===shape("box").querySelector("rect")&&animation?.currentTime===current,"unrelated scene publication does not replay strokes");
 publish(shapes.map(item=>item.id==="box"?{...item,x:100}:item));await pause(100);
 const x=Number(rect.getAttribute("x"));check(x>box.x&&x<100,"geometry update paints intermediate positions");
 publish(shapes.map(item=>item.id==="box"?{...item,x:40}:item));await frames();
 const interrupted=Number(rect.getAttribute("x"));check(Math.abs(interrupted-x)<15,"rapid retarget continues from the visible position");
 await pause(450);check(Number(rect.getAttribute("x"))===40,"retarget finishes at exact new geometry");
 publish(shapes.map(item=>item.id==="dim"?{...item,opacity:.25,holes:[{x:220,y:220,width:80,height:60,shape:"ellipse"}]}:item));await pause(170);
 const hole=shape("dim").querySelector("mask ellipse")!;
 samples.holeCenter=Number(hole.getAttribute("cx"));
 check(Number(hole.getAttribute("cx"))>173&&Number(hole.getAttribute("cx"))<260,"spotlight cutout moves through intermediate geometry");
 await pause(500);check(Math.abs(opacity(shape("dim").querySelector("g")!)-.25)<.001,"dimming update settles at exact target");
 publish([note]);await frames(3);
 const card=document.querySelector("[data-overlay-card]")!;
 seek(card,0);const cardStart=opacity(card);seek(card,110);const cardMid=opacity(card);seek(card,220);
 check(cardStart===0&&cardMid>0&&cardMid<.75&&Math.abs(opacity(card)-.75)<.001,"card fades without moving native hit geometry");
 publish([graph(1)]);const initial=await waitCurve();
 check(!!initial,"real JSXGraph curve rendered");check(Number(samples.graphDrawAnimations)>0,"new graph curves also receive a draw-on animation");if(!initial)throw Error("No graph curve");
 const initialD=initial.getAttribute("d");
 publish([graph(2)]);await pause(140);
 const midD=curve()?.getAttribute("d");
 await pause(500);const finalD=curve()?.getAttribute("d");
 check(initial===curve(),"graph update preserves the board and curve DOM identity");
 check(initialD!==midD&&midD!==finalD&&initialD!==finalD,"parameter update has distinct old, intermediate and final curve geometry");
 samples.graph={initial:initialD?.slice(0,150),middle:midD?.slice(0,150),final:finalD?.slice(0,150)};
 publish([graph(2,"a*sin(x)+3")]);await pause(130);const functionMid=curve()?.getAttribute("d");await pause(500);
 check(functionMid!==finalD&&functionMid!==curve()?.getAttribute("d"),"changed function expression smoothly morphs, not just its card");
 publish([graph(3)]);await pause(100);publish([graph(.5)]);await pause(600);
 check(initial===curve()&&!document.querySelector("[role=alert]"),"rapid graph updates remain bounded and keep the board alive");
 const slider=document.querySelector<HTMLInputElement>('[aria-label="Slider a"]')!,beforeSlider=curve()?.getAttribute("d");
 if(slider){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(slider,"2.5");slider.dispatchEvent(new Event("input",{bubbles:true}));slider.dispatchEvent(new Event("change",{bubbles:true}));}
 await pause(100);
 check(beforeSlider!==curve()?.getAttribute("d")&&document.querySelector<HTMLInputElement>('[aria-label="Value a"]')?.value==="2.5","manual slider input remains immediate after morphing");
 const sliderD=curve()?.getAttribute("d");await pause(500);check(sliderD===curve()?.getAttribute("d"),"finished/cancelled animation does not overwrite manual input");
 publish([graph(1)]);await pause(100);setReduced(true);await frames(4);
 check(!!document.querySelector("[data-overlay-reduced-motion]"),"live Reduce motion preference reaches the renderer");
 const reducedD=curve()?.getAttribute("d");await pause(600);check(reducedD===curve()?.getAttribute("d"),"Reduce motion cancels an in-flight graph morph at its exact target");
 publish([graph(2)]);await pause(100);const noMotionD=curve()?.getAttribute("d");await pause(500);
 check(noMotionD===curve()?.getAttribute("d"),"subsequent reduced-motion graph changes have no trailing animation");
 publish(shapes);await frames(4);
 check(document.getAnimations().filter(a=>a.playState==="running").length===0,"Reduce motion disables all shape/text/card/arrow animations");
 check(getComputedStyle(shape("box").querySelector("rect")!).strokeDasharray==="none"&&Math.abs(opacity(shape("dim").querySelector("g")!)-.6)<.001,"reduced motion displays completed strokes and dimming immediately");
 setReduced(false);publish([{...box,id:"new-box"}]);await frames(3);
 check(document.getAnimations().some(a=>a.playState==="running"),"motion resumes for newly inserted items after preference is restored");
 clearDelay=400;
 dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));await frames();
 check(!document.querySelector("[data-overlay-shape],[data-overlay-card]"),"Escape removes animating pixels before native acknowledgement");
 listener?.(scene);await frames();check(!document.querySelector("[data-overlay-shape]"),"stale same-revision scene cannot resurrect escaped annotations");
 await pause(600);check(!document.querySelector("[data-overlay-shape]")&&document.getAnimations().length===0,"clear cancels every in-flight owner, with no delayed resurrection");
 clearDelay=0;publish([box]);await frames();check(!!shape("box"),"newer post-clear scene can draw normally");
 publish([]);await pause(550);check(!document.querySelector("[data-overlay-shape]"),"remove/TTL-style disappearance has no exit retention");
 // Leave a representative scene. Replay performs the actual entrance, not a slideshow.
 const replay=document.createElement("button");replay.textContent="Replay motion";replay.style.cssText="position:fixed;top:24px;right:20px;z-index:2000;padding:10px 16px;background:#f4f4f5;color:#18181b;border:0;border-radius:8px";
 replay.onclick=async()=>{publish([]);await frames();publish(shapes);};document.body.append(replay);
 publish(shapes);await pause(600);finishAnimations();
 document.body.dataset.complete="true";
 report.textContent=results.filter(result=>result.startsWith("FAIL")).join("\n")||"PASS "+results.length+" motion assertions · "+width+"px";
 await fetch("/report",{method:"POST",body:JSON.stringify({width,height,results,samples})});
}
void run().catch(error=>{check(false,String(error));document.body.dataset.complete="error";void fetch("/report",{method:"POST",body:JSON.stringify({width,height,results,samples,error:String(error)})});});
