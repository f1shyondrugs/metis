import assert from "node:assert/strict";
import test, {before} from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createRequire} from "node:module";
import type {ToolCallData} from "../components/tool-call-chip";
import { compactChatPageMessages } from "../lib/chat-page-payload";
Object.assign(globalThis,{React});
const require=createRequire(import.meta.url);
require.extensions[".css"]=()=>{};
let Group: typeof import("../components/tool-call-chip").ToolCallGroup;
let Preview: typeof import("../components/tool-call-preview").ToolCallPreview;
before(async()=>{
  ({ToolCallGroup:Group}=await import("../components/tool-call-chip"));
  ({ToolCallPreview:Preview}=await import("../components/tool-call-preview"));
});
const kinds: NonNullable<ToolCallData["kind"]>[] = ["read","edit","shell","todo","plan","canvas","memory","automation","note","browser","subagent","mcp","compaction","other"];

test("every tool kind retains a compact row in input order without inventing cards from missing results",()=>{
  const tools=kinds.map((kind,index)=>({id:String(index),name:kind+" operation",kind,status:"completed"}));
  const html=renderToStaticMarkup(<Group tools={tools}/>);
  assert.equal((html.match(/data-tool-call-group=/g)||[]).length,1);
  assert.equal((html.match(/data-tool-call-row=/g)||[]).length,0);
  const expanded=renderToStaticMarkup(<Group tools={tools} autoExpand/>);
  assert.equal((expanded.match(/data-tool-call-row=/g)||[]).length,kinds.length);
  assert.match(html,/aria-expanded="false"/);
  const rendered=[...expanded.matchAll(/data-tool-kind="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(rendered,kinds);
  assert.doesNotMatch(html,/Task checklist|Memory details|Build with/);
});

test("a single wrapped write_todos call follows the same collapsed path",()=>{
  const html=renderToStaticMarkup(<Group tools={[{id:"task",name:"call_mcp_tool",status:"completed",input:JSON.stringify({toolName:"write_todos",arguments:{todos:[{content:"Check layout",status:"pending"}]}})}]}/>);
  assert.doesNotMatch(html,/data-tool-call-row=/);
  assert.match(html,/aria-expanded="false"/);
  const expanded=renderToStaticMarkup(<Group autoExpand tools={[{id:"task",name:"call_mcp_tool",status:"completed",input:JSON.stringify({toolName:"write_todos",arguments:{todos:[{content:"Check layout",status:"pending"}]}})}]}/>);
  assert.match(expanded,/Updated tasks/);
  assert.match(html,/aria-expanded="false"/);
  assert.doesNotMatch(html,/0\/1 completed/);
  assert.doesNotMatch(html,/Task checklist/);
});

test("task preview preserves full content, completion and an empty checklist",()=>{
  const html=renderToStaticMarkup(<Preview tool={{name:"write_todos",kind:"todo",status:"completed",todos:[{id:"one",content:"Completed task",status:"completed"},{id:"two",content:"Still working",status:"in_progress"}]}}/>);
  assert.match(html,/Task checklist/);
  assert.match(html,/1\/2/);
  assert.match(html,/Completed task/);
  assert.match(html,/Still working/);
  assert.match(html,/in_progress/);
  const empty=renderToStaticMarkup(<Preview tool={{name:"write_todos",kind:"todo",status:"completed",todos:[]}}/>);
  assert.match(empty,/No tasks/);
});

test("failed calls remain visible and failed workspace results offer no success preview",()=>{
  const html=renderToStaticMarkup(<Group autoExpand tools={[{id:"failed",name:"create_plan",kind:"plan",status:"failed",input:JSON.stringify({content:"Draft"})}]}/>);
  assert.match(html,/Failed/);
  assert.match(html,/data-tool-kind="plan"/);
  const failed=renderToStaticMarkup(<Preview tool={{name:"create_plan",kind:"plan",status:"completed",input:JSON.stringify({content:"Draft"}),result:JSON.stringify({isError:true,error:"Conflict"})}}/>);
  assert.equal(failed,"");
});

// Inspect the visible saved artifacts independently of the activity controls.
function visibleMarkup(html: string): string {
  const stack: boolean[] = [];
  let hidden = false;
  let visible = "";
  for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("</")) {
      const parentHidden = stack.pop();
      if (!hidden) visible += token;
      hidden = parentHidden ?? false;
    } else if (token.startsWith("<")) {
      const nextHidden: boolean = hidden || /\shidden(?:=|\s|>)/.test(token);
      if (!nextHidden) visible += token;
      if (!/^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(token) && !token.endsWith("/>")) {
        stack.push(hidden);
        hidden = nextHidden;
      }
    } else if (!hidden) visible += token;
  }
  return visible;
}

