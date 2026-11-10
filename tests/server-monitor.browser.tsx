/** Actual component in the Metis browser; synthetic telemetry, no live data changes. */
import React from "react";
import { createRoot } from "react-dom/client";
import { ServerMonitorView } from "../components/server-monitor";
import type { ServerMetric } from "../lib/server-metrics-history";
const now=Date.now(),host=document.createElement("main"),report=document.createElement("pre");
host.style.cssText="max-width:760px;margin:0 auto;padding:16px";report.style.cssText="padding:16px;white-space:pre-wrap;font-size:12px";
document.body.append(host,report);
if(new URL(location.href).searchParams.get("theme")==="dark")document.documentElement.classList.add("dark");
const history:ServerMetric[]=Array.from({length:181},(_,index)=>{
 const cpuCores=Array.from({length:8},(_,id)=>({id,percent:id===3?92+index%7:6+(index+id)%12}));
 return {timestamp:new Date(now-(180-index)*5000).toISOString(),cpuPercent:Math.round(cpuCores.reduce((n,c)=>n+c.percent,0)/8*10)/10,cpuCores,
 ramUsedBytes:6*1024**3,ramTotalBytes:32*1024**3,load:[1.7,1.4,1.2],networkRxBytesPerSecond:1024*(index%12+1),networkTxBytesPerSecond:2048,gpus:[]};
});
const root=createRoot(host),results:string[]=[];
const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
function render(rows=history,current:ServerMetric|null=rows.at(-1)!,error?:string){root.render(<ServerMonitorView data={{current,history:rows}} error={error} now={now}/>);}
function check(ok:unknown,label:string){results.push((ok?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!ok)throw Error(label);}
const cpu=()=>host.querySelector('[aria-label="CPU cores"]')!;
const lines=()=>Array.from(cpu().querySelectorAll(".recharts-line"));
const button=(key:string)=>host.querySelector<HTMLButtonElement>('[data-cpu-series="'+key+'"]')!;
const selected=(key:string)=>button(key)?.getAttribute("aria-pressed")==="true";
async function preset(label:string){Array.from(cpu().querySelectorAll<HTMLButtonElement>('[aria-label="CPU display"] button')).find(node=>node.textContent===label)!.click();await pause();}
async function run(){
 render();await pause(350);
 check(cpu().querySelectorAll("[data-cpu-series]").length===9,"Compact legend includes Total and all eight logical CPUs");
 check(lines().length===9,"All cores and Total share one history graph by default");
 const curves=Array.from(cpu().querySelectorAll<SVGPathElement>(".recharts-line-curve"));
 check(new Set(curves.map(node=>node.getAttribute("stroke"))).size===9,"Every core has a different color; Total has its own style");
 check(new Set(curves.map(node=>node.getAttribute("stroke-dasharray"))).size>=3,"Line patterns complement labels and colors");
 await preset("Total only");
 check(lines().length===1&&selected("total")&&!selected("0"),"Total-only preset shows only aggregate CPU");
 button("0").click();await pause();
 check(lines().length===2&&selected("0"),"CPU zero can be added alongside Total");
 button("total").click();await pause();
 check(lines().length===1&&selected("0")&&!selected("total"),"An individual core can be shown without Total");
 button("0").click();await pause();
 check(!lines().length&&cpu().textContent?.includes("Select Total or a CPU"),"Explicitly empty selection shows a useful instruction");
 render();await pause();
 check(!selected("0")&&!selected("total"),"Polling preserves an explicitly empty selection");
 await preset("Cores only");
 check(lines().length===8&&!selected("total")&&selected("3"),"Cores-only preset includes every core without aggregate CPU");
 await preset("Total only");button("3").click();button("total").click();await pause();
 check(lines().length===1&&cpu().textContent?.includes("Peak 98.0%"),"Single-core statistics use that core's history");
 const color=cpu().querySelector(".recharts-line-curve")?.getAttribute("stroke");
 host.querySelector<HTMLButtonElement>('[aria-label="Time range"] button')!.click();await pause();
 check(selected("3")&&host.textContent?.includes("Last 1 min"),"Time range changes preserve custom selection");
 const reordered=history.map(row=>({...row,cpuCores:[...row.cpuCores!].reverse()}));
 render(reordered);await pause();
 check(selected("3")&&cpu().querySelector(".recharts-line-curve")?.getAttribute("stroke")===color,"CPU identity and color survive reordered polling samples");
 await preset("All");
 const legend=cpu().querySelector<HTMLElement>("[data-cpu-legend]")!;
 check(legend.getBoundingClientRect().height<=145,"Legend height stays bounded");
 const focus=button("0");focus.focus();
 check(document.activeElement===focus&&focus.getBoundingClientRect().height>=(innerWidth<640?44:32),"Legend supports keyboard focus and touch-sized mobile controls");
 const old=history.map(({cpuCores:_,...row})=>row);render(old);await pause();
 check(cpu().textContent?.includes("Per-core measurements are unavailable")&&cpu().querySelectorAll("[data-cpu-series]").length===1,"Legacy telemetry retains Total without invented cores");
 render();await pause();await preset("Cores only");
 const warmup={...history.at(-1)!,cpuCores:[{id:0,percent:null}]};render([warmup]);await pause();
 check(cpu().textContent?.includes("Waiting for next sample")&&!lines().length,"Unknown warmup values remain gaps");
 render([],null,"Offline");await pause();
 check(Boolean(host.querySelector('[role="alert"]'))&&host.textContent?.includes("Retrying automatically"),"Error and recovery states remain explicit");
 const many={...history.at(-1)!,cpuCores:Array.from({length:64},(_,id)=>({id,percent:id%100}))};
 render([many]);await pause();await preset("All");
 check(cpu().querySelectorAll("[data-cpu-series]").length===65&&lines().length===65,"A large inventory includes every core in the same graph");
 const manyLegend=cpu().querySelector<HTMLElement>("[data-cpu-legend]")!;
 check(manyLegend.scrollHeight>manyLegend.clientHeight&&manyLegend.clientHeight<=145,"Large legends scroll internally instead of growing the page");
 button("63").focus();await pause();
 check(document.activeElement===button("63")&&manyLegend.scrollTop>0,"Keyboard focus reveals cores beyond the initial legend viewport");
 check(document.documentElement.scrollWidth<=innerWidth+1,"No horizontal page overflow with many cores");
 render();await pause();await preset("All");
 check(document.documentElement.scrollWidth<=innerWidth+1,"Eight-core overview fits the viewport");
 // Public fixture hook: use the browser's real Space key to verify native button activation.
 button("0").focus();
 report.textContent=results.join("\n")+"\nCPU_MONITOR_BROWSER_PASS "+results.length;
 document.documentElement.dataset.fixtureResult="PASS";window.scrollTo(0,0);
}
run().catch(error=>{document.documentElement.dataset.fixtureResult="FAIL";report.textContent=results.join("\n")+"\nFAIL "+String(error);});
