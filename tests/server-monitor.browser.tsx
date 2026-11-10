/** Run with the app stylesheet in the Metis in-app browser. Synthetic telemetry; no live data changes. */
import React from "react";
import { createRoot } from "react-dom/client";
import { ServerMonitorView } from "../components/server-monitor";
import type { ServerMetric } from "../lib/server-metrics-history";
const now=Date.now(),host=document.createElement("main"),report=document.createElement("pre");
host.style.cssText="max-width:760px;margin:0 auto;padding:16px";report.style.cssText="padding:16px;white-space:pre-wrap;font-size:12px";
document.body.append(host,report);
const history:ServerMetric[]=Array.from({length:181},(_,index)=>{
 const cpuCores=Array.from({length:8},(_,id)=>({id,percent:id===3?92+index%7:6+(index+id)%12}));
 return {timestamp:new Date(now-(180-index)*5000).toISOString(),cpuPercent:Math.round(cpuCores.reduce((n,c)=>n+c.percent,0)/8*10)/10,cpuCores,
 ramUsedBytes:6*1024**3,ramTotalBytes:32*1024**3,load:[1.7,1.4,1.2],networkRxBytesPerSecond:1024*(index%12+1),networkTxBytesPerSecond:2048,gpus:[]};
});
const root=createRoot(host),results:string[]=[];
const pause=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
function render(rows=history,current:ServerMetric|null=rows.at(-1)!,error?:string){root.render(<ServerMonitorView data={{current,history:rows}} error={error} now={now}/>);}
function check(ok:unknown,label:string){results.push((ok?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!ok)throw Error(label);}
function click(selector:string){const node=host.querySelector<HTMLButtonElement>(selector);if(!node)throw Error(selector);node.click();}
const selected=(id:number)=>host.querySelector(`[data-cpu-core="${id}"]`)?.getAttribute("aria-pressed")==="true";
async function run(){
 render();await pause(250);
 check(host.querySelectorAll("[data-cpu-core]").length===8,"Each logical CPU has a labeled current reading");
 check(Boolean(host.querySelector('[aria-label="CPU · total"] .recharts-line-curve')),"Total CPU history is rendered");
 click('[data-cpu-core="3"]');await pause();
 check(selected(3)&&Boolean(host.querySelector('[aria-label="CPU 3"] .recharts-line-curve')),"Selecting a hot core renders that core's history");
 check(host.querySelector('[aria-label="CPU 3"]')?.textContent?.includes("Peak 98.0%"),"Selected core statistics use its own historical readings");
 click('[aria-label="Time range"] button');await pause();
 check(selected(3)&&host.textContent?.includes("Last 1 min"),"Time selection preserves the chosen core");
 click('[data-cpu-core="0"]');await pause();
 check(selected(0)&&Boolean(host.querySelector('[aria-label="CPU 0"]')),"CPU zero is selectable");
 click('[aria-label="CPU cores"] > div button');await pause();
 check(Boolean(host.querySelector('[aria-label="CPU · total"]'))&&!selected(0),"Total returns to aggregate history");
 const legacy=history.map(({cpuCores:_,...row})=>row);render(legacy);await pause();
 check(host.textContent?.includes("Per-core measurements are unavailable")&&!host.querySelector("[data-cpu-core]"),"Legacy telemetry remains readable without inventing core values");
 const warmup={...history.at(-1)!,cpuCores:[{id:0,percent:null}]};render([warmup]);await pause();
 check(host.textContent?.includes("Waiting for next sample"),"Initial per-core readings are explicitly unknown");
 render([],null,"Offline");await pause();
 check(Boolean(host.querySelector('[role="alert"]'))&&host.textContent?.includes("Retrying automatically"),"Failures preserve the existing explicit recovery state");
 const many={...history.at(-1)!,cpuCores:Array.from({length:64},(_,id)=>({id,percent:id%100}))};render([many]);await pause();
 check(host.querySelectorAll("[data-cpu-core]").length===64&&document.documentElement.scrollWidth<=innerWidth+1,"Large CPU inventories fit without horizontal page overflow");
 render();await pause();click('[data-cpu-core="3"]');await pause();
 const button=host.querySelector<HTMLElement>('[data-cpu-core="3"]')!;button.focus();
 check(document.activeElement===button&&button.getBoundingClientRect().height>=44,"Core buttons support keyboard focus and touch-sized targets");
 check(document.documentElement.scrollWidth<=innerWidth+1,"The monitor fits the viewport");
 report.textContent=results.join("\n")+"\nCPU_MONITOR_BROWSER_PASS "+results.length;document.documentElement.dataset.fixtureResult="PASS";
 window.scrollTo(0,0);
}
run().catch(error=>{document.documentElement.dataset.fixtureResult="FAIL";report.textContent=results.join("\n")+"\nFAIL "+String(error);});