test("collapsed groups show successful create and edit cards in call order", () => {
  const tools: ToolCallData[] = [
    { id: "plan-create", name: "create_plan", kind: "plan", status: "completed",
      input: JSON.stringify({ title: "Draft title", content: "Draft plan" }),
      result: JSON.stringify({ id: "plan-one", name: "Created plan", content: "Stored plan", workspaceLink: "workspace://plan/plan-one" }) },
    { id: "canvas-create", name: "mcp__metis_ai__create_canvas", kind: "canvas", status: "completed",
      result: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ id: "canvas-one", name: "Created canvas", content: "Stored canvas", workspaceLink: "workspace://canvas/canvas-one" }) }] }) },
    { id: "memory-create", name: "add_memory", kind: "memory", status: "completed",
      input: JSON.stringify({ content: "Submitted fact" }),
      result: JSON.stringify({ scope: "chat", memory: { id: "memory-one", content: "Stored fact" } }) },
    { id: "plan-edit", name: "edit_plan", kind: "plan", status: "completed",
      input: JSON.stringify({ title: "Edited plan", content: "Updated plan body" }),
      result: JSON.stringify({ id: "plan-one", name: "Plan", content: "", workspaceLink: "workspace://plan/plan-one" }) },
    { id: "canvas-edit", name: "edit_canvas", kind: "canvas", status: "completed",
      result: JSON.stringify({ workspaceLink: "workspace://canvas/canvas-two" }) },
    { id: "memory-edit", name: "edit_memory", kind: "memory", status: "completed",
      result: JSON.stringify({ scope: "global", memory: { id: "memory-two", content: "Updated fact" } }) },
  ];
  const html = renderToStaticMarkup(<Group tools={tools}
    workspaces={[{ id: "canvas-two", type: "canvas", name: "Edited canvas", content: "Live canvas body" }]}
    onOpenWorkspace={() => {}} onBuildPlan={() => {}} />);
  assert.match(html, /aria-expanded="false"/);
  assert.equal((html.match(/data-tool-call-row=/g) || []).length, 0);
  assert.equal((html.match(/data-workspace-card=/g) || []).length, 4);
  const visible = visibleMarkup(html);
  const titles = ["Created plan", "Created canvas", "Saved Chat Memory", "Edited plan", "Edited canvas", "Updated Global Memory"];
  let previous = -1;
  for (const title of titles) {
    const position = visible.indexOf(title);
    assert.ok(position > previous, title + " should be visible in call order");
    previous = position;
  }
  for (const content of ["Stored plan", "Stored canvas", "Stored fact", "Updated plan body", "Live canvas body", "Updated fact"]) {
    assert.ok(visible.includes(content), content + " should be visible with activity collapsed");
  }
  assert.equal((visible.match(/>Open plan<\/button>/g) || []).length, 2);
  assert.equal((visible.match(/>Open canvas<\/button>/g) || []).length, 2);
});

