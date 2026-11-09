import assert from "node:assert/strict";
import test,{before} from "node:test";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
Object.assign(globalThis,{React});
createRequire(import.meta.url).extensions[".css"]=()=>{};
let CanvasWorkspaceCard:typeof import("../components/canvas-workspace-card").CanvasWorkspaceCard;
let PlanWorkspaceCard:typeof import("../components/plan-workspace-card").PlanWorkspaceCard;
before(async()=>{({CanvasWorkspaceCard}=await import("../components/canvas-workspace-card"));({PlanWorkspaceCard}=await import("../components/plan-workspace-card"));});
import {OverlayCloseButton} from "../components/ui/overlay-close-button";
import {LoadError} from "../components/load-error";
import {visibleSettingsTabs,settingsSearchEntries} from "../lib/settings-navigation";

test("workspace cards keep complete titles, have one open action and do not expose technical links",()=>{
  const title="A complete title with a very long project name",content="# Kept text\n\nAn original paragraph.";
  for(const [Component,kind] of [[CanvasWorkspaceCard,"canvas"],[PlanWorkspaceCard,"plan"]] as const){
    const html=renderToStaticMarkup(<Component title={title} content={content} workspaceLink={"workspace://"+kind+"/test"} onOpen={()=>{}}/>);
    assert.ok(html.includes(title));assert.ok(html.includes("An original paragraph."));
    assert.equal((html.match(new RegExp("Open "+kind,"g"))||[]).length,1);
    assert.ok(!html.includes("workspace://"));
    assert.ok(html.includes('aria-label="Copy '+kind+'"'));
    assert.ok(html.includes('aria-label="'+(kind==="canvas"?"Canvas":"Plan")+' preview"'));
  }
});
test("read-only card views cannot acquire opening or build permissions",()=>{
  const canvas=renderToStaticMarkup(<CanvasWorkspaceCard title="Public" content="Visible" workspaceLink="workspace://canvas/private"/>);
  const plan=renderToStaticMarkup(<PlanWorkspaceCard title="Public" content="Visible" workspaceLink="workspace://plan/private" showMultiAgent/>);
  for(const html of [canvas,plan]){assert.ok(!html.includes(">Open "));assert.ok(!html.includes(">Build"));assert.ok(!html.includes(">Parallel"));}
});
test("plan-specific progress, build and parallel actions survive consolidation",()=>{
  const html=renderToStaticMarkup(<PlanWorkspaceCard title="Plan" content={"- [x] One\n- [ ] Two\n- [ ] Three"} onOpen={()=>{}} onBuild={()=>{}} onBuildWithAgents={()=>{}} showMultiAgent buildDisabled/>);
  assert.ok(html.includes('aria-valuenow="33"'));assert.ok(html.includes("1/3 tasks"));
  assert.equal((html.match(/disabled=""/g)||[]).length,5); // Three read-only task boxes, two run actions.
  assert.equal((html.match(/Open plan/g)||[]).length,1);
});
test("dismiss controls remain named, non-submitting and disableable; failed reads offer a named retry",()=>{
  const close=renderToStaticMarkup(<OverlayCloseButton aria-label="Close preview" disabled/>);
  assert.ok(close.includes('aria-label="Close preview"'));assert.ok(close.includes('type="button"'));assert.ok(close.includes('disabled=""'));
  const error=renderToStaticMarkup(<LoadError message="<unsafe>" onRetry={()=>{}} busy/>);
  assert.ok(error.includes('role="alert"'));assert.ok(error.includes("&lt;unsafe&gt;"));assert.ok(error.includes(">Retry<"));assert.ok(error.includes('disabled=""'));
});
test("all settings presentations use a role-scoped category inventory that matches search",()=>{
  for(const admin of [true,false]){
    const tabs=visibleSettingsTabs(admin);
    assert.equal(tabs.some(tab=>tab.value==="admin"),admin);
    assert.ok(tabs.some(tab=>tab.value==="chats"));
    assert.deepEqual(settingsSearchEntries(admin).filter(entry=>!entry.sectionId).map(entry=>entry.tab),tabs.map(tab=>tab.value));
  }
});
