import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {getSchema} from "@tiptap/core";
import {prosemirrorJSONToYXmlFragment} from "@tiptap/y-tiptap";
import {notesEditorExtensions} from "../lib/notes-editor-extensions";
import {parseNotesMarkdown,serializeNotesMarkdown,notesNodeSignature,type EditorNode} from "../lib/notes-editor-markdown";
import {createNoteCollaborationDocument,noteCollaborationCandidate,noteCollaborationMarkdown} from "../lib/note-collaboration-document";

const schema=getSchema(notesEditorExtensions());
const text=(value:string):EditorNode=>({type:"text",text:value});
const paragraph=(...content:EditorNode[]):EditorNode=>({type:"paragraph",content});
const list=(type:string,value:string):EditorNode=>({type,content:[{type:type==="taskList"?"taskItem":"listItem",...(type==="taskList"?{attrs:{checked:false}}:{}),content:[paragraph(text(value))]}]});
const fixtures:Record<string,EditorNode[]>={
 "Shift+Enter at the end of a paragraph":[paragraph(text("Keep this line"),{type:"hardBreak"})],
 "several trailing and leading hard breaks":[paragraph({type:"hardBreak"},text("Keep me"),{type:"hardBreak"},{type:"hardBreak"})],
 "a source block edited into ordinary Markdown":[{type:"sourceBlock",attrs:{source:"# Still an editable source block",label:"Markdown source"}}],
 "separately dragged bullet lists":[list("bulletList","First"),list("bulletList","Second")],
 "adjacent task and ordinary lists":[list("taskList","Task"),list("bulletList","Normal"),list("orderedList","Number")],
 "separate quotations":[{type:"blockquote",content:[paragraph(text("One"))]},{type:"blockquote",content:[paragraph(text("Two"))]}],
 "split paragraphs with inherited single-newline gaps":[paragraph(text("One")),{...paragraph(text("Two")),attrs:{originalGap:"\n"}}],
 "an empty colored paragraph":[{type:"paragraph",attrs:{blockColor:"blue"}}],
 "nested unrepresentable content":[{type:"bulletList",content:[{type:"listItem",content:[paragraph(text("First"),{type:"hardBreak"})]}]}],
 "an ordinary multiline paragraph":[paragraph(text("First\nsecond"))],
 "a styled ordered list":[{...list("orderedList","Alphabetic"),attrs:{start:3,type:"a"}}],
};
for(const [label,content]of Object.entries(fixtures)){
 test(label+" survives local serialization, server validation and a fresh CRDT snapshot",()=>{
  const json=schema.nodeFromJSON({type:"doc",content}).toJSON() as EditorNode;
  const source=serializeNotesMarkdown(json);
  const expected=notesNodeSignature(json);
  assert.equal(notesNodeSignature(schema.nodeFromJSON(parseNotesMarkdown(source)).toJSON()),expected);
  const document=createNoteCollaborationDocument("");
  const before=Y.encodeStateAsUpdate(document),vector=Y.encodeStateVector(document);
  prosemirrorJSONToYXmlFragment(schema,json,document.getXmlFragment("default"));
  const candidate=noteCollaborationCandidate(before,Y.encodeStateAsUpdate(document,vector),50000);
  assert.equal(candidate.content,source);
  const restored=new Y.Doc();Y.applyUpdate(restored,candidate.state);
  assert.equal(noteCollaborationMarkdown(restored,50000),source);
  assert.equal(notesNodeSignature(schema.nodeFromJSON(parseNotesMarkdown(candidate.content)).toJSON()),expected);
  document.destroy();restored.destroy();
 });
}
test("unmodified Markdown retains exact bytes, and ordinary text edits remain plain Markdown",()=>{
 const source="---\ntitle: Example\n---\n\n# Heading\n\n- item\n\n<!-- keep this -->\n\nTail.\n";
 const document=createNoteCollaborationDocument(source);
 assert.equal(noteCollaborationMarkdown(document,50000),source);
 const tail=document.getXmlFragment("default").get(4) as Y.XmlElement;
 (tail.get(0) as Y.XmlText).insert(0,"Edited ");
 assert.equal(noteCollaborationMarkdown(document,50000),source.replace("Tail.","Edited Tail."));
 document.destroy();
});
test("forged cached source is still rejected before any canonical state is changed",()=>{
 const document=createNoteCollaborationDocument("Actual blocks");
 const before=Y.encodeStateAsUpdate(document),vector=Y.encodeStateVector(document);
 document.getMap("metadata").set("originalSource","Different content");
 assert.throws(()=>noteCollaborationCandidate(before,Y.encodeStateAsUpdate(document,vector),50000),/source does not match/);
 document.destroy();
});
test("parser text fragmentation does not produce a false source mismatch",()=>{
 const source="**first****second**"; // One mark run after ProseMirror normalization.
 const document=createNoteCollaborationDocument(source);
 assert.doesNotThrow(()=>noteCollaborationMarkdown(document,50000));
 document.destroy();
});