test("unsaved, failed and running mutations expose no inline saved card", () => {
  const result = JSON.stringify({ id: "artifact", content: "Never show as saved", workspaceLink: "workspace://plan/artifact" });
  for (const [name, kind] of [["create_plan", "plan"], ["edit_plan", "plan"], ["create_canvas", "canvas"], ["edit_canvas", "canvas"], ["add_memory", "memory"], ["edit_memory", "memory"]] as const) {
    for (const state of [
      { status: "running", result: undefined },
      { status: "running", result },
      { status: "completed", result: undefined },
      { status: "completed", result: "" },
      { status: "completed", result: "{}" },
      { status: "completed", result: "null" },
      { status: "completed", result: '{"id":"truncated', resultUrl: "/full/result" },
      { status: "failed", result },
      { status: "cancelled", result },
      { status: "completed", result: JSON.stringify({ isError: true, error: "Conflict" }) },
      { status: "completed", result: JSON.stringify({ success: false }) },
      { status: "completed", result: JSON.stringify({ ok: false }) },
      { status: "completed", result: JSON.stringify({ structured_content: { isError: true } }) },
      { status: "completed", result: JSON.stringify({ structuredContent: { error: "Conflict" } }) },
    ]) {
      const html = renderToStaticMarkup(<Group tools={[{ id: name, name, kind, input: JSON.stringify({ content: "Unsaved draft" }), ...state }]} />);
      const visible = visibleMarkup(html);
      assert.doesNotMatch(visible, /Memory details|workspace:\/\/|Unsaved draft|Never show as saved|Live Markdown|>Build</, name + " " + state.status);
    }
  }
});

test("inline preview retains the saved workspace and build callbacks", () => {
  const events: unknown[] = [];
  const result = JSON.stringify({ id: "saved-plan", name: "Saved plan", content: "Saved content", workspaceLink: "workspace://plan/saved-plan" });
  const preview = Preview({ inline: true, tool: { name: "edit_plan", kind: "plan", status: "completed", result },
    onOpenWorkspace: () => events.push("open"),
    onBuildPlan: (plan, options) => events.push({ plan, options }),
  });
  assert.ok(preview);
  preview.props.onOpen();
  preview.props.onBuild();
  preview.props.onBuildWithAgents();
  assert.deepEqual(events, [
    "open",
    { plan: { title: "Saved plan", content: "Saved content", workspaceLink: "workspace://plan/saved-plan" }, options: undefined },
    { plan: { title: "Saved plan", content: "Saved content", workspaceLink: "workspace://plan/saved-plan" }, options: { multiAgent: true } },
  ]);
  const canvas = Preview({ inline: true, tool: { name: "edit_canvas", kind: "canvas", status: "completed",
    result: JSON.stringify({ workspaceLink: "workspace://canvas/saved-canvas" }) },
    workspaces: [{ id: "saved-canvas", type: "canvas", name: "Live canvas", content: "Live content" }],
    onOpenWorkspace: () => events.push("canvas"),
  });
  assert.ok(canvas);
  assert.equal(canvas.props.workspaceLink, "workspace://canvas/saved-canvas");
  canvas.props.onOpen();
  assert.equal(events.at(-1), "canvas");
});

test("deferred previews retain lazy open and build controls without loading full history", () => {
  const result = JSON.stringify({ id: "deferred-plan", name: "Deferred plan", workspaceLink: "workspace://plan/deferred-plan" });
  const html = renderToStaticMarkup(<Group tools={[{ id: "deferred", name: "create_plan", kind: "plan", status: "completed",
    input: JSON.stringify({ content: "Short preview…" }), inputUrl: "/full/input", result, resultUrl: "/full/result" }]}
    onOpenWorkspace={() => {}} onBuildPlan={() => {}} buildDisabled />);
  const visible = visibleMarkup(html);
  assert.match(visible, /Deferred plan/);
  assert.match(visible, /data-workspace-card="plan"/);
  assert.match(visible, />Open plan<\/button>/);
  assert.match(visible, /disabled=""/);
  assert.doesNotMatch(visible, /Loading tool details/);
});

