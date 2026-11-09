import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSubfiles } from "../components/notes/note-subfiles";
Object.assign(globalThis, { React });

test("subfiles start with five named entries and a disclosure for all remaining items", () => {
  const notes = Array.from({length:8}, (_,i) => ({id:String(i),title:"Page "+i+".md",icon:i===0?"🦁":null}));
  const html = renderToStaticMarkup(<NoteSubfiles notes={notes} onOpenNote={()=>{}}/>);
  assert.equal((html.match(/<li /g)||[]).length,5);
  assert.match(html,/Page 4/);
  assert.doesNotMatch(html,/Page 5|\.md/);
  assert.match(html,/Show 3 more/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/🦁/);
});

test("five or fewer subfiles need no disclosure; empty pages have no extra section", () => {
  assert.equal(renderToStaticMarkup(<NoteSubfiles notes={[]} onOpenNote={()=>{}}/>),"");
  const html = renderToStaticMarkup(<NoteSubfiles notes={[{id:"one",title:"One"}]} onOpenNote={()=>{}}/>);
  assert.match(html,/One/);
  assert.doesNotMatch(html,/aria-expanded|Show.*more/);
});
