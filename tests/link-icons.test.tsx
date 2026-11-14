import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Schema } from "@tiptap/pm/model";
import { LinkIcon } from "../components/link-icon";
import { linkIconDecorations } from "../lib/notes-link-icons";
import { WebsiteIcon } from "../components/website-icon";
Object.assign(globalThis, { React });

test("link icons cover internal references, web, files and custom note glyphs", () => {
  for (const [href, kind] of [["workspace://plan/a", "plan"], ["workspace://canvas/a", "canvas"],
    ["note://a", "note"], ["issue://a", "issue"], ["https://example.com", "browser"],
    ["metis://reference/chat/a", "chat"], ["workspace://file/%2Ftmp%2Fa.txt", "file"]]) {
    const html = renderToStaticMarkup(<LinkIcon href={href}/>);
    assert.ok(html.includes('data-link-icon-kind="' + kind + '"'), href);
    assert.match(html, /aria-hidden="true"/);
  }
  const html = renderToStaticMarkup(<LinkIcon href="note://a" icon="lucide:rocket:#ef4444"/>);
  assert.match(html, /lucide-rocket/);
  assert.match(html, /#ef4444/);
  assert.match(renderToStaticMarkup(<LinkIcon href="note://a" icon="🦁"/>), /🦁/);
});

test("website links request only the origin favicon and retain their original fallback", () => {
  const html = renderToStaticMarkup(<LinkIcon href="https://example.com/docs?q=private#section" />);
  assert.match(html, /src="https:\/\/example.com\/favicon.ico"/);
  assert.doesNotMatch(html, /private|section/);
  assert.match(html, /lucide-globe/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /loading="lazy"/);
  const custom = renderToStaticMarkup(<WebsiteIcon src="https://example.com/favicon.ico" fallback={<span>original</span>} />);
  assert.match(custom, /original/);
  assert.doesNotMatch(custom, /lucide-globe/);
  for (const href of ["note://a", "workspace://plan/a", "mailto:help@example.com", "metis://reference/browser/a", "javascript:alert(1)", "#heading"]) {
    assert.doesNotMatch(renderToStaticMarkup(<LinkIcon href={href} />), /<img\b/);
  }
});

test("editor icons group formatting runs without entering document content", () => {
  const schema = new Schema({
    nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", group: "block" }, text: { group: "inline" } },
    marks: { link: { attrs: { href: {} } }, bold: {} },
  });
  const link = schema.marks.link.create({ href: "note://a" });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("First", [link]), schema.text(" bold", [link, schema.marks.bold.create()]),
      schema.text(" gap "), schema.text("Again", [link])]),
    schema.node("paragraph", null, [schema.text("Next", [link])]),
  ]);
  const before = JSON.stringify(doc.toJSON());
  assert.equal(linkIconDecorations(doc).find().length, 3);
  assert.equal(JSON.stringify(doc.toJSON()), before);
});
