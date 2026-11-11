import React from "react";
import {createRoot} from "react-dom/client";
import {OverlayPdfPreview, isOverlayPdfUrl} from "../components/overlay-pdf-preview";

const good="/api/file-uploads/11111111-1111-4111-8111-111111111111/file";
const results:string[]=[];
function check(value:unknown,label:string){results.push((value?"PASS ":"FAIL ")+label);}
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));
async function wait(fn:()=>unknown){for(let i=0;i<150;i++){if(fn())return;await sleep(100);}throw new Error("Timed out");}
const root=createRoot(document.body.appendChild(document.createElement("main")));
const requests:string[]=[];
const nativeFetch=window.fetch.bind(window);
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{requests.push(String(input));return nativeFetch(input,init);}) as typeof fetch;
function show(url:string){root.render(<div style={{height:500,width:"100%",background:"#18181b",color:"white"}}><OverlayPdfPreview file={{url,name:"Synthetic PDF proof",mimeType:"application/pdf"}}/></div>);}
async function run(){
 try{
 check([good,"/api/uploads/fixture/report%20one.pdf"].every(isOverlayPdfUrl),"canonical URLs accepted");
 check(["file:///tmp/a.pdf","https://example.com/a.pdf","//example.com/x","/api/uploads/x/%2e%2e","/api/uploads/x/a%2Fb","/api/uploads/x/%252f","/api/uploads/x/a.pdf?x=1"].every(x=>!isOverlayPdfUrl(x)),"unsafe URLs rejected");
 show(good);
 await wait(()=>!!document.querySelector("canvas:not([hidden])"));
 const canvas=document.querySelector("canvas")!;
 const pixels=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
 let red=0,black=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>180&&pixels[i+1]<90)red++;if(pixels[i]<70&&pixels[i+1]<70&&pixels[i+2]<70)black++;}
 check(red>1000&&black>50,"real PDF canvas has colored panel and text");
 check(canvas.width<=4096&&canvas.height<=4096&&canvas.width*canvas.height<=16000000,"canvas bounded");
 check(document.body.textContent?.includes("Page 1 of 2"),"page count");
 (Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Next page"))!.click();
 await wait(()=>document.body.textContent?.includes("Page 2 of 2")&&!document.querySelector('[role="status"]'));
 check(true,"next page renders");
 (Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Previous page"))!.click();
 await wait(()=>document.body.textContent?.includes("Page 1 of 2")&&!document.querySelector('[role="status"]'));
 show("/api/uploads/fixture/retry.pdf");
 await wait(()=>document.body.textContent?.includes("Retry PDF preview"));
 check(!!document.querySelector('[role="alert"]'),"visible load error");
 (Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Retry PDF preview"))!.click();
 await wait(()=>!!document.querySelector("canvas:not([hidden])"));
 check(true,"retry recovers");
 show("https://example.com/blocked.pdf");
 await wait(()=>document.body.textContent?.includes("trusted attachment URL"));
 check(!requests.some(x=>x.startsWith("http")),"external URL never fetched");
 check(!document.querySelector("iframe,a,object,embed"),"canvas only, no annotation navigation");
 show(good);await wait(()=>!!document.querySelector("canvas:not([hidden])"));
 }catch(e){results.push("FAIL "+String(e));}
 const report={width:innerWidth,results,requests,resources:performance.getEntriesByType("resource").map(e=>e.name)};
 check(report.resources.every(x=>new URL(x).origin===location.origin),"no external resources");
 const output=document.body.appendChild(Object.assign(document.createElement("pre"),{textContent:results.join("\n")})); output.style.whiteSpace="pre-wrap";
 await nativeFetch("/report",{method:"POST",body:JSON.stringify(report)});
}
void run();
