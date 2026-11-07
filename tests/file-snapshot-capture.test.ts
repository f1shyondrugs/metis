import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { withEditedFileTracking, withLocalFileEditSnapshot } from "../lib/file-edit-snapshot";
import { readFileEditSnapshot, storeFileEditSnapshot } from "../lib/mcp-core/file-edit-snapshots.mjs";
import { executeFileEdit, executeFileWrite } from "../remote-client/file-edit.mjs";
import { revertEditTool } from "../lib/revert";
import type { ToolPart } from "../lib/store";

const directory = fs.mkdtempSync(path.join(os.userInfo().homedir, ".metis-snapshot-test-"));
Object.assign(process.env, { AI_CHAT_ROOT: directory, CHAT_DATA_DIR: directory,
  CHAT_DB_PATH: path.join(directory, "test.sqlite"), AGENT_CWD: directory,
  AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp-state"), AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1" });
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const user = os.userInfo();
const scope = { userId: "snapshot-owner", chatId: "snapshot-chat", jobId: "snapshot-job" };
const identity = { ...scope, uid: user.uid, gid: user.gid, osUsername: user.username,
  home: user.homedir, workspaceRoot: directory, isHostAdmin: true, allowRoot: true, runtimeMode: "agent" };
before(async () => {
  const auth = await import("../lib/auth"), store = await import("../lib/db-store");
  const owner = auth.createUser("snapshot-owner", "synthetic-password");
  const chat = store.createChat("Snapshot fixture", undefined, owner.id);
  Object.assign(scope, { userId: owner.id, chatId: chat.id });
  Object.assign(identity, scope);
});
const part = (id: string, status: string, file: string, extra: Partial<ToolPart> = {}): ToolPart =>
  ({ id, status, name: "write_file", kind: "edit", path: file, input: JSON.stringify({ path: file }), ...extra });
const body = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content.map(c => c.text).join("\n"));

