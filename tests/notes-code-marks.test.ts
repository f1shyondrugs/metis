import test from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import * as Y from "yjs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { notesEditorExtensions } from "../lib/notes-editor-extensions";
import { parseNotesMarkdown, serializeNotesMarkdown, notesNodeSignature } from "../lib/notes-editor-markdown";
import { createNoteCollaborationDocument, noteCollaborationMarkdown } from "../lib/note-collaboration-document";

const table = "| Option | Suitable for | Advantages | Effort | Recommendation |\n|---|---|---|---|---|\n| **`sample-updater` retained** | Desktop | Existing integration | Test restart | Keep |";
const fixtures = [
  "**`sample-updater`**", "*`sample-updater`*", "~~`sample-updater`~~",
  "[**`sample-updater`**](https://example.com/docs)",
  "# **`sample-updater`**\n\n- **`sample-updater`**\n\n" + table,
];

test("the corrected five-column comparison renders as a GFM table", () => {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(table);
  const parsed = tree.children[0];
  assert.equal(parsed.type, "table");
  if (parsed.type !== "table") throw Error("Expected a GFM table");
  assert.equal(parsed.children.length, 2);
  for (const row of parsed.children) assert.equal(row.children.length, 5);
  assert.equal(parseNotesMarkdown(table).content![0].type, "table");
});

test("Markdown wrappers around inline code are valid in local and collaborative editor schemas", () => {
  for (const collaborative of [false, true]) {
    const schema = getSchema(notesEditorExtensions(collaborative));
    for (const source of fixtures) {
      const doc = schema.nodeFromJSON(parseNotesMarkdown(source));
      doc.check();
      let combined = 0;
      doc.descendants(node => {
        if (node.marks.some(mark => mark.type.name === "code")) {
          assert.ok(node.marks.some(mark => mark.type.name !== "code"));
          combined++;
        }
      });
      assert.ok(combined > 0);
      assert.equal(serializeNotesMarkdown(doc.toJSON()), source);
    }
  }
});

test("editing formatted inline code preserves marks, links and table structure on reload", () => {
  const schema = getSchema(notesEditorExtensions());
  for (const source of fixtures) {
    const doc = schema.nodeFromJSON(parseNotesMarkdown(source));
    let position = -1;
    doc.descendants((node, pos) => { if (position < 0 && node.isText && node.marks.some(mark => mark.type.name === "code")) position = pos; });
    const state = EditorState.create({ schema, doc });
    const edited = state.apply(state.tr.insertText("new-", position + 1)).doc;
    edited.check();
    const saved = serializeNotesMarkdown(edited.toJSON());
    const reloaded = schema.nodeFromJSON(parseNotesMarkdown(saved));
    reloaded.check();
    assert.equal(notesNodeSignature(reloaded.toJSON()), notesNodeSignature(edited.toJSON()));
    assert.ok(reloaded.textContent.includes("snew-ample-updater"));
  }
});

test("formatted code survives collaborative document creation and a fresh snapshot", () => {
  for (const source of fixtures) {
    const doc = createNoteCollaborationDocument(source);
    const restored = new Y.Doc();
    try {
      Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
      assert.equal(noteCollaborationMarkdown(restored, 50_000), source);
    } finally { doc.destroy(); restored.destroy(); }
  }
});

test("code mark still excludes duplicates but not its legal Markdown wrappers", () => {
  const schema = getSchema(notesEditorExtensions());
  const code = schema.marks.code;
  assert.ok(code.excludes(code));
  for (const name of ["bold", "italic", "strike", "link"]) assert.equal(code.excludes(schema.marks[name]), false);
});
