import { isNoteBlockColor } from "./notes-block-style";

/** Portable, JSON-only schema for rich Markdown block envelopes. */
export type EditorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};
export const NOTES_SOURCE_METADATA = new Set(["originalSource", "sourceSignature", "originalGap", "originalTrailing"]);
export const NOTES_RICH_CONTAINERS = new Set(["callout", "toggleBlock", "columns", "column", "pageReference", "embedBlock", "tableOfContents"]);
export const NOTES_SEMANTIC_ATTRIBUTES: Record<string, string[]> = {
  tableOfContents: ["version", "blockId"],
  heading: ["level", "blockId"], orderedList: ["start", "blockId"], taskItem: ["checked", "blockId"],
  codeBlock: ["language", "meta", "blockId"], image: ["src", "alt", "title", "blockId"],
  link: ["href", "title"], textStyle: ["color"], highlight: ["color"],
  sourceBlock: ["source", "label", "blockId"], inlineMath: ["latex"], mathBlock: ["latex", "blockId"],
  callout: ["tone", "blockId"], toggleBlock: ["title", "open", "blockId"],
  pageReference: ["noteId", "title", "blockId"], embedBlock: ["url", "title", "blockId"],
  tableCell: ["colspan", "rowspan", "colwidth", "align"], tableHeader: ["colspan", "rowspan", "colwidth", "align"],
};
const supportedNodes = new Set([...NOTES_RICH_CONTAINERS, "paragraph","heading","blockquote","bulletList","orderedList","listItem","taskList","taskItem","codeBlock","horizontalRule","image","mathBlock","sourceBlock","table","tableRow","tableCell","tableHeader","inlineMath","text","hardBreak"]);
const supportedMarks = new Set(["bold","italic","strike","code","underline","link","textStyle","highlight"]);
function validAttributes(attrs: Record<string, unknown>) {
  return Object.entries(attrs).every(([key, value]) => {
    if (value === null || value === undefined) return true;
    if (key === "blockColor") return isNoteBlockColor(value);
    if (key === "version") return value === 1;
    if (key === "colwidth") return Array.isArray(value) && value.every((width) => Number.isInteger(width) && Number(width) >= 0);
    if (["level","start","colspan","rowspan"].includes(key)) return typeof value === "number" && Number.isInteger(value) && (key === "level" ? value >= 1 && value <= 6 : key === "start" ? value >= 0 : value >= 1);
    if (key === "checked" || key === "open") return typeof value === "boolean";
    if (key === "align") return ["left","center","right"].includes(String(value));
    if (key === "blockId") return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
    return typeof value === "string";
  });
}
export function validNotesRichNode(value: unknown, depth = 0): value is EditorNode {
  if (!value || typeof value !== "object" || depth > 50 || Array.isArray(value)) return false;
  const node = value as EditorNode;
  if (typeof node.type !== "string" || !supportedNodes.has(node.type)) return false;
  if (Object.keys(node).some((key) => !["type","attrs","content","text","marks"].includes(key))) return false;
  if (node.type === "text" && typeof node.text !== "string") return false;
  if (node.type === "tableOfContents" && node.attrs?.version !== 1) return false;
  if (node.attrs && (typeof node.attrs !== "object" || Array.isArray(node.attrs))) return false;
  if (node.attrs && !validAttributes(node.attrs)) return false;
  if (node.attrs && Object.keys(node.attrs).some((key) => key !== "blockId" && key !== "blockColor" && !NOTES_SOURCE_METADATA.has(key) && !(NOTES_SEMANTIC_ATTRIBUTES[node.type] || []).includes(key))) return false;
  if (node.content && (!Array.isArray(node.content) || !node.content.every((child) => validNotesRichNode(child, depth + 1)))) return false;
  if (node.marks && (!Array.isArray(node.marks) || !node.marks.every((mark) => mark && typeof mark === "object" && supportedMarks.has(mark.type) && Object.keys(mark).every((key) => ["type","attrs"].includes(key)) && (!mark.attrs || (typeof mark.attrs === "object" && !Array.isArray(mark.attrs) && validAttributes(mark.attrs) && Object.keys(mark.attrs).every((key) => (NOTES_SEMANTIC_ATTRIBUTES[mark.type] || []).includes(key))))))) return false;
  return true;
}
/** Browser-generated link presentation attributes are not part of the stored schema. */
export function normalizeNotesLinkAttributes(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 50) return value;
  const node = value as EditorNode;
  return {
    ...node,
    ...(Array.isArray(node.marks) ? {marks: node.marks.map(mark => mark?.type === "link" && mark.attrs
      ? {...mark,attrs:Object.fromEntries(Object.entries(mark.attrs).filter(([key]) => !["target","rel","class"].includes(key)))}
      : mark)} : {}),
    ...(Array.isArray(node.content) ? {content: node.content.map(child => normalizeNotesLinkAttributes(child, depth + 1))} : {}),
  };
}
export function readNotesRichBlock(source: string): EditorNode | null {
  try {
    const value = normalizeNotesLinkAttributes(JSON.parse(source));
    return validNotesRichNode(value) && !["text","hardBreak","inlineMath","column"].includes(value.type) ? value : null;
  } catch { return null; }
}
