import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { protectMathTablePipes, restoreMathTablePipes } from "./markdown-math-tables";
import { getSchema } from "@tiptap/core";
import { type Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { notesEditorExtensions } from "./notes-editor-extensions";
import { serializeNotesBlock } from "./notes-editor-serialize";

/** The persisted contract is Markdown. Unedited source is retained byte for byte.
 * Unsupported syntax stays in a visible, editable source block, never discarded.
 * Rich-only containers use a fenced metis-block JSON envelope; see notes-editor-format.md.
 */
export type { EditorNode } from "./notes-editor-format";
import { type EditorNode, NOTES_SOURCE_METADATA as metadata, NOTES_SEMANTIC_ATTRIBUTES as semanticAttributes, NOTES_RICH_CONTAINERS as containers, validNotesRichNode as validEnvelope } from "./notes-editor-format";
type Ast = {
  type: string; value?: string; depth?: number; lang?: string; meta?: string;
  url?: string; title?: string | null; alt?: string | null; ordered?: boolean;
  start?: number | null; checked?: boolean | null; align?: (string | null)[];
  children?: Ast[]; position?: { start: { offset?: number }; end: { offset?: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
function clean(node: EditorNode): unknown {
  const attrs = Object.fromEntries(Object.entries(node.attrs || {}).filter(([key, value]) => {
    if (metadata.has(key) || value === null || value === undefined || value === "") return false;
    if ((key === "colspan" || key === "rowspan") && value === 1) return false;
    if (key === "start" && value === 1) return false;
    if (key === "open" && value === true) return false;
    return (semanticAttributes[node.type] || ["blockId"]).includes(key);
  }).sort(([a], [b]) => a.localeCompare(b)));
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks?.length ? { marks: node.marks.map((mark) => clean(mark)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) } : {}),
    ...(node.content?.length ? { content: node.content.map(clean) } : {}),
  };
}
export const notesNodeSignature = (node: EditorNode) => JSON.stringify(clean(node));
function raw(source: string, label = "Markdown source"): EditorNode {
  return { type: "sourceBlock", attrs: { source, label } };
}
function inline(nodes: Ast[] = []): EditorNode[] {
  return nodes.flatMap((node): EditorNode[] => {
    if (node.type === "text") return node.value ? [{ type: "text", text: node.value }] : [];
    if (node.type === "break") return [{ type: "hardBreak" }];
    if (node.type === "inlineCode") return [{ type: "text", text: node.value || "", marks: [{ type: "code" }] }];
    if (node.type === "inlineMath") return [{ type: "inlineMath", attrs: { latex: node.value || "" } }];
    if (node.type === "image") return [{ type: "image", attrs: { src: node.url, alt: node.alt || "", title: node.title || null } }];
    const mark = ({ strong: "bold", emphasis: "italic", delete: "strike", link: "link" } as Record<string, string>)[node.type];
    if (mark) {
      return inline(node.children).map((child) => ({
        ...child, marks: [...(child.marks || []), { type: mark, ...(mark === "link" ? { attrs: { href: node.url, title: node.title || null } } : {}) }],
      }));
    }
    throw new Error("Unsupported inline " + node.type);
  });
}
let envelopeSchema: Schema | undefined;
function validateEnvelopeSchema(node: EditorNode) {
  envelopeSchema ||= getSchema(notesEditorExtensions());
  const normalized = envelopeSchema.nodeFromJSON(node);
  normalized.check();
  return normalized.toJSON() as EditorNode;
}
function block(node: Ast, source: string): EditorNode {
  const children = () => (node.children || []).map((child) => block(child, source));
  const sourceFor = () => source.slice(node.position?.start.offset || 0, node.position?.end.offset || 0);
  switch (node.type) {
    case "paragraph": {
      if(node.children?.length===1 && node.children[0].type==="inlineMath" && /^\$\$[\s\S]+\$\$$/.test(sourceFor().trim()))return {type:"mathBlock",attrs:{latex:node.children[0].value || ""}};
      const content = inline(node.children);
      // Images are inline in this editor, matching Markdown's inline semantics.
      return { type: "paragraph", content };
    }
    case "heading": return { type: "heading", attrs: { level: node.depth }, content: inline(node.children) };
    case "blockquote": return { type: "blockquote", content: children() };
    case "list": {
      const tasks = (node.children || []).filter((child) => typeof child.checked === "boolean");
      if (tasks.length && (node.ordered || tasks.length !== node.children?.length)) throw new Error("Mixed task list");
      return { type: tasks.length ? "taskList" : node.ordered ? "orderedList" : "bulletList", ...(node.ordered ? { attrs: { start: node.start || 1 } } : {}), content: (node.children || []).map((item) => ({ type: tasks.length ? "taskItem" : "listItem", ...(tasks.length ? { attrs: { checked: Boolean(item.checked) } } : {}), content: (item.children || []).map((child) => block(child, source)) })) };
    }
    case "code": {
      if (node.lang === "metis-block") {
        try { const value = JSON.parse(node.value || ""); if (validEnvelope(value) && !["text", "hardBreak", "inlineMath", "column"].includes(value.type)) { return validateEnvelopeSchema(value); } } catch {}
        return raw(sourceFor(), "Invalid metis-block source");
      }
      if (["mermaid", "chart", "graph", "file"].includes(node.lang || "")) return raw(sourceFor(), node.lang || "Source");
      return { type: "codeBlock", attrs: { language: node.lang || null, meta: node.meta || null }, content: node.value ? [{ type: "text", text: node.value }] : [] };
    }
    case "math": return { type: "mathBlock", attrs: { latex: node.value || "" } };
    case "thematicBreak": return { type: "horizontalRule" };
    case "table": {
      const width = node.children?.[0]?.children?.length || 0;
      if (!width || node.children?.some((row) => row.children?.length !== width)) throw new Error("Ragged table");
      return { type: "table", content: (node.children || []).map((row, index) => ({ type: "tableRow", content: (row.children || []).map((cell, column) => ({ type: index === 0 ? "tableHeader" : "tableCell", attrs: { align: node.align?.[column] || null }, content: [{ type: "paragraph", content: inline(cell.children) }] })) })) };
    }
    default: throw new Error("Unsupported block " + node.type);
  }
}
/** Frontmatter is file metadata, not a Markdown heading or a rich block.
 * Keep it opaque: unknown keys and invalid YAML must remain editable without
 * interpreting, escaping or reserializing their contents.
 */
function leadingFrontmatterEnd(source: string): number {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(source);
  if (!opening) return 0;
  const lineBreak = /\r\n|\n|\r/g;
  let position = opening[0].length;
  while (position <= source.length) {
    lineBreak.lastIndex = position;
    const next = lineBreak.exec(source);
    const end = next?.index ?? source.length;
    if (/^(?:---|\.\.\.)[ \t]*$/.test(source.slice(position, end))) return end;
    if (!next) break;
    position = next.index + next[0].length;
  }
  // An unclosed header has no safe body boundary. Preserve all of it as source.
  return source.length;
}
export function parseNotesMarkdown(source: string): EditorNode {
  const frontmatterEnd = leadingFrontmatterEnd(source);
  const body = source.slice(frontmatterEnd);
  const protectedMath = protectMathTablePipes(body);
  const tree = parser.parse(protectedMath.source) as Ast;
  restoreMathTablePipes(tree, protectedMath.marker);
  const content: EditorNode[] = [];
  if (frontmatterEnd) {
    const originalSource = source.slice(0, frontmatterEnd);
    const frontmatter = raw(originalSource, "YAML frontmatter");
    frontmatter.attrs = { ...frontmatter.attrs, originalSource, originalGap: "" };
    frontmatter.attrs.sourceSignature = notesNodeSignature(frontmatter);
    content.push(frontmatter);
  }
  let previousEnd = frontmatterEnd;
  for (const ast of tree.children || []) {
    const start = frontmatterEnd + (ast.position?.start.offset ?? previousEnd - frontmatterEnd);
    const end = frontmatterEnd + (ast.position?.end.offset ?? start - frontmatterEnd);
    const originalSource = source.slice(start, end);
    const id = /^<!-- metis:block:([a-zA-Z0-9_-]+) -->$/.exec(originalSource);
    if (id && content.length) {
      const previous = content[content.length - 1];
      previous.attrs = { ...previous.attrs, blockId: id[1], originalSource: String(previous.attrs?.originalSource || "") + source.slice(previousEnd, end) };
      previous.attrs.sourceSignature = notesNodeSignature(previous);
      previousEnd = end;
      continue;
    }
    let parsed: EditorNode;
    try { parsed = block(ast, body); } catch { parsed = raw(originalSource); }
    parsed.attrs = { ...parsed.attrs, originalSource, originalGap: source.slice(previousEnd, start) };
    parsed.attrs.sourceSignature = notesNodeSignature(parsed);
    content.push(parsed);
    previousEnd = end;
  }
  const doc: EditorNode = { type: "doc", attrs: { originalTrailing: source.slice(previousEnd) }, content: content.length ? content : [{ type: "paragraph" }] };
  doc.attrs = { ...doc.attrs, originalSource: source, sourceSignature: notesNodeSignature(doc) };
  return doc;
}
type SerializedBlock = { signature: string; source: string; gap: string; emptyParagraph: boolean };
function serializeBlock(node: EditorNode): SerializedBlock {
  const signature = notesNodeSignature(node);
  return {
    signature,
    source: node.attrs?.sourceSignature === signature && typeof node.attrs.originalSource === "string"
      ? node.attrs.originalSource
      : serializeNotesBlock(node) + (node.attrs?.blockId ? "\n\n<!-- metis:block:" + node.attrs.blockId + " -->" : ""),
    gap: typeof node.attrs?.originalGap === "string" ? node.attrs.originalGap : "",
    emptyParagraph: node.type === "paragraph" && !node.content?.length && !node.attrs?.blockId,
  };
}
function serializeDocument(doc: EditorNode, blocks: SerializedBlock[]): string {
  const header = notesNodeSignature({ ...doc, content: undefined });
  const signature = blocks.length ? header.slice(0, -1) + ',"content":[' + blocks.map(block => block.signature).join(",") + "]}" : header;
  if (doc.attrs?.sourceSignature === signature && typeof doc.attrs.originalSource === "string") return doc.attrs.originalSource;
  if (blocks.length === 1 && blocks[0].emptyParagraph) return "";
  return blocks.map((block, index) => (index === 0 ? block.gap : block.gap || "\n\n") + block.source).join("")
    + (typeof doc.attrs?.originalTrailing === "string" ? doc.attrs.originalTrailing : "");
}
export function serializeNotesMarkdown(doc: EditorNode): string {
  return serializeDocument(doc, (doc.content || []).map(serializeBlock));
}

/** ProseMirror nodes are immutable: only changed top-level blocks need conversion.
 * The same snapshot is shared by limit checks and the synchronous change callback.
 * Weak keys let discarded edits/history be collected with their document nodes.
 */
export function createNotesMarkdownSerializer() {
  const blocks = new WeakMap<ProseMirrorNode, SerializedBlock>();
  const documents = new WeakMap<ProseMirrorNode, string>();
  return (doc: ProseMirrorNode): string => {
    const cached = documents.get(doc);
    if (cached !== undefined) return cached;
    const content: SerializedBlock[] = [];
    doc.forEach(node => {
      let block = blocks.get(node);
      if (!block) { block = serializeBlock(node.toJSON() as EditorNode); blocks.set(node, block); }
      content.push(block);
    });
    const result = serializeDocument({ type: doc.type.name, attrs: doc.attrs }, content);
    documents.set(doc, result);
    return result;
  };
}
