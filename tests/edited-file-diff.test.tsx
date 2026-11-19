import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SnapshotDiff, EditedFileDiff, EditedFileEditorDiff } from "../components/edited-file-diff";
import { initialEditTool, loadEditSnapshot, snapshotFromDiff, snapshotHunks, toolsForEditedFile } from "../lib/edited-file-diff";
import type { ToolPart } from "../lib/store";

Object.assign(globalThis, { React });
const file = { path: "/workspace/a.ts", target: "server" };
const tool: ToolPart = { id: "one", name: "edit_file", status: "completed", editedFile: file };
test("exact snapshots include removed, added, blank lines, deletion and missing newline", () => {
  const html = renderToStaticMarkup(<SnapshotDiff snapshot={{ before: "old\n\nlast", after: "new\n\nlast\n" }} />);
  assert.match(html, /data-diff-kind="removed"/);
  assert.match(html, /data-diff-kind="added"/);
  assert.match(html, />old</);
  assert.match(html, />new</);
  assert.match(html, /Old line/);
  assert.match(html, /New line/);
  assert.match(html, /No newline at end of file/);
  assert.equal(snapshotHunks({ before: "gone\n", after: "" })[0].oldLines, 1);
  assert.equal(snapshotHunks({ before: "", after: "new\n" })[0].newLines, 1);
  assert.equal(snapshotFromDiff({ after: "new" }), undefined);
  assert.deepEqual(snapshotFromDiff({ before: null, after: "new" }), { before: "", after: "new" });
  assert.deepEqual(snapshotFromDiff({ after: "created" }, true), { before: "", after: "created" });
  const long = renderToStaticMarkup(<SnapshotDiff snapshot={{before:"",after:"added\n".repeat(900)}}/>);
  assert.match(long,/Show more lines/);
  assert.equal((long.match(/data-diff-kind="added"/g)||[]).length,500);
  assert.match(renderToStaticMarkup(<SnapshotDiff snapshot={{before:"",after:"x".repeat(2_000_001)}}/>),/2 MB preview limit/);
});
test("all edits remain ordered and remote targets never collide", () => {
  const edits = [tool, { ...tool, id: "two" }, { ...tool, id: "remote", editedFile: { ...file, target: "client:pc" } }];
  assert.deepEqual(toolsForEditedFile(file, edits).map(edit => edit.id), ["one", "two"]);
  assert.deepEqual(toolsForEditedFile(file, [tool,...edits]).map(edit=>edit.id),["one","two"]);
  const html = renderToStaticMarkup(<EditedFileDiff file={file} tools={edits} />);
  assert.match(html, /Edit 1 of 2/);
  assert.match(html, /Edit 2 of 2/);
  assert.match(renderToStaticMarkup(<EditedFileDiff file={file} />), /Historical snapshots unavailable/);
});
test("the editor opens the selected historical version, or the first one with a known jump", () => {
  const range = { startLine: 120, endLine: 120, kind: "added" as const };
  const historical = { ...tool, id: "recorded", editedFile: { ...file, ranges: [range] } };
  const later = { ...historical, id: "later" };
  assert.equal(initialEditTool([tool,historical,later])?.id, "recorded");
  assert.equal(initialEditTool([tool,historical,later], {toolId:"later",range})?.id, "later");
  assert.equal(initialEditTool([tool,historical,later], {toolId:"missing",range})?.id, "recorded");
  const html = renderToStaticMarkup(<EditedFileEditorDiff file={file} language="plaintext" tools={[tool,historical,later]} focus={{toolId:"later",range}} />);
  assert.match(html, /<option value="later" selected="">Edit 3 of 3<\/option>/);
});
test("memory snapshots avoid requests; incomplete snapshots fetch exact encoded identity and propagate abort", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "/api/chats/chat%2Fid/tool-diff?messageId=message%26id&toolId=one");
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    return Response.json({ diff: { path: file.path, before: "old", after: "new" } });
  };
  try {
    assert.deepEqual(await loadEditSnapshot({ ...tool, diff: { before: "", after: "live" } }, {}, controller.signal), { before: "", after: "live" });
    assert.equal(calls, 0);
    assert.deepEqual(await loadEditSnapshot(tool, { chatId: "chat/id", messageId: "message&id" }, controller.signal), { before: "old", after: "new" });
    assert.equal(calls, 1);
    assert.equal(await loadEditSnapshot(tool, {}, controller.signal), undefined);
    globalThis.fetch = async () => Response.json({diff:{after:"created file"}});
    assert.deepEqual(await loadEditSnapshot(tool,{chatId:"c",messageId:"m"},controller.signal),{before:"",after:"created file"});
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(await loadEditSnapshot(tool, { chatId: "c", messageId: "m" }, controller.signal), undefined);
    globalThis.fetch = async () => new Response("", { status: 500 });
    await assert.rejects(loadEditSnapshot(tool, { chatId: "c", messageId: "m" }, controller.signal), /HTTP 500/);
    globalThis.fetch = async () => { throw new DOMException("Aborted", "AbortError"); };
    await assert.rejects(loadEditSnapshot(tool, { chatId: "c", messageId: "m" }, controller.signal), { name: "AbortError" });
  } finally { globalThis.fetch = original; }
});
