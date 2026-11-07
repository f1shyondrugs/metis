import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createResearchWorkflow, researchPlanForm } from "../lib/mcp-core/research-workflow.mjs";
import { researchTracks, researchTrackKey, researchProgressFromTool, researchReportNavigation, type ResearchProgress } from "../lib/research-progress";
import { ResearchProgressCard } from "../components/research-progress-card";
import { compactToolForPersistence } from "../lib/tool-persistence";

const progress: ResearchProgress = {
 kind:"research-progress",runId:"run",questionId:"q",title:"Detailed research",language:"en",status:"approved",
 plan:["Read evidence","Write report"],steps:[{id:1,content:"Read evidence",status:"in_progress"},{id:2,content:"Write report",status:"pending"}],
 sourceTarget:200,minimumWords:4000,discoveredCount:220,openedCount:170,readCount:140,blockedCount:3,failedCount:1,
};
test("review defaults to hundreds of sources and a long report", () => {
 const form=researchPlanForm({title:"Research",plan:["Investigate"]});
 assert.equal(form.questions.find(q=>q.key==="source_target")?.default,200);
 assert.equal(form.questions.find(q=>q.key==="minimum_words")?.default,4000);
});
test("latest progress updates the original approved embed across attempts", () => {
 const tool=(id:string,state:ResearchProgress)=>({id,name:"research_progress",status:"completed",result:JSON.stringify({research:state})});
 const initial=tool("plan",progress);
 const update=tool("read",{...progress,status:"researching",openedCount:190,readCount:180});
 const map=researchTracks([{id:"first",tools:[initial]},{id:"second",tools:[update]}]);
 assert.equal(map.size,1);
 assert.equal(map.get(researchTrackKey("first","plan"))?.readCount,180);
 assert.ok(!map.has(researchTrackKey("second","read")));
 assert.equal(researchProgressFromTool(initial)?.title,"Detailed research");
});
test("tracker shows actual coverage and remains incomplete without a report", () => {
 const html=renderToStaticMarkup(<ResearchProgressCard progress={progress} />);
 assert.match(html,/140\/200 sources fully read/);
 assert.match(html,/Research is not complete yet/);
 assert.doesNotMatch(html,/Report ready/);
 const completed=renderToStaticMarkup(<ResearchProgressCard progress={{...progress,status:"report_attached",downloadUrl:"/api/uploads/chat/report.md",steps:progress.steps.map(step=>({...step,status:"completed"}))}}/>);
 assert.match(completed,/Report ready/);
 assert.match(completed,/Open full report/);
 assert.doesNotMatch(renderToStaticMarkup(<ResearchProgressCard progress={{...progress,status:"report_attached",downloadUrl:"javascript:alert(1)"}}/>),/href=/);
});
test("completed Canvas reports reopen through canonical workspace navigation after reload", () => {
 const complete:ResearchProgress={...progress,status:"report_attached",canvasId:"saved-report",workspaceLink:"workspace://canvas/saved-report",downloadUrl:"/api/uploads/chat/legacy-report.md",steps:progress.steps.map(step=>({...step,status:"completed"}))};
 const raw={id:"report",name:"research_report",status:"completed",input:JSON.stringify({title:"Research",content:"Report content ".repeat(40_000)}),result:JSON.stringify({research:complete,padding:"payload ".repeat(40_000)})};
 const persisted=JSON.parse(JSON.stringify(compactToolForPersistence(raw)));
 const restored=researchProgressFromTool(persisted)!;
 assert.equal(restored.canvasId,"saved-report");
 assert.equal(restored.workspaceLink,"workspace://canvas/saved-report");
 const initial={id:"approved-plan",name:"research_plan",status:"completed",result:JSON.stringify({research:progress})};
 const tracks=researchTracks([{id:"first",tools:[initial]},{id:"continued",tools:[persisted]}]);
 assert.equal(tracks.get(researchTrackKey("first","approved-plan"))?.workspaceLink,complete.workspaceLink);
 assert.deepEqual(researchReportNavigation(restored),{href:"#workspace-saved-report",event:"ai-chat:open-workspace",detail:{type:"canvas",id:"saved-report"}});
 const html=renderToStaticMarkup(<ResearchProgressCard progress={restored}/>);
 assert.match(html,/Open report in Canvas/);
 assert.match(html,/href="#workspace-saved-report"/);
 assert.doesNotMatch(html,/legacy-report|Open full report/);
});
test("older completed report snapshots recover confirmed Canvas metadata through persistence and reload", () => {
 const legacy:ResearchProgress={...progress,status:"report_attached",downloadUrl:"/api/uploads/chat/report.md"};
 const canvas={canvasId:"bridged-report",workspaceLink:"workspace://canvas/bridged-report"};
 const raw={id:"report",name:"research_report",status:"completed",research:legacy,result:JSON.stringify({status:"report_attached",research:legacy,...canvas})};
 for(const tool of [raw,JSON.parse(JSON.stringify(raw)),JSON.parse(JSON.stringify(compactToolForPersistence(raw)))]){
  const restored=researchProgressFromTool(tool)!;
  assert.equal(restored.canvasId,canvas.canvasId);
  assert.equal(restored.workspaceLink,canvas.workspaceLink);
  assert.equal(restored.downloadUrl,legacy.downloadUrl);
  assert.match(renderToStaticMarkup(<ResearchProgressCard progress={restored}/>),/Open report in Canvas/);
 }
 const fromResult=researchProgressFromTool({...raw,research:undefined})!;
 assert.equal(fromResult.canvasId,canvas.canvasId);
 const authoritative={...legacy,canvasId:"existing-report",workspaceLink:"workspace://canvas/existing-report"};
 assert.equal(researchProgressFromTool({...raw,research:authoritative})?.canvasId,"existing-report");
});
test("legacy Canvas destination carriers survive stale worker snapshots and invalid truncated results", () => {
 const carrier:ResearchProgress={...progress,status:"report_attached",downloadUrl:"workspace://canvas/legacy-carried-report"};
 for(const name of ["research_report","research_progress","research_plan"]){
  const tool={id:"legacy-report",name,status:"completed",research:carrier,result:'{"research": { …[truncated 10000 chars]… }'};
  const restored=researchProgressFromTool(JSON.parse(JSON.stringify(tool)))!;
  assert.equal(restored.canvasId,"legacy-carried-report");
  assert.equal(restored.workspaceLink,carrier.downloadUrl);
  assert.equal(restored.downloadUrl,undefined);
  assert.deepEqual(researchReportNavigation(restored),{href:"#workspace-legacy-carried-report",event:"ai-chat:open-workspace",detail:{type:"canvas",id:"legacy-carried-report"}});
  assert.match(renderToStaticMarkup(<ResearchProgressCard progress={restored}/>),/Open report in Canvas/);
  const persisted=JSON.parse(JSON.stringify(compactToolForPersistence(tool)));
  assert.equal(researchProgressFromTool(persisted)?.canvasId,"legacy-carried-report");
 }
 const authoritative={...carrier,canvasId:"embedded",workspaceLink:"workspace://canvas/embedded"};
 assert.equal(researchProgressFromTool({id:"report",name:"research_report",research:authoritative})?.canvasId,"embedded");
 const pending={...carrier,status:"researching"};
 assert.equal(researchProgressFromTool({id:"report",name:"research_report",research:pending})?.workspaceLink,undefined);
 assert.equal(researchProgressFromTool({id:"external",name:"mcp__external__report",research:carrier}),undefined);
 for(const downloadUrl of ["javascript:alert(1)","https://example.test/report","workspace://plan/report","workspace://canvas/a%2Fb","workspace://canvas/%zz"]){
  const restored=researchProgressFromTool({id:"report",name:"research_report",research:{...carrier,downloadUrl}})!;
  assert.equal(restored.workspaceLink,undefined,downloadUrl);
  assert.equal(restored.downloadUrl,undefined,downloadUrl);
 }
});
test("report compatibility bridge ignores invalid or unrelated artifacts", () => {
 const legacy:ResearchProgress={...progress,status:"report_attached",downloadUrl:"/api/uploads/chat/report.md"};
 for(const artifact of [{canvasId:"report"},{workspaceLink:"workspace://canvas/report"},{canvasId:"report",workspaceLink:"workspace://canvas/other"},{canvasId:"report",workspaceLink:"https://example.test/report"},{canvasId:12,workspaceLink:"workspace://canvas/12"}]){
  const restored=researchProgressFromTool({id:"report",name:"research_report",research:legacy,result:JSON.stringify(artifact)})!;
  assert.equal(restored.workspaceLink,undefined);
  assert.equal(restored.downloadUrl,legacy.downloadUrl);
 }
 const artifact={canvasId:"report",workspaceLink:"workspace://canvas/report"};
 for(const failure of [{isError:true},{error:"Unavailable"},{ok:false},{success:false}]){
  assert.equal(researchProgressFromTool({id:"report",name:"research_report",research:legacy,result:JSON.stringify({...artifact,...failure})})?.workspaceLink,undefined);
 }
 assert.equal(researchProgressFromTool({id:"report",name:"research_report",status:"error",research:legacy,result:JSON.stringify(artifact)})?.workspaceLink,undefined);
 for(const name of ["research_plan","research_progress","research_open"]){
  assert.equal(researchProgressFromTool({id:"tool",name,research:legacy,result:JSON.stringify(artifact)})?.workspaceLink,undefined);
 }
 assert.equal(researchProgressFromTool({id:"external",name:"mcp__external__report",research:legacy,result:JSON.stringify({research:legacy,...artifact})}),undefined);
 assert.equal(researchProgressFromTool({id:"report",name:"research_report",research:progress,result:JSON.stringify(artifact)})?.workspaceLink,undefined);
});
test("invalid report workspace links cannot create navigation actions or hide valid progress", () => {
 for(const workspaceLink of ["javascript:alert(1)","https://example.test/report","workspace://plan/report","workspace://canvas/","workspace://canvas/%zz","workspace://canvas/a%2Fb","workspace://canvas/report?other=1","workspace://canvas/report#target"]){
  const supplied={...progress,status:"report_attached",workspaceLink};
  const restored=researchProgressFromTool({id:"report",name:"research_report",research:supplied});
  assert.equal(restored?.readCount,progress.readCount,workspaceLink);
  assert.equal(restored?.workspaceLink,undefined,workspaceLink);
  assert.equal(researchReportNavigation(supplied),undefined,workspaceLink);
  assert.doesNotMatch(renderToStaticMarkup(<ResearchProgressCard progress={supplied}/>),/href=/,workspaceLink);
 }
 const mismatch={...progress,status:"report_attached",canvasId:"different",workspaceLink:"workspace://canvas/report"};
 assert.equal(researchReportNavigation(mismatch),undefined);
 assert.equal(researchProgressFromTool({id:"report",name:"research_report",result:JSON.stringify({research:mismatch})})?.canvasId,undefined);
});
test("tracker controls stay English while preserving the language of user content", () => {
 const html=renderToStaticMarkup(<ResearchProgressCard progress={{...progress,language:"de",title:"Vergleich",steps:[{id:1,content:"Kosten prüfen",status:"in_progress"}]}} running/>);
 assert.match(html,/Research progress/);
 assert.match(html,/sources fully read/);
 assert.match(html,/Current/);
 assert.match(html,/Vergleich/);
 assert.match(html,/Kosten prüfen/);
 assert.doesNotMatch(html,/Recherchefortschritt|Quellen vollständig gelesen|Aktuell/);
});
test("source count and report length are enforced before final Canvas creation; edited steps persist", async () => {
 const root=mkdtempSync(path.join(os.tmpdir(),"metis-research-tracker-"));
 const context={userId:"owner",chatId:"chat",jobId:"run",modeId:"deep-research"};
 let readCount=0,attached=0;
 const options={
  stateDir:root,
  ask:async()=>({questionId:"q",values:{plan:["Edited reading","Detailed report"],decision:"approve",source_target:2,minimum_words:500}}),
  attachReport:async()=>{attached++;return{canvasId:"report-canvas",workspaceLink:"workspace://canvas/report-canvas",markdown:"[Report](workspace://canvas/report-canvas)"};},
  evidence:async()=>({sources:[{},{}],openedCount:2,readCount}),
 };
 try {
  const workflow=createResearchWorkflow(options);
  await workflow.plan({title:"Research",plan:["Original"]},context);
  await assert.rejects(workflow.report({title:"Report",content:"Too short"},context),/0\/2 sources/);
  readCount=2;
  await assert.rejects(workflow.report({title:"Report",content:"Too short"},context),/words/);
  assert.equal(attached,0);
  await workflow.progress({step:1,status:"completed"},context);
  const restored=createResearchWorkflow(options);
  const current=await restored.progress({step:2,status:"in_progress"},context);
  assert.equal(current.research.steps[0].content,"Edited reading");
  assert.equal(current.research.steps[0].status,"completed");
  assert.equal(current.research.readCount,2);
  const result=await restored.report({title:"Report",content:Array(500).fill("Evidence").join(" ")},context);
  assert.equal(result.status,"report_attached");
  assert.equal(attached,1);
  assert.equal((await restored.snapshot(context))?.status,"report_attached");
  assert.ok((await restored.snapshot(context))?.steps.every(step=>step.status==="completed"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
