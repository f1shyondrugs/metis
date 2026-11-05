import assert from "node:assert/strict";
import test, { before } from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicMarkdownAssetUrl, publicMarkdownImageUrl, publicMarkdownLinkTarget, type PublicMarkdownShare } from "../lib/public-markdown";
import { PublicMarkdownLink } from "../components/public-markdown-link";

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
let Markdown: typeof import("../components/markdown").Markdown;
let NotesRichBlockPreview: typeof import("../components/notes/rich-block-preview").NotesRichBlockPreview;
let ChartBoard: typeof import("../components/chart-board").ChartBoard;
let GraphBoard: typeof import("../components/graph-board").GraphBoard;
before(async () => {
  ({ Markdown } = await import("../components/markdown"));
  ({ NotesRichBlockPreview } = await import("../components/notes/rich-block-preview"));
  ({ ChartBoard } = await import("../components/chart-board"));
  ({ GraphBoard } = await import("../components/graph-board"));
});

const image = "/api/notes/root/attachments/11111111-1111-1111-1111-111111111111";
const document = "/api/file-uploads/22222222-2222-2222-2222-222222222222/file";
const projected = (source: string) => "/api/shared-notes/share-token/assets?url=" + encodeURIComponent(source);
const share: PublicMarkdownShare = { noteIds: ["root", "child"], assets: { [image]: projected(image), [document]: projected(document) } };

test("public asset resolution requires an exact projection and blocks private URL fallbacks", () => {
  assert.equal(publicMarkdownAssetUrl(image, share), projected(image));
  assert.equal(publicMarkdownImageUrl(projected(image), share), projected(image));
  for (const source of [
    image + "?download=1", "/api/uploads/chat/private.png", "/api/notes/sibling/attachments/private",
    projected("/api/notes/sibling/attachments/private"), "//example.org/a.png", "javascript:alert(1)",
    "https://metis.example/api/file-uploads/private/file", "https://metis.example/%61pi/private",
    "https://metis.example/%2561pi/private", "https://user:password@example.org/a.png",
  ]) assert.equal(publicMarkdownImageUrl(source, share), undefined, source);
  assert.equal(publicMarkdownImageUrl("https://example.org/a.png", share), undefined);
  assert.equal(publicMarkdownAssetUrl(image, { ...share, assets: { [image]: "/api/private" } }), undefined);
});

