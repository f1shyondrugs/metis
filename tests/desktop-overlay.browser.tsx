/** Synthetic real-browser fixture: no account data, native commands or external APIs. */
import React from "react";
import {createRoot} from "react-dom/client";
import {DesktopOverlay,type OverlayItem,type OverlayState} from "../components/desktop-overlay";
import {isOverlayResourceUrl} from "../components/overlay-file-preview";
const width=innerWidth,height=innerHeight,view=new URLSearchParams(location.search).get("view")||"html";
const appearance={version:1,mode:"dark",variables:{"--radius":"0.625rem","--spacing":"0.25rem","--font-sans":"ui-sans-serif, system-ui, sans-serif","--background":"#151719","--foreground":"#f4f4f5","--border":"#555b64","--muted":"#272b30","--muted-foreground":"#b7bec9","--primary":"#93c5fd","--primary-foreground":"#111"}};
const contents:Record<string,NonNullable<OverlayItem["content"]>>={
 markdown:{kind:"markdown",source:"# A clear next step\n\n**Preview only.** Content stays inside this card.\n\n- One bounded action\n- One visible result\n\n![blocked](https://example.invalid/leak.png)\n\n"+String.fromCharCode(96).repeat(3)+"html\n<script>window.markdownExecuted=true</script>\n"+String.fromCharCode(96).repeat(3)},
 html:{kind:"html",source:'<label>Local widget <input aria-label="Local widget" placeholder="Try typing"></label><button onclick="this.textContent=\'Completed\'">Mark complete</button><script>fetch("https://example.invalid/leak").catch(()=>parent.postMessage({fixtureOffline:true,bridge:typeof window.metisOverlay},"*"));</script>'},
 graph:{kind:"graph",spec:{title:"Quadratic",bounds:[-5,5,-2,8],elements:[{type:"slider",name:"a",min:0,max:3,value:1,step:.25},{type:"function",fn:"a*x^2"}]}},
 chart:{kind:"chart",spec:{type:"bar",title:"Progress",x:["A","B"],series:[{name:"Steps",values:[2,4]}]}},
 file:{kind:"file",file:{url:"/api/uploads/fixture/notes.txt",name:"notes.txt",mimeType:"text/plain",text:"An inline, offline file preview.\n".repeat(30)}},
 pdf:{kind:"file",file:{url:"/api/file-uploads/11111111-1111-4111-8111-111111111111/file",name:"proof.pdf",mimeType:"application/pdf"}},
 image:{kind:"file",file:{url:"/api/uploads/fixture/colors.png",name:"colors.png",mimeType:"image/png"}}
};
type Placement={imageFit?:"contain"|"cover";imagePosition?:{x:number;y:number}};
const card=(id:string,content:NonNullable<OverlayItem["content"]>&Placement=contents[id]):OverlayItem=>({id,type:"card",x:12,y:76,width:Math.min(660,width-24),height:Math.min(430,height-160),text:id+" preview",content});
const originals=Object.keys(contents).map(id=>card(id));
const shapes:OverlayItem[]=[
 {id:"dim",type:"spotlight",x:0,y:0,width,height,opacity:.58,holes:[{x:16,y:60,width:Math.min(width-32,350),height:90,shape:"rect",radius:10},{x:width-76,y:210,width:56,height:56,shape:"ellipse"}]},
 {id:"box",type:"rect",x:16,y:60,width:Math.min(width-32,350),height:90,color:"#60a5fa",strokeWidth:3,radius:10},
 {id:"circle",type:"ellipse",x:width-76,y:210,width:56,height:56,color:"#fb923c",strokeWidth:3},
 {id:"arrow",type:"arrow",x:24,y:175,width:150,height:60,color:"#f87171",strokeWidth:3,doubleArrow:true,points:[{x:24,y:175},{x:174,y:235}]},
 {id:"underline",type:"line",x:24,y:288,width:180,height:1,color:"#fbbf24",strokeWidth:3},
 {id:"freehand",type:"path",x:24,y:325,width:240,height:35,color:"#34d399",strokeWidth:3,points:[{x:24,y:340},{x:70,y:328},{x:110,y:350},{x:175,y:330},{x:264,y:345}]},
 {id:"highlight",type:"highlight",x:24,y:390,width:Math.min(width-48,300),height:35,color:"#fbbf24",opacity:.3},
 {id:"label",type:"text",x:24,y:398,width:Math.min(width-48,330),height:90,color:"#f4f4f5",fontSize:16,text:"A visible next step\nEscape clears annotations"}
];
let scene:OverlayState={revision:1,items:[card("markdown")],display:{id:"fixture",width,height},interactiveId:null,appearance};
let listener:((state:OverlayState)=>void)|undefined;
const history:OverlayItem[][]=[],calls:string[]=[];let failNext="";
const publish=(next:Partial<OverlayState>)=>{scene={...scene,...next,revision:scene.revision+1};listener?.(scene);};
function attempt(name:string){calls.push(name);if(failNext===name){failNext="";throw Error("Synthetic recoverable rejection");}}
Object.assign(window,{metisOverlay:{
 state:async()=>scene,onState:(cb:(state:OverlayState)=>void)=>{listener=cb;return()=>{listener=undefined;};},
 interact:async(id:string|null)=>{attempt("interact");publish({interactiveId:id});},
 remove:async(id:string)=>{attempt("remove");history.push(scene.items);publish({items:scene.items.filter(i=>i.id!==id),interactiveId:null});},
 clear:async()=>{attempt("clear");history.push(scene.items);publish({items:[],interactiveId:null});},
 undo:async()=>{attempt("undo");publish({items:history.pop()||scene.items});}
}});
if(view==="shapes"){const background=document.createElement("div");background.setAttribute("aria-hidden","true");background.style.cssText="position:fixed;inset:0;background:#20262f;color:#e5e7eb;padding:20px;font:14px system-ui";background.innerHTML='<p>Synthetic desktop — annotation preview</p><div style="position:absolute;left:16px;top:60px;width:350px;height:90px;padding:18px;background:#303b49;border-radius:10px">This area stays in focus.<br><small>Everything around it can be dimmed.</small></div>';document.body.append(background);}
const host=document.createElement("div");document.body.append(host);createRoot(host).render(<DesktopOverlay/>);
const report=document.createElement("pre");report.id="overlay-results";report.style.cssText="position:fixed;bottom:64px;right:8px;max-width:calc(100vw - 16px);max-height:160px;overflow:auto;background:#151719;color:#d1fae5;padding:10px;font-size:11px;pointer-events:none;z-index:999";document.body.append(report);
const results:string[]=[];
const check=(ok:unknown,label:string)=>{results.push((ok?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!ok)document.body.dataset.failed="true";};
const pause=(ms=100)=>new Promise(resolve=>setTimeout(resolve,ms));
async function show(id:string,content:NonNullable<OverlayItem["content"]>&Placement=contents[id]){publish({items:[card(id,content)],interactiveId:id});await pause(600);}
let offline=false,opaque=false;
addEventListener("message",event=>{if(event.data?.fixtureOffline){offline=true;opaque=event.origin==="null"&&event.data.bridge==="undefined";}});
const press=(label:string)=>(Array.from(document.querySelectorAll<HTMLButtonElement>("[data-overlay-toolbar] button")).find(el=>el.textContent===label))?.click();
async function run(){
 await pause(700);
 check(!document.querySelector("[data-overlay-interactive]"),"passive cards have no native hit region");
 check(!!document.querySelector("[data-overlay-card][inert]"),"passive card is inert");
 check(getComputedStyle(document.body).backgroundColor==="rgba(0, 0, 0, 0)"&&getComputedStyle(document.documentElement).backgroundColor==="rgba(0, 0, 0, 0)","page remains transparent");
 check(getComputedStyle(document.documentElement).getPropertyValue("--background").trim()==="#151719","native appearance v1 applied");
 check(getComputedStyle(document.documentElement).getPropertyValue("--radius").trim()==="0.625rem","full native theme supports non-color radius/spacing/font tokens");
 publish({appearance:{version:1,mode:"light",variables:{"--background":"#fafafa","--foreground":"rgb(20, 20, 20)"}}});await pause();
 check(document.documentElement.style.colorScheme==="light"&&!document.documentElement.classList.contains("dark"),"native light mode applied");
 publish({appearance:{version:1,mode:"dark",variables:{"--background":"url(https://example.invalid/leak)"}}});await pause();
 check(!document.documentElement.style.getPropertyValue("--background").includes("url"),"invalid CSS theme rejected atomically");
 publish({appearance});await pause();
 check(!document.querySelector('img[src*="example.invalid"]')&&!document.querySelector('[data-overlay-card] script'),"Markdown remote assets blocked and code is source only");
 for(const url of ["/api/share/attachment?x=1","/api/uploads/one","/api/uploads/owner/%2e%2e","//evil/a","/api/file-uploads/not-uuid/file","/api/uploads/o/../a","/api/uploads/o/..","/api/uploads/o/%2fetc","/api/uploads/o/a%5cb","/api/uploads/o/a%00b"]){check(!isOverlayResourceUrl(url),"reject resource "+url);}
 check(isOverlayResourceUrl(contents.pdf.file!.url)&&isOverlayResourceUrl(contents.image.file!.url),"canonical and legacy authorized routes accepted");
 check(isOverlayResourceUrl("/api/uploads/fixture/my%20image.png"),"encoded legacy filename accepted");
 await show("html");await pause(1000);
 check(document.querySelector("iframe")?.getAttribute("sandbox")==="allow-scripts","HTML opaque sandbox preserved");
 check(offline&&opaque,"HTML offline and has no native bridge");
 check(document.querySelectorAll("[data-overlay-interactive]").length===2,"only active card and toolbar are native hit regions");
 await show("graph");await pause(1600);
 check(!!document.querySelector("[data-graph-sliders] input[type=range]")&&!!document.querySelector("[data-overlay-card] svg path"),"actual readOnly graph and slider rendered");
 const slider=document.querySelector<HTMLInputElement>("[data-graph-sliders] input[type=range]");
 const paths=()=>Array.from(document.querySelectorAll("[data-overlay-card] svg path")).map(p=>p.getAttribute("d")).join("|");
 const before=paths();if(slider){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(slider,"2");slider.dispatchEvent(new Event("input",{bubbles:true}));slider.dispatchEvent(new Event("change",{bubbles:true}));}await pause(300);
 check(document.querySelector<HTMLInputElement>('[aria-label="Value a"]')?.value==="2"&&before!==paths(),"graph slider changes local curve in readOnly mode");
 check(Array.from(document.querySelectorAll<HTMLElement>('[aria-label*="fullscreen" i]')).every(el=>getComputedStyle(el).display==="none"),"graph fullscreen escape hidden");
 await show("chart");await pause(1200);
 check(!!document.querySelector(".recharts-surface")&&document.querySelectorAll(".recharts-bar-rectangle").length===2,"actual static chart bars rendered");
 check(Array.from(document.querySelectorAll<HTMLElement>('[aria-label*="fullscreen" i]')).every(el=>getComputedStyle(el).display==="none"),"chart fullscreen escape hidden");
 await show("image");
 const img=document.querySelector<HTMLImageElement>("[data-image-surface]>img");
 check(img?.complete&&img.naturalWidth===600&&getComputedStyle(img).objectFit==="contain","real image loaded and defaults to aspect-preserving contain");
 await show("image",{...contents.image,imageFit:"cover",imagePosition:{x:100,y:0}});
 const crop=document.querySelector<HTMLImageElement>("[data-image-surface]>img");
 check(crop?.complete&&getComputedStyle(crop).objectFit==="cover"&&getComputedStyle(crop).objectPosition==="100% 0%","cover crops at incoming position");
 await show("image",{kind:"file",file:{url:"/api/uploads/fixture/missing.png",name:"missing.png",mimeType:"image/png"}});
 check(!!document.querySelector("[data-overlay-card] [role=alert]"),"image error stays inside card");
 await show("file");
 for(const [label,name] of [["Done","interact"],["Delete","remove"],["Clear","clear"],["Undo","undo"]]){
   await show("file");failNext=name;press(label);await pause();
   check(!!document.querySelector("[role=alert]")&&!document.querySelector<HTMLButtonElement>("[data-overlay-toolbar] button")?.disabled,label+" rejection recovers controls");
   press(label);await pause();check(!document.querySelector("[role=alert]"),label+" retry succeeds");
 }
 publish({items:originals,interactiveId:"file"});await pause();press("Delete");await pause();check(!scene.items.some(i=>i.id==="file"),"Delete removes selected card");
 publish({interactiveId:"markdown"});await pause();press("Undo");await pause();check(scene.items.some(i=>i.id==="file"),"Undo restores removed card");
 press("Clear");await pause();check(scene.items.length===0,"Clear clears scene");
 publish({items:originals,interactiveId:null});await pause();dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));await pause();check(scene.items.length===0,"Escape clears scene");
 publish({items:shapes,interactiveId:null});await pause();
 check(document.querySelectorAll("svg mask rect,svg mask ellipse").length===3,"spotlight contains multiple rectangular/elliptical holes");
 check(!!document.querySelector("svg marker")&&!!document.querySelector("svg polyline")&&document.querySelectorAll("svg text tspan").length===2,"arrows, freehand and multiline labels rendered");
 check(document.querySelectorAll("svg").length===8&&!document.querySelector("[data-overlay-interactive]"),"all annotation types stay passive");
 await show("pdf");await pause(1800);
 let pdf=document.querySelector<HTMLCanvasElement>('[data-overlay-pdf] canvas');
 for(let i=0;i<80&&(!pdf||pdf.hidden||!pdf.width);i++){await pause(100);pdf=document.querySelector<HTMLCanvasElement>('[data-overlay-pdf] canvas');}
 let red=0;if(pdf&&!pdf.hidden){const data=pdf.getContext("2d")!.getImageData(0,0,pdf.width,pdf.height).data;for(let i=0;i<data.length;i+=16)if(data[i]>180&&data[i+1]<90&&data[i+2]<90)red++;}
 check(!!pdf&&!pdf.hidden&&red>100,"actual PDF canvas paints the synthetic red panel");
 check(!document.querySelector('[data-overlay-pdf] iframe')&&document.querySelector('[aria-label="PDF pages"]')?.textContent?.includes("Page 1 of 1"),"PDF canvas stays contained with local page controls");
 if(view==="shapes")publish({items:shapes,interactiveId:null});
 else await show(view==="cover"?"image":contents[view]?view:"html",view==="cover"?{...contents.image,imageFit:"cover",imagePosition:{x:100,y:0}}:contents[view]||contents.html);
 document.body.dataset.complete="true";
 report.textContent=results.filter(x=>x.startsWith("FAIL")).join("\n")||"PASS "+results.filter(x=>x.startsWith("PASS")).length+" browser assertions\nOVERLAY_CHECKS_COMPLETE "+width;
 await fetch("/report",{method:"POST",body:JSON.stringify({width,height,results,view})});
}
void run().catch(error=>{check(false,String(error));document.body.dataset.complete="error";});
