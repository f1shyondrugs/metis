/** Real component geometry regression; run in the Metis in-app browser. */
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {Markdown} from "../components/markdown";
import {ChartBoard} from "../components/chart-board";
import {GraphBoard} from "../components/graph-board";
import {MermaidDiagram} from "../components/mermaid-diagram";
import {FileEmbed} from "../components/file-embed";
import {DictationTextarea,FieldDictationContext} from "../components/field-dictation";
import {HtmlEmbed} from "../components/html-embed";
import {TooltipProvider} from "../components/ui/tooltip";

const host=document.createElement("main"),report=document.createElement("pre");
document.body.append(host,report);host.style.cssText="max-width:900px;margin:16px auto;padding:12px";report.style.cssText="white-space:pre-wrap;padding:12px;font-size:12px";
const longCode=Array.from({length:90},(_,i)=>"const value"+i+" = '"+("wide text ".repeat(20))+"';").join("\n");
const chart=JSON.stringify({charts:[1,2,3].map(n=>({type:"bar",title:"Chart "+n,x:["A","B"],series:[{name:"Example",values:[n,n+1]}]}))});
const graph=JSON.stringify({boards:[1,2,3].map(n=>({title:"Graph "+n,elements:[{type:"function",fn:"x^2"}]}))});
const image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=";
const widget='<label>Long response<textarea aria-label="Widget response" style="height:1700px;width:100%;box-sizing:border-box"></textarea></label><script>addEventListener("message",e=>{if(e.data?.type==="fixture-scroll")scrollTo(0,300)});</script>';
const baseline=new URLSearchParams(location.search).has("baseline");
const results:string[]=[];
let copied="";Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});
const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value:unknown,label:string){results.push((value?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!value)throw Error(label);}
async function until(predicate:()=>unknown,label:string){for(let i=0;i<150;i++){if(predicate())return;await pause();}throw Error("Timed out "+label);}
function App(){const[value,setValue]=useState(Array.from({length:100},()=> "Existing answer").join("\n"));
 return <TooltipProvider><FieldDictationContext.Provider value={{enabled:true,provider:"browser",maxDurationSeconds:300,chatId:"sticky-fixture"}}>
 <h1 style={{marginBottom:12}}>Controls stay with their content</h1>
 <div id="scroller" style={{height:"min(660px,75vh)",overflow:"auto",border:"1px solid var(--border)",borderRadius:8,padding:12,position:"relative"}}>
 <section id="code"><h2>Code</h2><Markdown content={"\x60\x60\x60typescript\n"+longCode+"\n\x60\x60\x60"}/></section>
 <section id="field"><h2>Answer</h2><DictationTextarea aria-label="Long answer" value={value} onValueChange={setValue} style={{height:850}}/></section>
 <section id="charts"><h2>Charts</h2><ChartBoard code={chart}/></section>
 <section id="graphs"><h2>Graphs</h2><GraphBoard code={graph}/></section>
 <section id="mermaid"><h2>Diagram source</h2><MermaidDiagram code={"flowchart LR\n"+Array.from({length:45},(_,i)=>"N"+i+" --> N"+(i+1)).join("\n")} language="mermaid"/></section>
 <section id="file"><h2>Image</h2><FileEmbed file={{url:image,name:"Preview.png",mimeType:"image/png",height:1050}} className="rounded-lg border border-border"/></section>
 <section id="html"><h2>Interactive input</h2><HtmlEmbed source={widget}/></section>
 <div id="after" style={{height:800}}>Content after the embeds</div>
 </div></FieldDictationContext.Provider></TooltipProvider>;
}
createRoot(host).render(<App/>);
function rect(selector:string){const e=document.querySelector<HTMLElement>(selector);if(!e)throw Error("Missing "+selector);return e.getBoundingClientRect();}
function scrollToElement(selector:string,delta=0){const port=document.querySelector<HTMLElement>("#scroller")!,node=document.querySelector<HTMLElement>(selector)!;port.scrollTop+=node.getBoundingClientRect().top-port.getBoundingClientRect().top+delta;}
async function run(){
 await until(()=>document.querySelector("#code pre"),"initial render");
 if(baseline){report.textContent="BASELINE_READY";return;}
 const port=()=>rect("#scroller");
 scrollToElement("#code .markdown-code-container",300);await pause(100);
 check(rect('#code .markdown-code-toolbar button').top>=port().top-1,"Code copy stays at nested scrollport top");
 const copyX=rect('#code .markdown-code-toolbar button').right;
 document.querySelector<HTMLElement>("#code pre")!.scrollLeft=1000;await pause();
 check(Math.abs(rect('#code .markdown-code-toolbar button').right-copyX)<2,"Horizontal code scrolling does not move Copy");
 document.querySelector<HTMLButtonElement>('#code .markdown-code-toolbar button')!.click();await pause();check(copied===longCode,"Sticky Copy still copies the exact unscrolled source");
 document.querySelector<HTMLElement>("#scroller")!.style.setProperty("--contained-actions-top","48px");await pause();check(rect('#code button').top>=port().top+47,"Sticky controls honor a reserved header inset");document.querySelector<HTMLElement>("#scroller")!.style.removeProperty("--contained-actions-top");
 scrollToElement("#field textarea",300);await pause(100);
 const mic=()=>rect('#field [aria-label="Record voice input"]');
 check(mic().top>=port().top-1&&mic().bottom<port().bottom,"Textarea microphone follows outer scrolling");
 const micTop=mic().top;document.querySelector<HTMLTextAreaElement>("#field textarea")!.scrollTop=1200;await pause();
 check(Math.abs(mic().top-micTop)<2,"Textarea's own text scrolling keeps microphone still");
 scrollToElement("#charts [data-editor-control=chart]",300);await pause(120);
 check(rect('#charts [aria-label="Open chart fullscreen"]').top>=port().top-1,"Chart fullscreen stays reachable while its boards scroll");
 document.querySelector<HTMLButtonElement>('#charts [aria-label="Open chart fullscreen"]')!.click();await pause(150);
 check(Boolean(document.querySelector('[aria-label="Exit fullscreen"]'))&&rect('[data-editor-control="chart"]').height>innerHeight*0.8,"Sticky chart fullscreen action still opens at full height");
 document.querySelector<HTMLButtonElement>('[aria-label="Exit fullscreen"]')!.click();await pause(100);
 scrollToElement("#graphs [data-editor-control=graph]",300);await pause(120);
 check(rect('#graphs [aria-label="Open graph fullscreen"]').top>=port().top-1,"Graph fullscreen stays reachable while its boards scroll");
 document.querySelector<HTMLButtonElement>("#mermaid button[aria-pressed]")!.click();await until(()=>document.querySelector("#mermaid .cm-editor"),"diagram source editor");
 scrollToElement("#mermaid [data-editor-control=mermaid]",120);await pause(100);
 check(rect('#mermaid [aria-label="Open flowchart fullscreen"]').top>=port().top-1,"Diagram source controls stay visible while its source scrolls");
 scrollToElement("#file [data-file-embed]",180);await pause(150);
 const fileButton=rect('#file [aria-label="Fullscreen Preview.png"]');
 check(fileButton.top>=port().top&&fileButton.bottom<=port().bottom+1,"File preview controls stay at visible bottom");
 document.querySelector<HTMLButtonElement>('#file [aria-label="Fullscreen Preview.png"]')!.click();await pause(100);
 check(Boolean(document.querySelector('[data-image-viewer] [aria-label="Exit fullscreen"]')),"Sticky file fullscreen still opens the image viewer");
 document.querySelector<HTMLButtonElement>('[data-image-viewer] [aria-label="Exit fullscreen"]')!.click();await pause();document.querySelector<HTMLButtonElement>('[data-image-viewer] [aria-label="Close image"]')!.click();await pause();
 await until(()=>document.querySelector("#html [data-field-dictation]"),"widget field controls");
 scrollToElement("#html iframe",300);await pause(150);
 const htmlButton=rect('#html [aria-label="Record voice input"]');
 check(htmlButton.top>=port().top-1&&htmlButton.bottom<=port().bottom,"HTML field microphone sticks within its target");
 document.querySelector<HTMLIFrameElement>("#html iframe")!.contentWindow!.postMessage({type:"fixture-scroll"},"*");await pause(200);
 check(rect('#html [aria-label="Record voice input"]').top>=port().top-1,"HTML field microphone remains after internal iframe scrolling");
 scrollToElement("#after",160);await pause(100);
 check(rect('#code .markdown-code-toolbar button').bottom<port().top&&rect('#field [aria-label="Record voice input"]').bottom<port().top&&rect('#graphs [aria-label="Open graph fullscreen"]').bottom<port().top&&rect('#file [aria-label="Fullscreen Preview.png"]').bottom<port().top&&rect('#html [aria-label="Record voice input"]').bottom<port().top,"Controls leave with their own content");
 document.querySelector<HTMLElement>("#scroller")!.scrollTop=0;await pause();
 check(document.documentElement.scrollWidth<=innerWidth+1,"No page-wide horizontal overflow");
 document.documentElement.dataset.fixtureResult="PASS";report.textContent=results.join("\n")+"\nSTICKY_CONTROLS_BROWSER_PASS "+results.length;
 const view=new URLSearchParams(location.search).get("view");
 if(view==="code")scrollToElement("#code .markdown-code-container",300);
 if(view==="field")scrollToElement("#field textarea",300);
 if(view==="charts")scrollToElement("#charts [data-editor-control=chart]",300);
 if(view==="file")scrollToElement("#file [data-file-embed]",180);
 if(view==="html")scrollToElement("#html iframe",300);
}
run().catch(e=>{document.documentElement.dataset.fixtureResult="FAIL";report.textContent=results.join("\n")+"\nFAIL "+String(e);});
