import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath, splitStreamingMath } from "../lib/math";

test("KaTeX renderer and stylesheet share a version and stretchy frame layout", () => {
  const appRequire = createRequire(import.meta.url);
  const rendererRequire = createRequire(appRequire.resolve("rehype-katex"));
  const appVersion = JSON.parse(readFileSync(appRequire.resolve("katex/package.json"), "utf8")).version;
  const rendererVersion = JSON.parse(readFileSync(rendererRequire.resolve("katex/package.json"), "utf8")).version;
  assert.equal(appVersion, rendererVersion, "KaTeX markup and CSS must use the same version");
  const html = render(normalizeMath(response));
  assert.doesNotMatch(html, /katex-error/);
  const frame = html.match(/class="([^"]*\bfbox\b[^"]*)"/)?.[1].split(/\s+/);
  assert.ok(frame, "the result has a frame");
  const stretchy = frame.find(name => /stretchy$/.test(name));
  assert.ok(stretchy, "the frame uses a stretchy layout");
  const css = readFileSync(appRequire.resolve("katex/dist/katex.css"), "utf8");
  const rule = css.match(new RegExp("\\.katex \\." + stretchy + " \\{([^}]+)\\}"))?.[1];
  assert.ok(rule, "the loaded stylesheet defines the renderer's stretchy class");
  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /display:\s*block/);
});

const response = readFileSync(new URL("./fixtures/math-list-response.md", import.meta.url), "utf8");
function render(source: string) {
  return renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: "ignore" }]],
  }, source));
}
function count(html: string, tag: string) { return html.split("<" + tag + ">").length - 1; }

test("the reported response keeps all numbered steps, solutions and its exercise table", () => {
  const html = render(normalizeMath(response));
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(count(html, "ol"), 1);
  assert.equal(count(html, "li"), 7);
  assert.equal(count(html, "table"), 1);
  assert.equal(count(html, "tr"), 5);
  assert.match(html, /<strong>Die 2 mit jedem Term in der Klammer multiplizieren:<\/strong>/);
  assert.match(html, /<strong>Zahlen zusammenfassen:<\/strong>/);
  assert.match(html, /<strong>Achtung:<\/strong>/);
});

const fence = String.fromCharCode(96).repeat(3);
const formats = [
  ["LaTeX display delimiters", "\\[", "\\]"],
  ["bare brackets with LaTeX", "[", "]"],
  ["math code fence", fence + "math", fence],
  ["bare aligned environment", "\\begin{aligned}", "\\end{aligned}"],
];
for (const [name, open, close] of formats) {
  test(name + " preserves nested list structure and following Markdown", () => {
    const source = ["1. First step", "   - Nested calculation", "     " + open, "     \\frac{x}{2} = 3", "     " + close, "", "2. Final step", "", "| Task | Value |", "|---|---|", "| A | 6 |"].join("\n");
    const html = render(normalizeMath(source));
    assert.doesNotMatch(html, /katex-error/);
    assert.match(html, /class="katex-display"/);
    assert.equal(count(html, "li"), 3);
    assert.equal(count(html, "table"), 1);
    assert.match(html, /<li>\s*(?:<p>)?Final step(?:<\/p>)?\s*<\/li>/);
  });
}

test("display formulas preserve quoted list prefixes", () => {
  const source = ["> 1. Calculate", ">    \\[", ">    x^2 = 4", ">    \\]", ">", "> 2. Explain", "", "**Outside the quote.**"].join("\n");
  const html = render(normalizeMath(source));
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(count(html, "blockquote"), 1);
  assert.equal(count(html, "li"), 2);
  assert.match(html, /<strong>Outside the quote\.<\/strong>/);
});

test("a display formula can start directly after a numbered list marker", () => {
  const html = render(normalizeMath("1. \\[x^2 = 4\\]\n\n2. Explain"));
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(count(html, "li"), 2);
  assert.match(html, /class="katex-display"/);
});

test("normalization is idempotent for complete responses and existing math fences", () => {
  for (const text of [response, "1. Calculate\n   $$\n   x^2 = 4\n   $$\n\n2. Explain"]) {
    const once = normalizeMath(text);
    assert.equal(normalizeMath(once), once);
  }
});

test("streaming keeps incomplete formulas pending and restores the full list on completion", () => {
  const start = response.indexOf("   \\[");
  const close = response.indexOf("\\]", start) + 2;
  for (let end = start + 5; end < close; end++) {
    const parts = splitStreamingMath(response.slice(0, end));
    assert.ok(parts.pending.length > 0);
    assert.equal(parts.ready + parts.pending, normalizeMath(response.slice(0, end)));
    assert.doesNotMatch(render(parts.ready), /katex-error/);
  }
  const complete = splitStreamingMath(response);
  assert.equal(complete.pending, "");
  assert.equal(complete.ready, normalizeMath(response));
  const html = render(complete.ready);
  assert.doesNotMatch(html, /katex-error/);
  assert.equal(count(html, "li"), 7);
  assert.equal(count(html, "table"), 1);
});