test("public note links use the subtree and invoke only the viewer callback", () => {
  for (const href of ["note://sibling", "issue://private", "workspace://canvas/private", "/root/secret.txt"]) {
    assert.equal(publicMarkdownLinkTarget(href, share), undefined);
  }
  const calls: unknown[][] = [];
  const anchor = PublicMarkdownLink({ href: "metis://note/child#block-intro", share: { ...share, onOpenNote: (...args) => calls.push(args) }, children: "Child" });
  assert.equal(anchor.type, "a");
  assert.equal(anchor.props.href, "#note-child/block-intro");
  let prevented = false, stopped = false;
  anchor.props.onClick({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.deepEqual(calls, [["child", "intro"]]);
  assert.equal(prevented && stopped, true);
  assert.equal(PublicMarkdownLink({ href: "note://sibling", share, children: "Sibling" }).type, "span");
  const external = renderToStaticMarkup(<PublicMarkdownLink href="https://example.org/report" share={share}>Report</PublicMarkdownLink>);
  assert.match(external, /target="_blank"/);
  assert.match(external, /rel="noopener noreferrer"/);
  assert.match(external, /referrerPolicy="no-referrer"/);
});

test("shared Markdown renders scoped media and leaves private references inert", () => {
  const content = [
    "# Shared document", "[Child](note://child)", "[Sibling](note://sibling)",
    "[Workspace](/root/private.txt)", "[Public site](https://example.org/report)",
    "![Included](" + image + ")", "![Private](/api/file-uploads/private/file)",
    "![Absolute private](https://metis.example/api/notes/private/attachments/image)",
    "![External](https://example.org/image.png)", "- [ ] Read-only task",
    "```file\n" + JSON.stringify({ url: document, name: "Notes.txt", mimeType: "text/plain" }) + "\n```",
    "```file\n" + JSON.stringify({ url: "/api/notes/sibling/attachments/private", name: "Private.txt", mimeType: "text/plain" }) + "\n```",
    "<script>alert(1)</script>",
  ].join("\n\n");
  const html = renderToStaticMarkup(<Markdown content={content} publicShare={share} editableFiles interactiveTasks />);
  assert.match(html, /<h1>Shared document<\/h1>/);
  assert.match(html, /href="#note-child"/);
  assert.doesNotMatch(html, /href="(?:note:|#note-sibling|\/root\/private)/);
  assert.match(html, /<span>Sibling<\/span>/);
  assert.match(html, /src="\/api\/shared-notes\/share-token\/assets\?url=/);
  assert.doesNotMatch(html, /src="(?:\/api\/file-uploads|https:\/\/metis.example)/);
  assert.doesNotMatch(html, /src="https:\/\/example.org\/image.png"/);
  assert.match(html, /<span>External<\/span>/);
  assert.match(html, /data-file-embed="text"/);
  assert.match(html, /Private.txt \(file unavailable\)/);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.doesNotMatch(html, /aria-label="(?:Edit Notes.txt|Remove Notes.txt|Resize embedded file)"/);
  assert.doesNotMatch(html, /<script>/);
});

test("rich containers apply the same share boundary to images, marks, pages and embeds", () => {
  const source = JSON.stringify({ type: "callout", content: [
    { type: "image", attrs: { src: image, alt: "Included rich image" } },
    { type: "image", attrs: { src: "/api/notes/sibling/attachments/private", alt: "Private rich image" } },
    { type: "pageReference", attrs: { noteId: "child", title: "Child page" } },
    { type: "pageReference", attrs: { noteId: "sibling", title: "Private sibling" } },
    { type: "embedBlock", attrs: { url: "/api/private", title: "Private embed" } },
    { type: "paragraph", content: [
      { type: "text", text: "External rich link", marks: [{ type: "link", attrs: { href: "https://example.org/report" } }] },
      { type: "text", text: "Private issue", marks: [{ type: "link", attrs: { href: "issue://private" } }] },
    ] },
  ] });
  const html = renderToStaticMarkup(<NotesRichBlockPreview source={source} publicShare={share} />);
  assert.match(html, /<aside/);
  assert.match(html, /src="\/api\/shared-notes\/share-token\/assets\?url=/);
  assert.match(html, /href="#note-child"/);
  assert.match(html, /<span>↗ Private sibling<\/span>/);
  assert.match(html, /<span>Private embed<\/span>/);
  assert.doesNotMatch(html, /(?:href|src)="(?:\/api\/private|\/api\/notes\/sibling|#note-sibling|issue:)/);
  assert.match(html, /href="https:\/\/example.org\/report"[^>]*rel="noopener noreferrer"/);
});

test("thinking-separated public Markdown retains scoped rendering", () => {
  const html = renderToStaticMarkup(<Markdown publicShare={share} content={"<thinking>Thought</thinking>\n[Sibling](note://sibling)\n\n![](/api/private)"} />);
  assert.doesNotMatch(html, /href="#note-sibling"|src="\/api\/private"/);
  assert.match(html, /<span>Sibling<\/span>/);
});

test("public chart and graph boards retain viewers while hiding source editing", () => {
  const chart = '{"type":"line","labels":["A","B"],"series":[{"name":"Values","values":[1,2]}]}';
  const graph = '{"elements":[{"type":"function","fn":"x*x"}]}';
  for (const [Board, code, kind] of [[ChartBoard, chart, "chart"], [GraphBoard, graph, "graph"]] as const) {
    const shared = renderToStaticMarkup(<Board code={code} readOnly />);
    assert.match(shared, new RegExp("data-" + kind + "-source="));
    assert.match(shared, new RegExp('aria-label="Open ' + kind + ' fullscreen"'));
    assert.doesNotMatch(shared, />Edit<\/button>|>Code<\/button>|<textarea/);
    const editable = renderToStaticMarkup(<Board code={code} />);
    assert.match(editable, />Edit<\/button>/);
    assert.match(editable, />Code<\/button>/);
  }
  const html = renderToStaticMarkup(<Markdown publicShare={share} content={"```chart\n" + chart + "\n```\n\n```graph\n" + graph + "\n```"} />);
  assert.match(html, /data-chart-source=/);
  assert.match(html, /data-graph-source=/);
  assert.doesNotMatch(html, />Edit<\/button>|>Code<\/button>/);
});
