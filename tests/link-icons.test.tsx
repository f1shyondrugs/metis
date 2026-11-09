import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Schema } from "@tiptap/pm/model";
import { LinkIcon } from "../components/link-icon";
import { linkIconDecorations } from "../lib/notes-link-icons";
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
