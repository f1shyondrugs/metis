import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { type EditorNode, NOTES_RICH_CONTAINERS, NOTES_SOURCE_METADATA, NOTES_SEMANTIC_ATTRIBUTES } from "./notes-editor-format";

type MarkdownNode = {
  type: string; value?: string; children?: MarkdownNode[]; depth?: number; url?: string;
  title?: string | null; alt?: string; lang?: string | null; meta?: string | null;
  ordered?: boolean; start?: number; checked?: boolean; spread?: boolean; align?: (string | null)[];
};
const stringifier = unified().use(remarkGfm).use(remarkMath).use(remarkStringify, { bullet: "-", emphasis: "_", strong: "*", rule: "-", fences: true, listItemIndent: "one", resourceLink: true });
const markOrder = ["link", "bold", "italic", "strike", "code"];
function needsEnvelope(node: EditorNode): boolean {
  return Boolean(node.attrs?.blockColor || (node.type === "paragraph" && !node.content?.length) || (node.type === "heading" && node.content?.some((child) => child.type === "hardBreak")) || (node.type === "taskItem" && node.attrs?.blockId) || node.marks?.some((mark) => ["underline", "textStyle", "highlight"].includes(mark.type)) || node.content?.some(needsEnvelope));
}
function stripMetadata(node: EditorNode): EditorNode {
  return { ...node, ...(node.attrs ? { attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key, value]) => !NOTES_SOURCE_METADATA.has(key) && value !== null && value !== undefined)) } : {}), ...(node.marks ? { marks: node.marks.map(mark => ({ ...mark, ...(mark.attrs ? {attrs:Object.fromEntries(Object.entries(mark.attrs).filter(([key,value]) => value != null && (NOTES_SEMANTIC_ATTRIBUTES[mark.type] || []).includes(key)))} : {}) })) } : {}), ...(node.content ? { content: node.content.map(stripMetadata) } : {}) };
}
function envelope(node: EditorNode): MarkdownNode { return { type: "code", lang: "metis-block", value: JSON.stringify(stripMetadata(node)) }; }
function inline(nodes: EditorNode[] = []): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  const append = (target: MarkdownNode[], marks: NonNullable<EditorNode["marks"]>, leaf: MarkdownNode) => {
    if (!marks.length) {
      const last = target.at(-1);
      if (last?.type === "text" && leaf.type === "text") last.value = String(last.value || "") + String(leaf.value || "");
      else target.push(leaf);
      return;
    }
    const [mark, ...remaining] = marks;
    if (mark.type === "code") { target.push({ type: "inlineCode", value: leaf.value || "" }); return; }
    const type = ({ link: "link", bold: "strong", italic: "emphasis", strike: "delete" } as Record<string,string>)[mark.type];
    if (!type) { append(target, remaining, leaf); return; }
    const attrs = mark.type === "link" ? { url: String(mark.attrs?.href || ""), title: mark.attrs?.title ? String(mark.attrs.title) : null } : {};
    let wrapper = target.at(-1);
    if (!wrapper || wrapper.type !== type || (type === "link" && (wrapper.url !== attrs.url || wrapper.title !== attrs.title))) {
      wrapper = { type, ...attrs, children: [] }; target.push(wrapper);
    }
    append(wrapper.children!, remaining, leaf);
  };
  for (const node of nodes) {
    let leaf: MarkdownNode;
    if (node.type === "hardBreak") leaf = { type: "break" };
    else if (node.type === "inlineMath") leaf = { type: "inlineMath", value: String(node.attrs?.latex || "") };
    else if (node.type === "image") leaf = { type: "image", url: String(node.attrs?.src || ""), alt: String(node.attrs?.alt || ""), title: node.attrs?.title ? String(node.attrs.title) : null };
    else leaf = { type: "text", value: node.text || "" };
    append(result, [...(node.marks || [])].sort((a,b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type)), leaf);
  }
  return result;
}
function toMarkdownNode(node: EditorNode): MarkdownNode {
  const attrs = node.attrs || {}, children = () => (node.content || []).map(toMarkdownNode);
  if (NOTES_RICH_CONTAINERS.has(node.type) || needsEnvelope(node)) return envelope(node);
  switch (node.type) {
    case "paragraph": return { type: "paragraph", children: inline(node.content) };
    case "heading": return { type: "heading", depth: Number(attrs.level) || 1, children: inline(node.content) };
    case "blockquote": return { type: "blockquote", children: children() };
    case "bulletList":
    case "orderedList":
    case "taskList": return { type: "list", ordered: node.type === "orderedList", start: Number(attrs.start || 1), spread: false, children: (node.content || []).map((item) => ({ type: "listItem", ...(node.type === "taskList" ? { checked: Boolean(item.attrs?.checked) } : {}), spread: (item.content?.length || 0) > 1, children: (item.content || []).map(toMarkdownNode) })) };
    case "codeBlock": return { type: "code", lang: attrs.language ? String(attrs.language) : null, meta: attrs.meta ? String(attrs.meta) : null, value: (node.content || []).map((child) => child.text || "").join("") };
    case "horizontalRule": return { type: "thematicBreak" };
    case "image": return { type: "paragraph", children: inline([node]) };
    case "mathBlock": return { type: "math", value: String(attrs.latex || "") };
    case "sourceBlock": return { type: "html", value: String(attrs.source || "") };
    case "table":
      if (node.content?.some((row, rowIndex) => row.content?.some((cell, columnIndex) => Number(cell.attrs?.colspan || 1) > 1 || Number(cell.attrs?.rowspan || 1) > 1 || cell.attrs?.colwidth || (cell.content?.length || 0) > 1 || cell.content?.[0]?.type !== "paragraph" || cell.type !== (rowIndex === 0 ? "tableHeader" : "tableCell") || (cell.attrs?.align || null) !== (node.content?.[0]?.content?.[columnIndex]?.attrs?.align || null)))) return envelope(node);
      return { type: "table", align: (node.content?.[0]?.content || []).map((cell) => cell.attrs?.align ? String(cell.attrs.align) : null), children: (node.content || []).map((row) => ({ type: "tableRow", children: (row.content || []).map((cell) => ({ type: "tableCell", children: inline(cell.content?.[0]?.content) })) })) };
    default: return envelope(node);
  }
}
export function serializeNotesBlock(node: EditorNode): string {
  // remark owns escaping, delimiter nesting, list indentation and GFM table syntax.
  return stringifier.stringify({ type: "root", children: [toMarkdownNode(node)] } as Parameters<typeof stringifier.stringify>[0]).replace(/\n$/, "");
}
