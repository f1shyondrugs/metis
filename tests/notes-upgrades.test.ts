import test from "node:test";
import * as Y from "yjs";
import {applyNoteCollaborationSource,createNoteCollaborationDocument,noteCollaborationMarkdown} from "../lib/note-collaboration-document";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown, serializeNotesMarkdown, notesNodeSignature } from "../lib/notes-editor-markdown";
import { readNotesRichBlock } from "../lib/notes-editor-format";
import { NOTE_BLOCK_COLORS, noteBlockStyle } from "../lib/notes-block-style";
import { notesSpellcheckAttributes, notesSpellcheckChoice } from "../lib/notes-spellcheck";
import { parseInternalLink } from "../lib/internal-link";
import { notesNavigationTarget } from "../lib/notes-navigation";
import { decodeNotesSection } from "../lib/notes-section-navigation";
import { collectNotesMarkdownHeadings } from "../lib/notes-editor-headings";
test("Markdown source edits merge with concurrent block text and preserve exact source",()=>{
  const initial=createNoteCollaborationDocument("# Agenda\n\nShared work begins here.\n\nTail.\n");
  const a=new Y.Doc(),b=new Y.Doc();const state=Y.encodeStateAsUpdate(initial);Y.applyUpdate(a,state);Y.applyUpdate(b,state);
  const source="# Agenda\n\nShared work begins here.\n\nChanged tail.\n";
  applyNoteCollaborationSource(a,source);assert.equal(noteCollaborationMarkdown(a,50000),source);
  const paragraph=b.getXmlFragment("default").get(1) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(0,"Concurrent. ");
  Y.applyUpdate(a,Y.encodeStateAsUpdate(b));Y.applyUpdate(b,Y.encodeStateAsUpdate(a));
  assert.match(noteCollaborationMarkdown(a,50000),/Concurrent\. Shared work begins here\./);
  assert.match(noteCollaborationMarkdown(a,50000),/Changed tail\./);
  assert.equal(noteCollaborationMarkdown(a,50000),noteCollaborationMarkdown(b,50000));
  initial.destroy();a.destroy();b.destroy();
});
const fence=String.fromCharCode(96).repeat(3);
const schema=getSchema(notesEditorExtensions());
test("legacy rich-list links with browser presentation attrs recover without losing source",()=>{
  const rich={type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph"}]},{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"Messages",marks:[{type:"link",attrs:{href:"https://example.com/messages",title:null,target:"_blank",rel:"noopener noreferrer nofollow",class:null}}]}]}]}]};
  const source=fence+"metis-block\n"+JSON.stringify(rich)+"\n"+fence;
  const parsed=parseNotesMarkdown(source);
  assert.equal(parsed.content?.[0].type,"bulletList");
  assert.equal(serializeNotesMarkdown(parsed),source);
  assert.ok(readNotesRichBlock(JSON.stringify(rich)));
});
test("new colored rich blocks strip native link attrs and round-trip colors and links",()=>{
  const node=schema.nodeFromJSON({type:"doc",content:[{type:"paragraph",attrs:{blockColor:"blue",blockId:"section-1"},content:[{type:"text",text:"Link",marks:[{type:"underline"},{type:"link",attrs:{href:"https://example.com"}}]}]}]});
  const source=serializeNotesMarkdown(node.toJSON());
  assert.doesNotMatch(source,/"target"|"rel"|"class"/);
  const parsed=parseNotesMarkdown(source);
  assert.equal(parsed.content?.[0].attrs?.blockColor,"blue");
  assert.equal(notesNodeSignature(parsed),notesNodeSignature(node.toJSON()));
  assert.match(source,/https:\/\/example.com/);
  assert.equal(noteBlockStyle("javascript:alert(1)"),undefined);
  for(const color of Object.keys(NOTE_BLOCK_COLORS))assert.ok(noteBlockStyle(color));
});
test("spellcheck has explicit off and language attributes; unknown saved choices reset safely",()=>{
  assert.deepEqual(notesSpellcheckAttributes("off"),{spellcheck:"false"});
  assert.deepEqual(notesSpellcheckAttributes("de-DE"),{spellcheck:"true",lang:"de-DE"});
  assert.equal(notesSpellcheckChoice("<script>"),"auto");
});
test("section links accept Unicode slugs and preserve canonical block links",()=>{
  assert.equal(parseInternalLink("note://note-1#block-section-1")?.blockId,"section-1");
  assert.equal(parseInternalLink("note://note-1#"+encodeURIComponent("计划"))?.blockId,"计划");
  assert.equal(notesNavigationTarget("#note-note-1/block-"+encodeURIComponent("计划"))?.kind,"note");
  assert.equal((notesNavigationTarget("#note-note-1/block-"+encodeURIComponent("计划")) as {blockId?:string})?.blockId,"计划");
  assert.equal(parseInternalLink("note://note-1#%ZZ"),null);
  assert.equal(decodeNotesSection("#%ZZ"),null);
});
test("heading slugs are unique, and copied heading IDs survive renaming",()=>{
  const headings=collectNotesMarkdownHeadings("# Plan\n\n# Plan\n\n## Later\n\n<!-- metis:block:fixed -->");
  assert.equal(headings[0].slug,"plan");assert.equal(headings[1].slug,"plan-2");
  assert.equal(headings[2].id,"block-fixed");
  assert.equal(collectNotesMarkdownHeadings("## Renamed\n\n<!-- metis:block:fixed -->")[0].id,"block-fixed");
});
