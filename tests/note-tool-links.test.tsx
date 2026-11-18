import assert from "node:assert/strict";
import test, {before} from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createRequire} from "node:module";
import {noteLinkFields} from "../lib/note-reference";
import {parseInternalLink} from "../lib/internal-link";

Object.assign(globalThis,{React});
const require=createRequire(import.meta.url);
require.extensions[".css"]=()=>{};
let ToolCallGroup: typeof import("../components/tool-call-chip").ToolCallGroup;
let ToolCallChip: typeof import("../components/tool-call-chip").ToolCallChip;
let Markdown: typeof import("../components/markdown").Markdown;
before(async()=>{({ToolCallGroup,ToolCallChip}=await import("../components/tool-call-chip"));({Markdown}=await import("../components/markdown"));});

test("agent note links escape titles and render as navigable internal links",()=>{
  const fields=noteLinkFields({id:"report 42",title:"Report [final]\\draft.md"});
  assert.equal(fields.noteLink,"note://report%2042");
  assert.deepEqual(parseInternalLink(fields.noteLink),{kind:"note",id:"report 42"});
  const html=renderToStaticMarkup(<Markdown content={fields.markdown}/>);
  assert.match(html,/href="#note-report%2042"/);
  assert.match(html,/Report \[final\]\\draft/);
  assert.doesNotMatch(html,/\.md/);
});

test("note tools reveal direct saved-note navigation when the activity group opens",()=>{
  const note={id:"note-42",title:"Planning.md",content:"Long report"};
  const tools=[
    {id:"list",name:"list_notes",kind:"note" as const,status:"completed",result:JSON.stringify({notes:[note]})},
    {id:"create",name:"create_note",kind:"note" as const,status:"completed",result:JSON.stringify({content:[{type:"text",text:JSON.stringify({note})}]})},
  ];
  const closed=renderToStaticMarkup(<ToolCallGroup tools={tools}/>);
  assert.match(closed,/aria-expanded="false"/);
  assert.doesNotMatch(closed,/data-tool-call-row/);
  const html=renderToStaticMarkup(<ToolCallGroup tools={tools} autoExpand/>);
  assert.match(html,/aria-expanded="true"/);
  assert.match(html,/href="note:\/\/note-42"/);
  assert.match(html,/aria-label="Open note Planning"/);
  assert.doesNotMatch(html,/Note ready|No note details|Planning\.md/);
});

test("note checklists do not turn into standalone Tasks cards and failed saves expose no success link",()=>{
  const pending=renderToStaticMarkup(<ToolCallChip id="pending" name="create_note" kind="note" status="running" input={JSON.stringify({title:"Draft",todos:[{content:"Draft task"}]})}/>);
  assert.doesNotMatch(pending,/Tasks|href="note:/);
  const failed=renderToStaticMarkup(<ToolCallChip id="failed" name="update_note" kind="note" status="failed" result={JSON.stringify({error:"Conflict",note:{id:"old",title:"Old"}})}/>);
  assert.doesNotMatch(failed,/href="note:|Note ready/);
});