test("compacted long saved results keep their inline cards after loading history", () => {
  const tools: ToolCallData[] = [
    { id: "history-plan", name: "mcp__metis_ai__create_plan", kind: "plan", status: "completed",
      result: JSON.stringify({ id: "plan-history", name: "Historical plan", content: "Stored plan ".repeat(400), workspaceLink: "workspace://plan/plan-history" }) },
    { id: "history-canvas", name: "edit_canvas", kind: "canvas", status: "completed",
      result: JSON.stringify({ id: "canvas-history", name: "Historical canvas", content: "Stored canvas ".repeat(400), workspaceLink: "workspace://canvas/canvas-history" }) },
    { id: "history-memory", name: "add_memory", kind: "memory", status: "completed",
      result: JSON.stringify({ scope: "project", memory: { id: "fact-history", content: "Stored fact ".repeat(400) } }) },
  ];
  const [message] = compactChatPageMessages([{ id: "history", role: "assistant", content: "", createdAt: "2026-10-27T00:00:00Z", tools }], "history-chat");
  assert.ok(message.tools?.every(tool => tool.resultUrl));
  const visible = visibleMarkup(renderToStaticMarkup(<Group tools={message.tools!} onOpenWorkspace={() => {}} onBuildPlan={() => {}} />));
  for (const text of ["Historical plan", "Historical canvas", "Saved Project Memory", "Stored plan", "Stored canvas", "Stored fact", 'data-workspace-card="plan"', 'data-workspace-card="canvas"']) {
    assert.ok(visible.includes(text), text + " should survive history compaction");
  }
});

test("completed edits may use a verified saved workspace when their response is absent", () => {
  const html = renderToStaticMarkup(<Group tools={[{ id: "saved-edit", name: "edit_canvas", kind: "canvas", status: "completed",
    input: JSON.stringify({ id: "saved-canvas", content: "Submitted edit" }) }]}
    workspaces={[{ id: "saved-canvas", type: "canvas", name: "Saved canvas", content: "Actual saved content" }]} />);
  const visible = visibleMarkup(html);
  assert.match(visible, /Saved canvas/);
  assert.match(visible, /Actual saved content/);
  assert.doesNotMatch(visible, /Submitted edit/);
});

test("list, delete, note, task and automation calls keep their compact presentation", () => {
  const tools: ToolCallData[] = [
    { id: "list", name: "list_memories", kind: "memory", status: "completed", result: JSON.stringify({ memories: [{ content: "Listed fact" }] }) },
    { id: "delete", name: "delete_canvas", kind: "canvas", status: "completed", result: JSON.stringify({ id: "deleted", content: "Deleted content" }) },
    { id: "note", name: "create_note", kind: "note", status: "completed", result: JSON.stringify({ note: { id: "note", title: "Normal note" } }) },
    { id: "tasks", name: "write_todos", kind: "todo", status: "completed", todos: [{ content: "Normal task" }] },
    { id: "automation", name: "create_automation", kind: "automation", status: "completed", result: JSON.stringify({ automation: { id: "timer", name: "Normal timer", prompt: "Check" } }) },
  ];
  const html = renderToStaticMarkup(<Group tools={tools} />);
  assert.equal((html.match(/data-tool-call-row=/g) || []).length, 0);
  const expanded=renderToStaticMarkup(<Group tools={tools} autoExpand/>);
  assert.equal((expanded.match(/data-tool-call-row=/g) || []).length, tools.length);
  assert.doesNotMatch(visibleMarkup(html), /Memory details|Listed fact|Deleted content|Normal note|Normal task|Normal timer/);
});

test("canvas and memory details preserve readable stored content",()=>{
  const canvas=renderToStaticMarkup(<Preview tool={{name:"edit_canvas",kind:"canvas",status:"completed",result:JSON.stringify({workspaceLink:"workspace://canvas/canvas-one"})}} workspaces={[{id:"canvas-one",type:"canvas",name:"Canvas title",content:"Preserved canvas body"}]}/>);
  assert.match(canvas,/Canvas title/);
  assert.match(canvas,/Preserved canvas body/);
  const memory=renderToStaticMarkup(<Preview tool={{name:"add_memory",kind:"memory",status:"completed",result:JSON.stringify({scope:"chat",memory:{content:"Stored fact"}})}}/>);
  assert.match(memory,/Saved Chat Memory/);
  assert.match(memory,/Stored fact/);
});