test("gateway captures creation and subsequent edits without provider start events, even after the file changes again", async () => {
  const { dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
  const persistence = await import("../lib/tool-persistence");
  const file = path.join(directory, "nested", "created.ts");
  const call = (name: string, args: Record<string, unknown>) => dispatchGatewayTool(name, args, { context: identity, auditCall: false });
  const first = await call("write_file", { path: file, content: "first\nkeep\n" });
  assert.ok(!("isError" in first && first.isError), JSON.stringify(first));
  assert.equal(body(first).fileSnapshot, undefined, "full bodies do not enter model output");
  assert.equal(typeof body(first).fileSnapshotRef, "string");
  const second = await call("edit_file", { path: file, oldText: "first", newText: "second" });
  assert.ok(!("isError" in second && second.isError), JSON.stringify(second));
  fs.writeFileSync(file, "a later external change");
  const delayed = (id: string, name: string, result: unknown) => withEditedFileTracking(
    part(id, "completed", file, { name, result: JSON.stringify(result) }), directory, undefined, scope);
  const created = delayed("create", "write_file", first);
  const edited = delayed("edit", "edit_file", second);
  assert.deepEqual(created.diff, { before: undefined, after: "first\nkeep\n" });
  assert.deepEqual(edited.diff, { before: "first\nkeep\n", after: "second\nkeep\n" });
  const compact = persistence.persistToolsForMessage(scope.chatId, "message", [created, edited]);
  assert.equal(compact[0].diff?.after, undefined);
  assert.deepEqual(persistence.getToolRevertSnapshot(scope.chatId, "message", "create"),
    { path: file, after: "first\nkeep\n" });
  assert.deepEqual(persistence.getToolRevertSnapshot(scope.chatId, "message", "edit"),
    { path: file, before: "first\nkeep\n", after: "second\nkeep\n" });
  assert.equal(readFileEditSnapshot(body(first).fileSnapshotRef, scope), undefined, "staging is removed after SQLite acknowledgement");
  const duplicate = withEditedFileTracking(part("edit", "completed", file,
    { name: "edit_file", result: JSON.stringify(second), diff: { before: "wrong", after: "later" } }), directory, edited, scope);
  assert.deepEqual(duplicate.diff, edited.diff, "replayed completion keeps the captured historical version");
});

test("large UTF-8 snapshots survive the gateway output ceiling and result compression without entering model context", async () => {
  const { dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
  const file = path.join(directory, "large.txt");
  const original = "ä😀\\n".repeat(30_000), replacement = "currently  please stay exact\\n" + original;
  fs.writeFileSync(file, original);
  const result = await dispatchGatewayTool("write_file", { path: file, content: replacement },
    { auditCall: false, context: { ...identity, compressionEnabled: true } });
  assert.ok(!("isError" in result && result.isError), JSON.stringify(result));
  assert.ok(JSON.stringify(result).length < 1_000);
  const captured = withEditedFileTracking(part("large", "completed", file,
    { result: JSON.stringify(result) }), directory, undefined, scope);
  const digest = (text: string | undefined) => createHash("sha256").update(text ?? "").digest("hex");
  assert.equal(digest(captured.diff?.before), digest(original));
  assert.equal(digest(captured.diff?.after), digest(replacement));
});

test("checkpointing cannot downgrade a full snapshot, and authoritative creation clears a late false before-state", async () => {
  const { persistToolsForMessage, getToolRevertSnapshot } = await import("../lib/tool-persistence");
  const file = path.join(directory, "checkpoint.txt");
  persistToolsForMessage(scope.chatId, "checkpoint", [part("edit", "completed", file, { diff: { before: "old", after: "new" } })]);
  persistToolsForMessage(scope.chatId, "checkpoint", [part("edit", "running", file, { diff: { before: "old" } })]);
  assert.deepEqual(getToolRevertSnapshot(scope.chatId, "checkpoint", "edit"), { path: file, before: "old", after: "new" });
  persistToolsForMessage(scope.chatId, "checkpoint", [part("new", "running", file, { diff: { before: "already written" } })]);
  persistToolsForMessage(scope.chatId, "checkpoint", [part("new", "completed", file, { diff: { before: undefined, after: "already written" } })]);
  assert.deepEqual(getToolRevertSnapshot(scope.chatId, "checkpoint", "new"), { path: file, after: "already written" });
});

test("native lifecycle, supplied snapshots and wrapped input never establish trusted file claims", () => {
  const file = path.join(directory, "lifecycle.txt");
  const start = withLocalFileEditSnapshot(part("lifecycle", "running", file), undefined, directory);
  fs.writeFileSync(file, "created");
  const repeated = withLocalFileEditSnapshot(part("lifecycle", "running", file), start, directory);
  const complete = withLocalFileEditSnapshot(part("lifecycle", "completed", file), repeated, directory);
  assert.equal(complete.diff,undefined);
  const supplied = withLocalFileEditSnapshot(part("supplied", "completed", file, { diff: { before: "provided", after: "authoritative" } }), start, directory);
  assert.equal(supplied.diff,undefined);
  const wrapped = part("wrapped", "running", file, { name: "call_mcp_tool",
    input: JSON.stringify({ tool: "write_file", arguments: { path: file } }) });
  assert.equal(withLocalFileEditSnapshot(wrapped, undefined, directory).diff,undefined);
  const preparing = part("preparing", "running", file, { phase: "preparing" });
  assert.equal(withLocalFileEditSnapshot(preparing, undefined, directory).path,undefined);
});

test("receipt isolation covers owner, chat, run, incognito and path traversal", () => {
  const file = path.join(directory, "receipt.txt");
  const result = storeFileEditSnapshot({ path: file, fileSnapshot: { before: "before", after: "after" } }, scope);
  const id = result.fileSnapshotRef;
  assert.deepEqual(readFileEditSnapshot(id, scope)?.diff, { before: "before", after: "after" });
  for (const wrong of [{ userId: "other" }, { chatId: "other" }, { jobId: "other" }, { incognito: true }]) {
    assert.equal(readFileEditSnapshot(id, { ...scope, ...wrong }), undefined);
  }
  assert.equal(readFileEditSnapshot("../../other", scope), undefined);
  assert.equal(readFileEditSnapshot(id, undefined), undefined);
  assert.equal(storeFileEditSnapshot({ path: file, fileSnapshot: { before: null, after: "x" } }, { ...scope, incognito: true }).fileSnapshotRef, undefined);
});

test("remote snapshots retain the device target and cannot revert a same-named server file", () => {
  const file = path.join(directory, "remote.txt");
  fs.writeFileSync(file, "server");
  const result = storeFileEditSnapshot({ path: file, fileSnapshot: { before: "remote before", after: "server" } }, scope, "client:fixture");
  const tool = withEditedFileTracking(part("remote", "completed", file, { input: undefined, result: JSON.stringify(result) }), directory, undefined, scope);
  assert.equal(tool.editedFile?.target, "client:fixture");
  assert.deepEqual(tool.diff, { before: "remote before", after: "server" });
  assert.equal(revertEditTool(tool, directory).status, "warning");
  assert.equal(fs.readFileSync(file, "utf8"), "server");
});

test("dry run, failed matches, no-op writes and invalid UTF-8 never invent a historical change", () => {
  const file = path.join(directory, "guards.txt");
  fs.writeFileSync(file, "same");
  assert.equal(executeFileWrite(fs, { path: file, content: "same" }, true).fileSnapshot, undefined);
  assert.equal(executeFileEdit(fs, { path: file, oldText: "same", newText: "next", dryRun: true }, true).fileSnapshot, undefined);
  assert.throws(() => executeFileEdit(fs, { path: file, oldText: "missing", newText: "next" }, true));
  assert.equal(fs.readFileSync(file, "utf8"), "same");
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe]));
  assert.equal(executeFileWrite(fs, { path: file, content: "text" }, true).fileSnapshot, undefined);
  const empty = path.join(directory, "empty.txt");
  assert.deepEqual(executeFileWrite(fs, { path: empty, content: "" }, true).fileSnapshot, { before: null, after: "" });
});
