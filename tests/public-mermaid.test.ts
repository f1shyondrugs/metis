import assert from "node:assert/strict";
import test from "node:test";
import { publicMermaidCss, publicMermaidSource } from "../lib/public-mermaid";

test("public Mermaid keeps ordinary boxes, labels, arrows and shape notation", () => {
  const source = 'flowchart LR\nA[Planning] --> B{Ready?}\nB -->|Yes| C[(Database)]\nB -->|No| A';
  assert.equal(publicMermaidSource(source), source);
});

test("public Mermaid removes YAML image metadata before Mermaid measures image nodes", () => {
  const source = 'flowchart LR\nA@{ shape: image, "\\u0069mg": "/api/notes/private/image", label: "Keep } label" } --> B[Done]';
  const safe = publicMermaidSource(source);
  assert.equal(safe, 'flowchart LR\nA --> B[Done]');
  assert.doesNotMatch(safe, /private|img|image/);
});

test("public Mermaid drops diagram configuration, resource CSS, HTML and link directives", () => {
  const source = [
    "---", "config:", "  themeCSS: '@import url(/api/private)'", "---",
    '%%{init: {"themeCSS":"@import url(https://private.example/font)"}}%%',
    "flowchart LR",
    'A[One] --> B["&lt;img src=&quot;/api/private&quot;&gt;Two"]',
    'style A fill:url("/api/private")',
    "classDef danger fill:red",
    'click B "/api/private"',
    'C[Three]; linkStyle default stroke:url("/api/private")',
  ].join("\n");
  const safe = publicMermaidSource(source);
  assert.match(safe, /flowchart LR/);
  assert.match(safe, /A\[One\] --> B\["Two"\]/);
  assert.match(safe, /C\[Three\]/);
  assert.doesNotMatch(safe, /private|src|themeCSS|classDef|click|url\(/);
});

test("public SVG styles keep local markers and remove external resource fetches", () => {
  assert.equal(publicMermaidCss("fill:url(#marker);stroke:red"), "fill:url(#marker);stroke:red");
  assert.equal(publicMermaidCss('fill:url("/api/private");filter:url(https://example.org/image)'), "fill:none;filter:none");
  assert.equal(publicMermaidCss("@import '/api/private';text{fill:red}"), "");
  assert.equal(publicMermaidCss("fill:u\\72l(/api/private)"), "");
  assert.equal(publicMermaidCss("background:image-set('/api/private' 1x)"), "");
});
