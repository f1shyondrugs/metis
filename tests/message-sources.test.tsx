import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageSources } from "../components/message-sources";
import { WebsiteIcon } from "../components/website-icon";
import { extractMessageSources, sourceFaviconUrl } from "../lib/message-sources";

Object.assign(globalThis, { React });

test("all explicit research sources remain available beyond twelve entries", () => {
  const citations = Array.from({ length: 240 }, (_, index) => `[Source ${index + 1}](https://example.org/papers/${index + 1})`);
  const sources = extractMessageSources({ content: "Uncited https://outside.example/page\n\n```sources\n" + citations.join("\n") + "\n```" });
  assert.equal(sources.length, 240);
  assert.deepEqual(sources[239], { label: "Source 240", url: "https://example.org/papers/240" });
  assert.ok(sources.every(source => source.url.startsWith("https://example.org/papers/")));
});

test("source extraction keeps labels and deduplicates repeated URLs across source blocks", () => {
  const sources = extractMessageSources({ content: "```sources\n[Original paper](https://www.example.org/paper)\nhttps://www.example.org/paper\n```\n```sources\n[Repeated](https://www.example.org/paper)\nhttps://other.example/report.\n```" });
  assert.deepEqual(sources, [
    { label: "Original paper", url: "https://www.example.org/paper" },
    { label: "other.example", url: "https://other.example/report" },
  ]);
});

test("website favicon URLs use only the HTTP origin without document paths or credentials", () => {
  assert.equal(sourceFaviconUrl("https://user:secret@example.org/reports/current?q=1#part"), "https://example.org/favicon.ico");
  assert.equal(sourceFaviconUrl("http://example.org:8080/path"), "http://example.org:8080/favicon.ico");
  for (const href of ["javascript:alert(1)", "data:image/svg+xml,test", "/relative", "broken"]) {
    assert.equal(sourceFaviconUrl(href), undefined);
  }
});

test("collapsed sources do not mount hundreds of links or fetch favicon images", () => {
  const sources = Array.from({ length: 240 }, (_, index) => ({ label: "Paper " + index, url: "https://example.org/" + index }));
  const html = renderToStaticMarkup(<MessageSources sources={sources} />);
  assert.match(html, /Sources/);
  assert.match(html, /240/);
  assert.doesNotMatch(html, /<a\b|<img\b/);
});

test("website icons retain an accessible decorative fallback with lazy referrer-free images", () => {
  const fallback = renderToStaticMarkup(<WebsiteIcon />);
  assert.match(fallback, /aria-hidden="true"/);
  assert.match(fallback, /<svg\b/);
  assert.doesNotMatch(fallback, /<img\b/);
  const icon = renderToStaticMarkup(<WebsiteIcon src="https://example.org/favicon.ico" />);
  assert.match(icon, /src="https:\/\/example.org\/favicon.ico"/);
  assert.match(icon, /loading="lazy"/);
  assert.match(icon, /referrerPolicy="no-referrer"/);
  assert.match(icon, /alt=""/);
});
