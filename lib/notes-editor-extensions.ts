import { noteBlockStyle } from "./notes-block-style";
import { uniqueHeadingSlug } from "./notes-section-navigation";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const NOTES_BLOCK_TYPES = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "codeBlock", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader", "sourceBlock", "mathBlock", "callout", "toggleBlock", "columns", "column", "pageReference", "embedBlock", "tableOfContents"];
const metadataAttributes = Object.fromEntries(["originalSource", "sourceSignature", "originalGap", "originalTrailing", "blockId", "blockColor"].map((key) => [key, { default: null, rendered: false }]));
export const NotesSourceMetadata = Extension.create({
  name: "notesSourceMetadata",
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations: (state) => {
      const decorations: Decoration[] = [];
      const used = new Set<string>();
      state.doc.descendants(node => { if (node.attrs.blockId) used.add("block-" + node.attrs.blockId); });
      state.doc.descendants((node, pos) => {
        if (!node.isBlock) return;
        const attrs: Record<string,string> = {};
        if (node.attrs.blockId) { attrs["data-block-id"] = String(node.attrs.blockId); attrs.id = "block-" + node.attrs.blockId; }
        if (node.type.name === "heading") {
          const slug = uniqueHeadingSlug(node.textContent, used); attrs["data-section-slug"] = slug;
          if (!attrs.id) attrs.id = slug;
        }
        const style = noteBlockStyle(node.attrs.blockColor);
        if (style) { attrs["data-block-color"] = String(node.attrs.blockColor); attrs.style = "border-inline-start:" + style.borderInlineStart + ";padding-inline-start:" + style.paddingInlineStart; }
        if (Object.keys(attrs).length) decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
      });
      return DecorationSet.create(state.doc, decorations);
    } } })];
  },
  addGlobalAttributes() {
    return [
      { types: ["doc", ...NOTES_BLOCK_TYPES], attributes: metadataAttributes },
      { types: ["link"], attributes: { title: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("title"), renderHTML: (attrs: Record<string, unknown>) => attrs.title ? { title: String(attrs.title) } : {} } } },
      { types: ["codeBlock"], attributes: { meta: { default: null, rendered: false } } },
      { types: ["tableCell", "tableHeader"], attributes: { align: { default: null, parseHTML: (element: HTMLElement) => element.style.textAlign || null, renderHTML: (attrs: Record<string, unknown>) => attrs.align ? { style: "text-align:" + attrs.align } : {} } } },
    ];
  },
});
export const NotesSourceBlock = Node.create({
  name: "sourceBlock", group: "block", atom: true, draggable: true, selectable: true,
  addAttributes() { return { source: { default: "" }, label: { default: "Markdown source" } }; },
  parseHTML() { return [{ tag: "div[data-notes-source]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-notes-source": "", class: "notes-source-block" }), ["pre", {}, String(node.attrs.source)]]; },
});
export const NotesMathBlock = Node.create({
  name: "mathBlock", group: "block", atom: true, draggable: true,
  addAttributes() { return { latex: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-notes-math]" }]; },
  renderHTML({ node }) { return ["div", { "data-notes-math": "", class: "notes-math-block" }, String(node.attrs.latex)]; },
});
export const NotesInlineMath = Node.create({
  name: "inlineMath", group: "inline", inline: true, atom: true,
  addAttributes() { return { latex: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-notes-inline-math]" }]; },
  renderHTML({ node }) { return ["span", { "data-notes-inline-math": "", class: "notes-inline-math" }, String(node.attrs.latex)]; },
});
export const NotesCallout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true, draggable: true,
  addAttributes() { return { tone: { default: "info" } }; },
  parseHTML() { return [{ tag: "aside[data-notes-callout]" }]; },
  renderHTML({ node }) { return ["aside", { "data-notes-callout": node.attrs.tone, class: "notes-callout" }, 0]; },
});
export const NotesToggle = Node.create({
  name: "toggleBlock", group: "block", content: "block+", defining: true, draggable: true,
  addAttributes() { return { title: { default: "Toggle" }, open: { default: true } }; },
  parseHTML() { return [{ tag: "section[data-notes-toggle]" }]; },
  renderHTML({ node }) { return ["section", { "data-notes-toggle": "", class: "notes-toggle-block" }, ["div", { class: "notes-toggle-title", contenteditable: "false" }, String(node.attrs.title)], ["div", {}, 0]]; },
});
export const NotesColumns = Node.create({
  name: "columns", group: "block", content: "column{2,3}", defining: true, isolating: true, draggable: true,
  parseHTML() { return [{ tag: "div[data-notes-columns]" }]; },
  renderHTML() { return ["div", { "data-notes-columns": "", class: "notes-columns" }, 0]; },
});
export const NotesColumn = Node.create({
  name: "column", content: "block+", defining: true, isolating: true,
  parseHTML() { return [{ tag: "div[data-notes-column]" }]; },
  renderHTML() { return ["div", { "data-notes-column": "", class: "notes-column" }, 0]; },
});
export const NotesPageReference = Node.create({
  name: "pageReference", group: "block", atom: true, draggable: true,
  addAttributes() { return { noteId: { default: "" }, title: { default: "Page" } }; },
  parseHTML() { return [{ tag: "div[data-notes-page]" }]; },
  renderHTML({ node }) { return ["div", { "data-notes-page": String(node.attrs.noteId), class: "notes-page-reference" }, ["a", { href: "metis://note/" + encodeURIComponent(String(node.attrs.noteId)) }, "↗ " + String(node.attrs.title)]]; },
});
export const NotesEmbed = Node.create({
  name: "embedBlock", group: "block", atom: true, draggable: true,
  addAttributes() { return { url: { default: "" }, title: { default: "" } }; },
  parseHTML() { return [{ tag: "div[data-notes-embed]" }]; },
  renderHTML({ node }) { return ["div", { "data-notes-embed": "", class: "notes-embed-block" }, ["a", { href: String(node.attrs.url), target: "_blank", rel: "noopener noreferrer" }, String(node.attrs.title || node.attrs.url)]]; },
});
export const NotesTableOfContents = Node.create({
  name: "tableOfContents", group: "block", atom: true, draggable: true,
  addAttributes() { return { version: { default: 1 } }; },
  parseHTML() { return [{ tag: "nav[data-notes-toc]" }]; },
  renderHTML() { return ["nav", { "data-notes-toc": "", class: "notes-table-of-contents" }, "Table of contents"]; },
});
export function notesEditorExtensions(collaborative = false) {
  return [
    StarterKit.configure({ ...(collaborative ? {undoRedo:false as const} : {}), trailingNode: false, link: { openOnClick: false, autolink: true, protocols: ["metis", "note", "issue", "workspace"] }, heading: { levels: [1,2,3,4,5,6] } }),
    TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: true, allowBase64: false }), TextStyle, Color, Highlight.configure({ multicolor: true }),
    Placeholder.configure({ placeholder: "Write something, or type / for blocks…", includeChildren: true }),
    NotesSourceMetadata, NotesSourceBlock, NotesMathBlock, NotesInlineMath, NotesCallout, NotesToggle, NotesColumns, NotesColumn, NotesPageReference, NotesEmbed, NotesTableOfContents,
  ];
}
