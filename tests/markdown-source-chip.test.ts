import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("link previews portal out of the text flow so hover cannot reflow a line", () => {
  const preview = source("components/link-preview.tsx");
  assert.match(preview, /createPortal/);
  assert.match(preview, /position:\s*["']fixed["']/);
  assert.match(preview, /inline-flex max-w-full align-middle/);
  assert.doesNotMatch(preview, /relative inline/);
  assert.doesNotMatch(preview, /absolute bottom-full/);
});

test("source chips keep a stable inline box and do not grow on hover", () => {
  const markdown = source("components/markdown.tsx");
  assert.match(markdown, /data-source-chip/);
  assert.match(markdown, /whitespace-nowrap/);
  assert.match(markdown, /align-middle/);
  assert.match(markdown, /leading-none/);
  assert.match(markdown, /!sourceTitle && isWebUrl && hovered && modifierHeld/);
  assert.doesNotMatch(markdown, /py-0\.5 text-\[11px\] font-medium no-underline hover:bg-secondary/);
});
