import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { hasUnfinishedComposerUploads } from "../lib/composer-send";

test("uploads gate until completion, including finalization, errors and lost tasks", () => {
  for (const status of ["queued", "uploading", "finishing", "error", "cancelled", undefined]) {
    assert.equal(hasUnfinishedComposerUploads([{ uploadTaskId: "a" }], () => status), true, status);
  }
  assert.equal(hasUnfinishedComposerUploads([{ uploadTaskId: "a" }], () => "completed"), false);
});

test("only attachments on this submission gate send; removing the last unfinished one unlocks", () => {
  const statuses: Record<string, string> = { done: "completed", otherChat: "uploading", pending: "finishing" };
  const lookup = (id: string) => statuses[id];
  assert.equal(hasUnfinishedComposerUploads([{ uploadTaskId: "done" }], lookup), false);
  assert.equal(hasUnfinishedComposerUploads([{ uploadTaskId: "done" }, { uploadTaskId: "pending" }], lookup), true);
  assert.equal(hasUnfinishedComposerUploads([], lookup), false);
  // Legacy queued attachments without a background task use sendInner's upload path.
  assert.equal(hasUnfinishedComposerUploads([{}], lookup), false);
});

test("AppShell's real send entry rejects Enter, form submit and queue/force before clearing the draft", async () => {
  const source = ts.createSourceFile("app-shell.tsx", readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function find(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "send") declaration = node;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const files = [{ uploadTaskId: "pending" }];
  let prevented = 0;
  const context = vm.createContext({
    reverting: false, loadingChatId: null, activeChatId: "chat",
    activeChatIdRef: { current: "chat" }, pendingFilesRef: { current: files },
    chainSelectionBusyRef: { current: false }, sendInFlightKeysRef: { current: new Set() },
    shouldIgnoreComposerEnter: () => false, hasUnfinishedComposerUploads,
    getUploadStatus: () => "uploading",
  });
  vm.runInContext(code, context);
  // Nothing after the gate is mocked: entering the old send path would throw.
  for (const event of [
    { preventDefault: () => prevented++ },
    { key: "Enter", shiftKey: false, nativeEvent: {}, preventDefault: () => prevented++ },
  ]) {
    await context.send(event);
    await context.send(event, "queued override", files, true);
  }
  assert.equal(prevented, 4);
  assert.deepEqual(context.pendingFilesRef.current, files);
});
