import { readNotesRichBlock, type EditorNode } from "@/lib/notes-editor-format";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);

export function boundedPreviewText(value: string, limit: number) {
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

/** Parse GFM so code examples do not count as completed tasks. */
export function documentPreviewSummary(content: string) {
  type Node = { type: string; lang?: string | null; value?: string; alt?: string | null; checked?: boolean | null; children?: Node[] };
  const nodes: Node[] = [parser.parse(content.slice(0, 100_000)) as Node];
  const text: string[] = [];
  let tasks = 0, completed = 0, steps = 0;
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.type === "listItem") {
      steps += 1;
      if (typeof node.checked === "boolean") {
        tasks += 1;
        if (node.checked) completed += 1;
      }
    }
    if (node.type === "code") {
      if (node.lang === "metis-block") {
        const rich = readNotesRichBlock(node.value || "");
        const collect = (item: EditorNode) => {
          if (item.type === "codeBlock" || item.type === "sourceBlock") return;
          if (item.text) text.push(item.text);
          if (item.type === "toggleBlock" && typeof item.attrs?.title === "string") text.push(item.attrs.title);
          if (item.type === "taskItem") { tasks++; steps++; if (item.attrs?.checked) completed++; }
          for (const child of item.content || []) collect(child);
        };
        if (rich) collect(rich);
      }
      continue;
    }
    if (["text", "inlineCode"].includes(node.type) && node.value) text.push(node.value);
    if (node.type === "image" && node.alt) text.push(node.alt);
    if (node.children) for (let index = node.children.length - 1; index >= 0; index -= 1) nodes.push(node.children[index]);
  }
  return { description: boundedPreviewText(text.join(" "), 600), tasks, completed, steps };
}

