import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown, serializeNotesMarkdown } from "../lib/notes-editor-markdown";
import { markdownChangeFitsLimit, markdownDisplayImageExtension, markdownEditorGuard } from "../lib/shared-markdown-editor";
import { appendMarkdownAttachment, markdownAttachmentLimit, markdownAttachmentTarget, persistMarkdownAttachment } from "../lib/markdown-editor-attachment";

test("shared editor rejects an over-limit PM edit atomically and keeps rich data intact", () => {
  const guard = markdownEditorGuard({ maxLength: () => 9, disabled: () => false, externalUpdate: () => false, onExceeded: () => { blocked++; } });
  let blocked = 0;
  const extensions = [...notesEditorExtensions(), guard];
  const schema = getSchema(extensions);
  // Obtain the real extension's plugin, with the same configuration used in the live editor.
  const plugins = guard.config.addProseMirrorPlugins!.call({ name: guard.name, options: guard.options, storage: guard.storage, editor: {} as never, type: null, parent: undefined } as never);
  const doc = schema.nodeFromJSON(parseNotesMarkdown("# Heading"));
  const state = EditorState.create({ schema, doc, plugins });
  const rejected = state.apply(state.tr.insertText(" more", 2));
  assert.equal(rejected.doc, state.doc);
  assert.equal(serializeNotesMarkdown(rejected.doc.toJSON()), "# Heading");
  assert.equal(blocked, 1);
  const accepted = state.apply(state.tr.insertText("M", 1, 2));
  assert.equal(serializeNotesMarkdown(accepted.doc.toJSON()), "# Meading");
});

test("file-relative images render through the preview API without rewriting saved Markdown", () => {
  const image = markdownDisplayImageExtension((url) => "/api/remote/preview?path=" + encodeURIComponent("/docs/" + url), { inline: true, allowBase64: false });
  const schema = getSchema(notesEditorExtensions().map((extension) => extension.name === "image" ? image : extension));
  const doc = schema.nodeFromJSON(parseNotesMarkdown("![Logo](images/logo.png)\n\nText"));
  const imageNode = doc.child(0).child(0);
  const dom = schema.nodes.image.spec.toDOM!(imageNode) as [string, Record<string, string>];
  assert.equal(dom[1].src, "/api/remote/preview?path=%2Fdocs%2Fimages%2Flogo.png");
  assert.equal(imageNode.attrs.src, "images/logo.png");
  const state = EditorState.create({ schema, doc });
  const changed = state.apply(state.tr.insertText(" updated", state.doc.content.size - 1));
  assert.ok(serializeNotesMarkdown(changed.doc.toJSON()).startsWith("![Logo](images/logo.png)"));
  assert.equal(serializeNotesMarkdown(changed.doc.toJSON()).includes("/api/remote/preview"), false);
});

test("disabled editor rejects programmatic mutations; controlled external updates can replace it", () => {
  let external = false;
  const guard = markdownEditorGuard({ maxLength: () => 3, disabled: () => true, externalUpdate: () => external, onExceeded: () => {} });
  const schema = getSchema(notesEditorExtensions());
  const plugins = guard.config.addProseMirrorPlugins!.call({ name: guard.name, options: guard.options, storage: guard.storage, editor: {} as never, type: null, parent: undefined } as never);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(parseNotesMarkdown("old")), plugins });
  assert.equal(state.apply(state.tr.insertText("changed", 1, 4)).doc, state.doc);
  external = true;
  const replaced = state.apply(state.tr.insertText("incoming remote value", 1, 4));
  assert.equal(replaced.doc.textContent, "incoming remote value");
});

test("limits permit shrinking legacy oversized documents and honor each document domain", () => {
  assert.equal(markdownChangeFitsLimit("oversized", "smaller", 3), true);
  assert.equal(markdownChangeFitsLimit("old", "expanded", 3), false);
  assert.equal(markdownAttachmentLimit(markdownAttachmentTarget("note"), 200_000), 50_000);
  assert.equal(markdownAttachmentLimit(markdownAttachmentTarget(undefined, { chatId: "chat", id: "plan" }), 200_000), 100_000);
  assert.equal(markdownAttachmentLimit(null, 2_000_000), 2_000_000);
  const reportTarget = markdownAttachmentTarget(undefined, { chatId: "chat", id: "report", type: "canvas", idempotencyKey: "run:research_report" });
  assert.equal(markdownAttachmentLimit(reportTarget, 500_000), 500_000);
  assert.equal(markdownAttachmentLimit(reportTarget, 600_000), 500_000);
  assert.equal(markdownAttachmentTarget(undefined), null);
});

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

test("workspace background attachments use workspace CAS after unmount and preserve concurrent edits", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const replies = [
    response({ workspace: { content: "before", version: 1 } }), response({}, 409),
    response({ workspace: { content: "concurrent edit", version: 2 } }),
    response({ workspace: { id: "plan /1", content: "concurrent edit\n\nattachment", version: 3 } }),
  ];
  const request: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return replies.shift()!; };
  const result = await persistMarkdownAttachment({ kind: "workspace", id: "plan /1", chatId: "chat /2" }, "attachment", 100_000, request);
  assert.equal(result.content, "concurrent edit\n\nattachment");
  assert.ok(calls[0].url.startsWith("/api/workspaces?"));
  assert.ok(calls[0].url.includes("chatId=chat%20%2F2"));
  assert.equal(calls[1].url, "/api/workspaces");
  assert.deepEqual(JSON.parse(String(calls[3].init?.body)), { chatId: "chat /2", id: "plan /1", version: 2, content: "concurrent edit\n\nattachment" });
  assert.equal(calls.some((call) => call.url.startsWith("/api/notes")), false);
});

test("note uploads keep the original note route and retries are idempotent", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url) => { calls.push(String(url)); return response({ note: { content: "text\n\nattachment", version: 5 } }); };
  const result = await persistMarkdownAttachment({ kind: "note", id: "original note" }, "attachment", 50_000, request);
  assert.equal(result.version, 5);
  assert.deepEqual(calls, ["/api/notes/original%20note"]);
});

test("attachment limits fail before PATCH without slicing source or rich fences", async () => {
  let writes = 0;
  const request: typeof fetch = async (_url, init) => { if (init?.method === "PATCH") writes++; return response({ workspace: { content: "existing", version: 1 } }); };
  await assert.rejects(persistMarkdownAttachment({ kind: "workspace", id: "canvas", chatId: "chat" }, "```metis-block\n{}\n```", 12, request), /Document is full/);
  assert.equal(writes, 0);
  assert.throws(() => appendMarkdownAttachment("existing", "attachment", 8), /Document is full/);
});

test("persistent conflicts leave attachment retryable and do not fall back to another API", async () => {
  let reads = 0, writes = 0;
  const request: typeof fetch = async (_url, init) => {
    if (init?.method === "PATCH") { writes++; return response({}, 409); }
    reads++; return response({ note: { content: "latest " + reads, version: reads } });
  };
  await assert.rejects(persistMarkdownAttachment({ kind: "note", id: "original" }, "file", 50_000, request), /Document changed/);
  assert.equal(reads, 3); assert.equal(writes, 3);
});
