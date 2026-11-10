import React from "react";
import {createRoot} from "react-dom/client";
import {UsageDashboard} from "../components/account/usage-dashboard";
import {UsageOverviewChart} from "../components/account/usage-overview-chart";
import type {AccountUsage,UsageDay} from "../lib/account-types";
const days:UsageDay[]=Array.from({length:7},(_,i)=>({date:"2026-11-"+String(i+1).padStart(2,"0"),requests:i===2?3:i===4?7:0,inputTokens:0,outputTokens:0,tokens:0,costUsd:null,costReports:0,estimatedCostUsd:null,estimatedCostReports:0,tokenReports:0,inputReports:0,outputReports:0}));
const make=(rows:UsageDay[]):AccountUsage=>({from:rows[0]?.date||"2026-11-01",to:rows.at(-1)?.date||"2026-11-07",timezone:"UTC",days:rows,totals:{...days[0],requests:rows.reduce((n,d)=>n+d.requests,0)},models:[],providers:[]});
window.fetch=async()=>new Response(JSON.stringify({usage:make(days)}),{headers:{"Content-Type":"application/json"}});
const host=document.createElement("main"),report=document.createElement("pre");host.style.cssText="max-width:1100px;margin:16px auto;padding:16px";report.style.cssText="white-space:pre-wrap;padding:16px;font-size:12px";document.body.append(host,report);
const root=createRoot(host),results:string[]=[],pause=(ms=750)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(ok:unknown,label:string){results.push((ok?"PASS ":"FAIL ")+label);report.textContent=results.join("\n");if(!ok)throw Error(label);}
const curve=()=>host.querySelector<SVGPathElement>(".recharts-area-curve");
async function chart(rows:UsageDay[],key:string){root.render(<div style={{height:300}}><UsageOverviewChart usage={make(rows)} metric="costUsd" costMode="reported" resetKey={key}/></div>);await pause();}
async function run(){
 root.render(<UsageDashboard/>);await pause();Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Cost")!.click();await pause();
 check(Boolean(host.querySelector('[data-usage-chart-metric="requests"]'))&&host.textContent?.includes("Showing recorded requests instead."),"The actual Usage dashboard labels its request fallback");
 check(Boolean(curve()?.getTotalLength()),"Missing provider costs still show a smooth real activity curve");
 check(!host.querySelector('[data-usage-chart-metric="requests"] .recharts-yAxis')?.textContent?.includes("$"),"Fallback axis does not claim dollar amounts");
 await chart(days.map(d=>({...d,requests:0})),"empty");
 check(Boolean(curve()?.getTotalLength()),"No recorded activity renders a visible zero baseline");
 const path=curve()!;check(Math.abs(path.getPointAtLength(0).y-path.getPointAtLength(path.getTotalLength()).y)<.1,"The empty-period line remains exactly zero");
 await chart(days.map(d=>({...d,costUsd:0,costReports:d.requests})),"zero");
 check(Boolean(host.querySelector('[data-usage-chart-metric="costUsd"]'))&&!host.textContent?.includes("Showing recorded requests"),"Explicit zero costs remain cost data");
 const partial=days.slice(0,3).map((d,i)=>({...d,requests:1,costUsd:i===1?null:i+1,costReports:i===1?0:1}));
 await chart(partial,"partial");
 check(host.querySelectorAll(".recharts-area-dot").length>=2,"Isolated known cost points remain visible across unknown days");
 check(!host.textContent?.includes("Showing recorded requests"),"Partial costs retain their own units and missing-data gaps");
 await chart([{...days[0],requests:1,costUsd:2,costReports:1}],"single");
 check(host.querySelectorAll(".recharts-area-dot").length>=1,"A one-day known cost stays visible");
 check(document.documentElement.scrollWidth<=innerWidth+1,"Charts fit without horizontal page overflow");
 root.render(<UsageDashboard/>);await pause();Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="Cost")!.click();await pause();
 document.documentElement.dataset.fixtureResult="PASS";report.textContent=results.join("\n")+"\nUSAGE_CHART_BROWSER_PASS "+results.length;
 const overview=host.querySelector('[aria-label="Usage overview"]');overview?.scrollIntoView({block:"start"});
}
run().catch(e=>{document.documentElement.dataset.fixtureResult="FAIL";report.textContent=results.join("\n")+"\nFAIL "+String(e);});
