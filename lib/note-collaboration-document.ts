import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { notesEditorExtensions } from "./notes-editor-extensions";
import { parseNotesMarkdown, createNotesMarkdownSerializer, notesNodeSignature } from "./notes-editor-markdown";
import { normalizeNotesLinkAttributes, validNotesRichNode } from "./notes-editor-format";

export const MAX_NOTE_COLLAB_BYTES = 2*1024*1024;
const schema=getSchema(notesEditorExtensions());
export function createNoteCollaborationDocument(content:string) {
  const parsed=parseNotesMarkdown(content);
  const document=prosemirrorJSONToYDoc(schema,parsed,"default");
  for(const [key,value] of Object.entries(parsed.attrs||{}))if(value!=null)document.getMap("metadata").set(key,value);
  return document;
}
export const NOTE_SOURCE_ORIGIN = "metis-notes-source";
export function applyNoteCollaborationSource(document:Y.Doc,content:string) {
  const parsed=parseNotesMarkdown(content);
  schema.nodeFromJSON(parsed).check();
  document.transact(()=>{
    const metadata=document.getMap("metadata");
    for(const key of metadata.keys())if(!(key in (parsed.attrs||{})))metadata.delete(key);
    for(const [key,value] of Object.entries(parsed.attrs||{}))if(value!=null)metadata.set(key,value);
    prosemirrorJSONToYXmlFragment(schema,parsed,document.getXmlFragment("default"));
  },NOTE_SOURCE_ORIGIN);
}
export function noteCollaborationMarkdown(document:Y.Doc,maxLength:number) {
  if([...document.share.keys()].some(key=>!["default","metadata"].includes(key)))throw Error("Unsupported document field.");
  const attributes=document.getMap("metadata").toJSON();
  for(const [key,value]of Object.entries(attributes))if(!["originalSource","sourceSignature","originalGap","originalTrailing"].includes(key)||typeof value!=="string"||value.length>maxLength*4)throw Error("Invalid document metadata.");
  const fragment=yXmlFragmentToProseMirrorRootNode(document.getXmlFragment("default"),schema);
  const node=schema.topNodeType.create(attributes,fragment.content);node.check();
  for(const child of node.toJSON().content||[])if(!validNotesRichNode(normalizeNotesLinkAttributes(child)))throw Error("Unsupported block data.");
  const content=createNotesMarkdownSerializer()(node);
  if(content.length>maxLength)throw Error("Document is full. Remove some content before adding more.");
  if(notesNodeSignature(schema.nodeFromJSON(parseNotesMarkdown(content)).toJSON())!==notesNodeSignature(node.toJSON()))throw Error("Document source does not match its blocks.");
  return content;
}
export function noteCollaborationCandidate(state:Uint8Array,update:Uint8Array,maxLength:number) {
  if(update.byteLength>MAX_NOTE_COLLAB_BYTES)throw Error("Document update is too large.");
  const document=new Y.Doc();
  try{
    Y.applyUpdate(document,state);Y.applyUpdate(document,update);
    const content=noteCollaborationMarkdown(document,maxLength);
    const next=Y.encodeStateAsUpdate(document);
    if(next.byteLength>MAX_NOTE_COLLAB_BYTES)throw Error("Document collaboration history is full.");
    return {state:next,content};
  }finally{document.destroy();}
}
