import assert from "node:assert/strict";
import test from "node:test";
import { composerAttachmentKey, readDraftAttachments, saveDraftAttachments } from "../lib/chat-draft-attachments";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}
const upload = { id: "e89a7a47-88b4-49e9-ae6d-de1557e814ea", name: "photo.png", mimeType: "image/png", size: 25, kind: "image" as const };
const stored = { id: "stored-2", name: "text.txt", storedName: "registered-text.txt", mimeType: "text/plain", size: 4, kind: "file" as const };

test("finished attachments survive a fresh read, scoped to the exact authenticated account and chat", () => {
  const state = storage(), empty = { uploads: [], stored: [] };
  assert.equal(saveDraftAttachments(state, "account-a", "chat-a", { uploads: [upload], stored: [stored] }), true);
  assert.deepEqual(readDraftAttachments(state, "account-a", "chat-a"), { uploads: [upload], stored: [stored] });
  assert.deepEqual(readDraftAttachments(state, "account-b", "chat-a"), empty);
  assert.deepEqual(readDraftAttachments(state, "account-a", "chat-b"), empty);
  assert.deepEqual(readDraftAttachments(state, "account-a", null), empty);
  assert.equal(saveDraftAttachments(state, "account-a", "chat-a", empty), true);
  assert.deepEqual(readDraftAttachments(state, "account-a", "chat-a"), empty);
  assert.equal(state.values.size, 0);
});

test("drafts retain only bounded canonical metadata, not previews, paths, or blobs", () => {
  const state = storage();
  const pending = { ...upload, previewUrl: "blob:temporary-test", file: { bytes: [0] } };
  saveDraftAttachments(state, "account", "chat", {
    uploads: [pending, { ...upload, id: "../file" }, upload],
    stored: [{ ...stored, storedName: "../secret" }, stored],
  });
  const [serialized] = state.values.values();
  assert.doesNotMatch(serialized, /blob:|temporary|\/\.|bytes|secret/);
  assert.deepEqual(readDraftAttachments(state, "account", "chat"), { uploads: [upload], stored: [stored] });
});

test("unsent normal and Incognito composers have distinct in-memory keys; new drafts store only uploaded handles", () => {
  const state = storage();
  assert.notEqual(composerAttachmentKey(null, false), composerAttachmentKey(null, true));
  saveDraftAttachments(state, "account", null, { uploads: [upload], stored: [stored] });
  assert.deepEqual(readDraftAttachments(state, "account", null), { uploads: [upload], stored: [] });
});

test("clipboard storage being blocked cannot break in-memory attachment handling", () => {
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.deepEqual(readDraftAttachments(blocked, "one", "chat"), { uploads: [], stored: [] });
  assert.equal(saveDraftAttachments(blocked, "one", "chat", { uploads: [upload], stored: [] }), false);
});
