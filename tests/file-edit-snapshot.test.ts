import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import fs from "node:fs";
import { executeFileEdit } from "../remote-client/file-edit.mjs";
import path from "node:path";
import test from "node:test";
import { withLocalFileEditSnapshot } from "../lib/file-edit-snapshot";
import { revertEditTool } from "../lib/revert";
import type { ToolPart } from "../lib/store";

function tool(
  id: string,
  name: string,
  status: string,
  filePath: string,
  extra: Partial<ToolPart> = {},
): ToolPart {
  return {
    id,
    name,
    status,
    kind: "edit",
    path: filePath,
    input: JSON.stringify({ path: filePath, content: "new content" }),
    ...extra,
  };
}

test("unverified provider creation cannot authorize privileged snapshot or rollback", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-create-"));
  try {
    const filePath = path.join(root, "created.txt");
    const running = withLocalFileEditSnapshot(tool("write-1", "write_file", "running", filePath), undefined, root);
    writeFileSync(filePath, "new content", "utf8");
    const completed = withLocalFileEditSnapshot(
      tool("write-1", "write_file", "completed", filePath, { input: undefined }),
      running,
      root,
    );

    assert.equal(completed.diff,undefined);
    assert.equal(revertEditTool(completed, root).status, "warning");
    assert.equal(readFileSync(filePath,"utf8"),"new content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unverified provider edit cannot request an existing file's body", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-edit-"));
  try {
    const filePath = path.join(root, "edited.txt");
    writeFileSync(filePath, "before", "utf8");
    const running = withLocalFileEditSnapshot(
      tool("edit-1", "edit_file", "running", filePath, {
        input: JSON.stringify({ path: filePath, oldText: "before", newText: "after" }),
      }),
      undefined,
      root,
    );
    writeFileSync(filePath, "after", "utf8");
    const completed = withLocalFileEditSnapshot(
      tool("edit-1", "edit_file", "completed", filePath, { input: undefined }),
      running,
      root,
    );

    assert.equal(completed.diff,undefined);
    assert.equal(revertEditTool(completed, root).status, "warning");
    assert.equal(readFileSync(filePath, "utf8"), "after");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unverified batch arguments cannot synthesize a trusted snapshot", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-batch-"));
  try {
    const filePath = path.join(root, "batch.txt");
    writeFileSync(filePath, "one\ntwo", "utf8");
    const input = { path: filePath, edits: [{ oldText: "one", newText: "first" }, { oldText: "two", newText: "second" }] };
    const running = withLocalFileEditSnapshot(tool("batch-1", "edit_file", "running", filePath, { input: JSON.stringify(input) }), undefined, root);
    executeFileEdit(fs, input);
    const completed = withLocalFileEditSnapshot(tool("batch-1", "edit_file", "completed", filePath, { input: undefined }), running, root);
    assert.equal(completed.diff,undefined);
    assert.equal(revertEditTool(completed, root).status, "warning");
    assert.equal(readFileSync(filePath, "utf8"), "first\nsecond");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("remote client file tools are not snapshotted against the server workspace", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-revert-remote-"));
  try {
    const filePath = path.join(root, "same-name.txt");
    writeFileSync(filePath, "server content", "utf8");
    const original = tool("write-2", "write_file", "running", filePath, {
      input: JSON.stringify({ target: "client:laptop", path: filePath, content: "remote content" }),
    });
    const clean=withLocalFileEditSnapshot(original, undefined, root);
    assert.equal(clean.path,undefined);assert.equal(clean.diff,undefined);assert.equal(clean.input,original.input);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
