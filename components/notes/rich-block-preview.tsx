"use client";

import { Fragment, type ReactNode } from "react";
import katex from "katex";
import { type EditorNode, readNotesRichBlock } from "@/lib/notes-editor-format";
import { type NotesHeading } from "@/lib/notes-editor-headings";
import { internalLinkNavigation, parseInternalLink } from "@/lib/internal-link";
import { PublicMarkdownLink } from "@/components/public-markdown-link";
import { publicMarkdownImageUrl, type PublicMarkdownShare } from "@/lib/public-markdown";

const stringAttr = (node: EditorNode, name: string) => typeof node.attrs?.[name] === "string" ? node.attrs[name] as string : "";
const safeHref = (value: string) => /^(https?:\/\/|mailto:|\/(?!\/)|#|note:\/\/|issue:\/\/|metis:\/\/note\/)/i.test(value) ? value : undefined;
function RichLink({ href, children, publicShare }: { href: string; children: ReactNode; publicShare?: PublicMarkdownShare }) {
  if (publicShare) return <PublicMarkdownLink href={href} share={publicShare}>{children}</PublicMarkdownLink>;
  const safe = safeHref(href);
  if (!safe) return <span>{children}</span>;
  const target = parseInternalLink(safe), navigation = target ? internalLinkNavigation(target) : null;
  return <a href={navigation?.href || safe} onClick={(event) => {
    if (navigation) { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent(navigation.event, { detail: navigation.detail })); }
    else if (/^https?:\/\//i.test(safe) && !event.ctrlKey && !event.metaKey) { event.preventDefault(); window.dispatchEvent(new CustomEvent("ai-chat:open-browser", { detail: safe })); }
  }}>{children}</a>;
}
function safeColor(value: unknown) { return typeof value === "string" && /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.,% /-]+\)|[a-z]{3,20})$/i.test(value) ? value : undefined; }
function RichNode({ node, depth = 0, headings = [], sourceOffset = 0, path = [], publicShare }: { node: EditorNode; depth?: number; headings?: NotesHeading[]; sourceOffset?:number; path?:number[]; publicShare?: PublicMarkdownShare }) {
  if (depth > 50) return <span>Nested content limit reached.</span>;
  const children = (node.content || []).map((child, index) => <RichNode key={index} node={child} depth={depth + 1} headings={headings} sourceOffset={sourceOffset} path={[...path,index]} publicShare={publicShare}/>);
  const attrs = node.attrs || {}, blockId = stringAttr(node, "blockId");
  const headingId = node.type === "heading" ? headings.find((heading) => heading.sourceOffset === sourceOffset && heading.path === path.join("."))?.id : undefined;
  const common = blockId ? { id: "block-" + blockId } : headingId ? { id: headingId } : {};
  if (node.type === "text") {
    let value: ReactNode = node.text || "";
    for (const mark of node.marks || []) {
      if (mark.type === "bold") value = <strong>{value}</strong>;
      else if (mark.type === "italic") value = <em>{value}</em>;
      else if (mark.type === "strike") value = <s>{value}</s>;
      else if (mark.type === "underline") value = <u>{value}</u>;
      else if (mark.type === "code") value = <code>{value}</code>;
      else if (mark.type === "link") value = <RichLink href={String(mark.attrs?.href || "")} publicShare={publicShare}>{value}</RichLink>;
      else if (mark.type === "textStyle") value = <span style={{color:safeColor(mark.attrs?.color)}}>{value}</span>;
      else if (mark.type === "highlight") value = <mark style={{backgroundColor:safeColor(mark.attrs?.color),color:"inherit"}}>{value}</mark>;
    }
    return <>{value}</>;
  }
  switch (node.type) {
    case "paragraph": return <p {...common}>{children.length ? children : <br/>}</p>;
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(attrs.level) || 1));
      if (level === 1) return <h1 {...common}>{children}</h1>;
      if (level === 2) return <h2 {...common}>{children}</h2>;
      if (level === 3) return <h3 {...common}>{children}</h3>;
      if (level === 4) return <h4 {...common}>{children}</h4>;
      if (level === 5) return <h5 {...common}>{children}</h5>;
      return <h6 {...common}>{children}</h6>;
    }
    case "blockquote": return <blockquote {...common}>{children}</blockquote>;
    case "bulletList": return <ul {...common}>{children}</ul>;
    case "orderedList": return <ol {...common} start={Number(attrs.start) || 1}>{children}</ol>;
    case "listItem": return <li>{children}</li>;
    case "taskList": return <ul {...common} className="!list-none !pl-0">{children}</ul>;
    case "taskItem": return <li className="flex items-start gap-2"><input type="checkbox" checked={Boolean(attrs.checked)} readOnly disabled className="mt-1.5"/><div>{children}</div></li>;
    case "horizontalRule": return <hr {...common}/>;
    case "hardBreak": return <br/>;
    case "codeBlock": return <pre {...common}><code>{(node.content || []).map((child) => child.text || "").join("")}</code></pre>;
    case "image": {
      const original = stringAttr(node,"src");
      const src = publicShare ? publicMarkdownImageUrl(original, publicShare) || "" : original;
      return /^(https?:\/\/|\/(?!\/))/i.test(src) ? <img src={src} alt={stringAttr(node,"alt")} title={stringAttr(node,"title") || undefined} className="max-w-full h-auto" referrerPolicy={publicShare ? "no-referrer" : undefined}/> : <span>{stringAttr(node,"alt") || "Image address unavailable"}</span>;
    }
    case "inlineMath":
    case "mathBlock": {
      const rendered = katex.renderToString(stringAttr(node,"latex"), { throwOnError:false, trust:false, displayMode:node.type === "mathBlock" });
      return node.type === "mathBlock" ? <div {...common} className="my-3 overflow-x-auto" dangerouslySetInnerHTML={{__html:rendered}}/> : <span dangerouslySetInnerHTML={{__html:rendered}}/>;
    }
    case "tableOfContents": return <nav {...common} aria-label="Table of contents" className="my-3 border-y border-border py-3 text-sm"><strong className="mb-2 block text-xs text-muted-foreground">Table of contents</strong>{headings.length ? headings.map((heading) => <a key={heading.id} href={"#" + heading.id} className="block py-1 text-muted-foreground hover:text-foreground" style={{paddingLeft:(heading.level - 1) * 14}} onClick={(event) => {event.preventDefault(); const container = event.currentTarget.closest(".markdown-body"); const target = container?.querySelector("#" + CSS.escape(heading.id)) || document.getElementById(heading.id); target?.scrollIntoView({block:"start",behavior:"smooth"});}}>{heading.title || "Untitled heading"}</a>) : <p className="text-xs text-muted-foreground">Add headings to build a table of contents.</p>}</nav>;
    case "callout": return <aside {...common} className="my-3 rounded border-l-2 border-foreground/30 bg-secondary/70 px-4 py-2">{children}</aside>;
    case "toggleBlock": return <details {...common} open={attrs.open !== false} className="my-2"><summary className="cursor-pointer font-medium">{stringAttr(node,"title") || "Details"}</summary><div className="pl-5">{children}</div></details>;
    case "columns": return <div {...common} className="my-3 flex flex-col gap-5 sm:flex-row">{children}</div>;
    case "column": return <div className="min-w-0 flex-1">{children}</div>;
    case "pageReference": return <p {...common} className="my-2"><RichLink href={"note://" + encodeURIComponent(stringAttr(node,"noteId"))} publicShare={publicShare}>↗ {stringAttr(node,"title") || "Page"}</RichLink></p>;
    case "embedBlock": return <div {...common} className="my-3 rounded border border-border px-3 py-2"><RichLink href={stringAttr(node,"url")} publicShare={publicShare}>{stringAttr(node,"title") || stringAttr(node,"url")}</RichLink></div>;
    case "table": return <div {...common} className="overflow-x-auto"><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader":
    case "tableCell": {
      const shared = {colSpan:Math.max(1,Number(attrs.colspan) || 1),rowSpan:Math.max(1,Number(attrs.rowspan) || 1),style:{textAlign:["left","center","right"].includes(String(attrs.align)) ? attrs.align as "left"|"center"|"right" : undefined}};
      return node.type === "tableHeader" ? <th {...shared}>{children}</th> : <td {...shared}>{children}</td>;
    }
    case "sourceBlock": return <details {...common} className="my-2"><summary className="cursor-pointer text-xs text-muted-foreground">{stringAttr(node,"label") || "Markdown source"}</summary><pre><code>{stringAttr(node,"source")}</code></pre></details>;
    default: return <Fragment>{children}</Fragment>;
  }
}
export function NotesRichBlockPreview({ source, headings = [], sourceOffset = 0, publicShare }: { source: string; headings?:NotesHeading[]; sourceOffset?:number; publicShare?: PublicMarkdownShare }) {
  const node = readNotesRichBlock(source);
  if (!node) return <div className="my-2"><p className="text-xs text-destructive">This rich block could not be read. Its source is preserved.</p><pre><code>{source}</code></pre></div>;
  return <div className="notes-rich-block-preview" data-notes-rich-preview=""><RichNode node={node} headings={headings} sourceOffset={sourceOffset} publicShare={publicShare}/></div>;
}
