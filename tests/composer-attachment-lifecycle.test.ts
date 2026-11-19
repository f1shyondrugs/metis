import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { composerAttachmentKey, readDraftAttachments, saveDraftAttachments } from "../lib/chat-draft-attachments";

const source = ts.createSourceFile("app-shell.tsx", readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["activeAttachmentDraftKey", "completedPendingUpload", "persistDraftAttachments", "setPendingFiles", "addPendingFiles", "removePendingFile", "clearPendingFiles"]);
const scripts: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) scripts.push(node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("readDraftAttachments(")) {
    scripts.push("const hydrate = " + node.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(scripts.length, names.size + 1);
const program = ts.transpileModule(scripts.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const uploaded = { id: "e89a7a47-88b4-49e9-ae6d-de1557e814ea", name: "photo.png", mimeType: "image/png", size: 5, kind: "image" as const };
const browserStore = () => {
  const state = new Map<string, string>();
  return {
    getItem: (key: string) => state.get(key) ?? null,
    setItem: (key: string, value: string) => { state.set(key, value); },
    removeItem: (key: string) => { state.delete(key); },
  };
};

function app(store: ReturnType<typeof browserStore>, owner = "owner-a") {
  let finish!: (file: typeof uploaded) => void, result: typeof uploaded | undefined;
  const completion = new Promise<typeof uploaded>(resolve => { finish = resolve; });
  const context = {
    activeChatId: "chat-a" as string | null,
    activeChatIdRef: { current: "chat-a" as string | null }, activeChatIncognito: false, incognito: false, loadingChatId: null,
    draftOwnerId: owner, attachmentDraftOwnerRef: { current: owner }, chatTitle: "Draft", composerAttachmentKey, saveDraftAttachments, readDraftAttachments,
    pendingByChatRef: { current: new Map() }, privateAttachmentDraftKeys: { current: new Set() },
    restoredAttachmentsRef: { current: new Map() }, pendingFilesRef: { current: [] as { id: string; previewUrl: string; uploaded?: typeof uploaded }[] },
    URL, MAX_PENDING_FILES: 10, window: { localStorage: store }, fileInputRef: { current: null },
    setVisiblePendingFiles: () => {}, setRestoredAttachmentsByChat: () => {},
    startUpload: () => "live-upload", waitForUpload: () => completion, cancelUpload: () => {},
    getCompletedUploadResult: () => result,
    toast: { error: (error: string) => { throw Error(error); } },
  };
  const methods = vm.runInNewContext(program + ";({hydrate, addPendingFiles, removePendingFile, clearPendingFiles})", context);
  return {
    context, ...methods,
    switchChat(chatId: string | null, incognito = false) {
      context.activeChatId = chatId;
      context.activeChatIdRef.current = chatId;
      context.incognito = incognito;
      context.activeChatIncognito = incognito && !!chatId;
      methods.hydrate();
    },
    async completeUpload() {
      result = uploaded;
      finish(uploaded);
      await completion;
    },
  };
}

test("completion after leaving a chat saves the attachment to the original chat; reload reuses the authorized URL", async () => {
  const store = browserStore(), before = app(store);
  before.hydrate();
  before.addPendingFiles([new File(["bytes"], "photo.png", { type: "image/png" })]);
  assert.equal(before.context.pendingFilesRef.current.length, 1);
  before.switchChat("chat-b");
  await before.completeUpload();
  assert.equal(before.context.pendingFilesRef.current.length, 0);
  assert.deepEqual(readDraftAttachments(store, "owner-a", "chat-a").uploads, [uploaded]);
  assert.deepEqual(readDraftAttachments(store, "owner-a", "chat-b").uploads, []);

  const afterReload = app(store);
  afterReload.hydrate();
  const [resumed] = afterReload.context.pendingFilesRef.current;
  assert.equal(resumed.uploaded?.id, uploaded.id);
  assert.equal(resumed.previewUrl, `/api/file-uploads/${uploaded.id}/file`);
  afterReload.removePendingFile(resumed.id);
  assert.equal(readDraftAttachments(store, "owner-a", "chat-a").uploads.length, 0);
  saveDraftAttachments(store, "owner-a", "chat-a", { uploads: [uploaded], stored: [] });
  const otherAccount = app(store, "owner-b");
  otherAccount.hydrate();
  assert.equal(otherAccount.context.pendingFilesRef.current.length, 0);
  before.clearPendingFiles("chat-a"); // revoke the original fixture's temporary URL
});

test("Incognito stays in memory only and does not overwrite the normal draft", async () => {
  const store = browserStore(), fixture = app(store);
  saveDraftAttachments(store, "owner-a", null, { uploads: [uploaded], stored: [] });
  fixture.switchChat(null, true);
  assert.equal(fixture.context.pendingFilesRef.current.length, 0);
  fixture.addPendingFiles([new File(["bytes"], "photo.png", { type: "image/png" })]);
  await fixture.completeUpload();
  assert.equal(fixture.context.pendingFilesRef.current.length, 1);
  fixture.clearPendingFiles();
  fixture.switchChat(null, false);
  assert.equal(fixture.context.pendingFilesRef.current[0].uploaded?.id, uploaded.id);
  assert.deepEqual(readDraftAttachments(store, "owner-a", null).uploads, [uploaded]);
});
