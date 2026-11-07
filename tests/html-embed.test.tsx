import assert from "node:assert/strict";
import test, { before } from "node:test";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HtmlEmbed } from "../components/html-embed";
import {
  HTML_EMBED_MAX_LENGTH, HTML_EMBED_PROMPT, htmlEmbedDocument, htmlEmbedHeight, isHtmlEmbedLanguage,
} from "../lib/html-embed";
import { METIS_SHARED_AGENT_CONTROL } from "../lib/agent-control";
import { htmlPreviewDocument } from "../lib/file-editor-preview";

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
let Markdown: typeof import("../components/markdown").Markdown;
before(async () => { ({ Markdown } = await import("../components/markdown")); });

test("HTML previews are explicitly opted in, while HTML code examples stay code", () => {
  assert.equal(isHtmlEmbedLanguage("html-preview"), true);
  assert.equal(isHtmlEmbedLanguage("HTML-PREVIEW"), true);
  for (const value of ["html", "xml", "javascript", undefined]) assert.equal(Boolean(isHtmlEmbedLanguage(value)), false);
  const example = HTML_EMBED_PROMPT.match(/^\x60\x60\x60html-preview\n([\s\S]*?)\n\x60\x60\x60/m)?.[1];
  assert.ok(example);
  assert.match(example, /<button/);
  assert.ok(METIS_SHARED_AGENT_CONTROL.includes(HTML_EMBED_PROMPT));
  const html = renderToStaticMarkup(<HtmlEmbed source={example} />);
  assert.match(html, /<iframe/);
});

test("the real Markdown renderer embeds only the explicit fence and waits for streaming to finish", () => {
  const source = '<button id="demo">Personal widget</button>';
  const content = "Before\n\n" + "\x60\x60\x60html-preview\n" + source + "\n\x60\x60\x60\n\nAfter\n\n\x60\x60\x60html\n<h1>Code example</h1>\n\x60\x60\x60";
  const complete = renderToStaticMarkup(<Markdown content={content} />);
  assert.equal((complete.match(/<iframe/g) || []).length, 1);
  assert.match(complete, /Before/);
  assert.match(complete, /After/);
  assert.match(complete, /Code example/);
  assert.doesNotMatch(complete, /<button id="demo"|<h1>Code example/);
  const streaming = renderToStaticMarkup(<Markdown content={content} streaming />);
  assert.doesNotMatch(streaming, /<iframe/);
  assert.match(streaming, /Preparing interactive content/);
  const shared = renderToStaticMarkup(<Markdown content={content} publicShare={{ noteIds: [], assets: {} }} />);
  assert.match(shared, /sandbox="allow-scripts"/);
  assert.doesNotMatch(shared, /allow-same-origin/);
});

test("rendered HTML stays inside an opaque offline frame, never the parent DOM", () => {
  const source = '<section>Personal content</section><script>window.widgetRan=true</script>';
  const html = renderToStaticMarkup(<HtmlEmbed source={source} />);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(html, /allow-same-origin|allow-top-navigation|allow-forms|allow-popups/);
  assert.doesNotMatch(html, /<script>|<section>/);
  assert.match(html, /&lt;section&gt;/);
  const document = htmlEmbedDocument(source, "frame");
  assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf(source));
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /form-action 'none'/);
  assert.match(document, /img-src data: blob:;/);
  assert.doesNotMatch(document, /https:/);
  assert.ok(document.includes(source));
  // Existing file previews keep their existing remote-media behavior.
  assert.match(htmlPreviewDocument(source), /img-src data: blob: https:/);
});

test("unfinished, empty and oversized content does not execute", () => {
  const source = "<button onclick='alert(1)'>Press</button>";
  const streaming = renderToStaticMarkup(<HtmlEmbed source={source} streaming />);
  assert.match(streaming, /role="status"/);
  assert.doesNotMatch(streaming, /<iframe|onclick|View HTML/);
  assert.match(renderToStaticMarkup(<HtmlEmbed source="  " />), /No HTML to preview/);
  const large = renderToStaticMarkup(<HtmlEmbed source={"x".repeat(HTML_EMBED_MAX_LENGTH + 1)} />);
  assert.match(large, /role="alert"/);
  assert.doesNotMatch(large, /<iframe/);
});

test("size messages are finite and bounded; theme and frame identifiers cannot break document boundaries", () => {
  assert.equal(htmlEmbedHeight(12), 96);
  assert.equal(htmlEmbedHeight(240.1), 241);
  assert.equal(htmlEmbedHeight(1e12), 1200);
  for (const value of [undefined, null, "500", NaN, Infinity, -Infinity, {}]) assert.equal(htmlEmbedHeight(value), undefined);
  const document = htmlEmbedDocument("<p>Safe</p>", '</script><img src=x>', { foreground: '</style><script>bad()</script>', background: "rgb(10 20 30)" });
  assert.match(document, /--background:rgb\(10 20 30\)/);
  assert.doesNotMatch(document, /--foreground:/);
  assert.ok(!document.includes('</script><img src=x>'));
});
