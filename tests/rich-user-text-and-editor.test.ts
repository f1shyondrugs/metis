import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userText = readFileSync(new URL("../components/rich-user-text.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../components/markdown.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/editable-markdown.tsx", import.meta.url), "utf8");
const sourceEditor = readFileSync(new URL("../components/notes/markdown-source-editor.tsx", import.meta.url), "utf8");
const blockEditor = readFileSync(new URL("../components/notes/block-editor.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const subagentView = readFileSync(new URL("../components/subagent-chat-view.tsx", import.meta.url), "utf8");

test("user messages render markdown links instead of visible brackets", () => {
  assert.match(userText, /parseRichUserText/);
  assert.match(userText, /parseInternalLink/);
  assert.match(userText, /internalLinkNavigation/);
  assert.match(userText, /<LinkPreview/);
  assert.match(userText, /part\.label/);
});

test("markdown renders chart fences with ChartBoard before graph fences", () => {
  assert.match(markdown, /isChartSource/);
  assert.match(markdown, /<ChartBoard code=\{code\}/);
  assert.ok(markdown.indexOf("isChartSource") < markdown.indexOf("isGraphSource"));
});

test("markdown renders graph fences with GraphBoard", () => {
  assert.match(markdown, /isGraphSource/);
  assert.match(markdown, /<GraphBoard code=\{code\}/);
  assert.match(markdown, /pre: \(\{ children \}/);
});

test("editable markdown lazily forwards editing props to the shared notes engine", () => {
  assert.match(editor, /dynamic<NotesBlockEditorProps>/);
  assert.match(editor, /import\("@\/components\/notes\/block-editor"\)\.then\(\(module\) => module\.NotesBlockEditor\)/);
  assert.match(editor, /ssr: false/);
  assert.match(editor, /editable-markdown shared-markdown-surface/);
  assert.match(editor, /<SharedMarkdownEditor \{\.\.\.props\}\s*\/>/);
  assert.doesNotMatch(editor, /new EditorView|useEditor\(|<textarea/);
});

test("the shared markdown engine supports rendered blocks and editable source", () => {
  assert.match(blockEditor, /initialMode = "blocks"/);
  assert.match(blockEditor, /<EditorContent editor=\{editor\}\s*\/>/);
  assert.match(blockEditor, /publish\(serialize\(current\.state\.doc\)\)/);
  assert.match(blockEditor, /aria-label="Editor mode"/);
  assert.match(blockEditor, /setSourceMode\(false\)/);
  assert.match(blockEditor, /setSourceMode\(true\)/);
  assert.match(blockEditor, /sourceMode \? <MarkdownSourceEditor value=\{draft\} onChange=\{publishSource\}/);
  assert.match(sourceEditor, /new EditorView/);
  assert.match(sourceEditor, /callback\.current\(current\.current\)/);
});

test("new chat from shared notes does not reopen the notes route", () => {
  assert.match(shell, /suppressNotesRouteRef/);
  assert.match(shell, /setFocusedNoteId\(null\)/);
  assert.match(shell, /if \(suppressNotesRouteRef\.current\) return;/);
});

test("subagent chat shows the loading chat state until the first fetch", () => {
  assert.match(subagentView, /aria-label="Loading chat"/);
  assert.match(subagentView, /Loading chat…/);
  assert.match(subagentView, /setReady\(false\)/);
});

test("text deltas yield to the UI thread", () => {
  assert.match(shell, /startTransition\(\(\) => \{/);
});
