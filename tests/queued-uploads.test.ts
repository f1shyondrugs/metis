import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-queued-uploads-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root, AI_CHAT_ROOT: root });
test.after(() => rmSync(root, { recursive: true, force: true }));
test("queued photos survive PATCH, reload, and automatic worker drain with their original bytes", async t => {
  const [store, jobs, uploads, sqlite, api, chatApi, paths] = await Promise.all([
    import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/file-upload-store"), import("../lib/sqlite"),
    import("../app/api/chats/[id]/route"), import("../app/api/chat/route"), import("../lib/uploads")
  ]);
  const db = sqlite.getDatabase(), owner = randomUUID(), foreign = randomUUID(), token = randomUUID(), peerToken = randomUUID();
  for (const [id, session] of [[owner, token], [foreign, peerToken]]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(createHash("sha256").update(session).digest("hex"), id, "2099-01-01T00:00:00.000Z");
  }
  const headers = { cookie: "ai_chat_auth=" + token, "content-type": "application/json" };
  const bytes = new Uint8Array([137, 80, 78, 71, 10, 20]);
  async function uploaded(user: string, name = "photo.png") {
    const file = uploads.createUpload(user, { name, mimeType: "image/png", size: bytes.length });
    await uploads.appendUpload(user, file.id, 0, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }));
    uploads.completeUpload(user, file.id);
    return file;
  }
  const photo = await uploaded(owner), other = await uploaded(foreign);
  const patch = (chatId: string, queue: unknown) => api.PATCH(new Request("http://test/api/chats/" + chatId, { method: "PATCH", headers, body: JSON.stringify({ queuedMessages: queue }) }), { params: Promise.resolve({ id: chatId }) });
  for (const text of ["Inspect this photo", ""]) {
    const chat = store.createChat("Queued photo", undefined, owner), id = randomUUID();
    assert.equal((await patch(chat.id, [{ id, text, uploadIds: [photo.id] }])).status, 200);
    const response = await api.GET(new Request("http://test/api/chats/" + chat.id, { headers }), { params: Promise.resolve({ id: chat.id }) });
    const reloaded = (await response.json()).chat.queuedMessages[0];
    assert.equal(reloaded.attachments[0].id, photo.id);
    assert.equal(reloaded.uploadIds, undefined, "Server persists bound attachments rather than browser task IDs");
    const job = jobs.drainNextQueuedMessage(chat.id, owner)!;
    assert.equal(job.attachments?.[0].id, photo.id);
    assert.deepEqual(store.getChat(chat.id, owner)!.messages.at(-1)!.attachments, job.attachments);
    assert.deepEqual(readFileSync(path.join(paths.chatUploadDir(chat.id, owner), job.attachments![0].storedName)), Buffer.from(bytes));
    jobs.updateJob(job.id, { status: "completed" });
  }
  await t.test("manual Send now and saved-attachment-only requeue keep the same photo", async () => {
    const chat = store.createChat("Send now", undefined, owner), id = randomUUID();
    await patch(chat.id, [{ id, text: "Look", uploadIds: [photo.id] }]);
    const attachment = store.getChat(chat.id, owner)!.queuedMessages![0].attachments![0];
    const result = await chatApi.POST(new Request("http://test/api/chat", { method: "POST", headers, body: JSON.stringify({ chatId: chat.id, messageId: id, message: "Look", sendQueuedNow: true, storedAttachments: [attachment] }) }));
    assert.equal(result.status, 202);
    assert.equal(store.getChat(chat.id, owner)!.messages.at(-1)!.attachments![0].id, photo.id);
    const second = store.createChat("Restored attachment", undefined, owner);
    // Stored paths are chat-local; create an owned copy for this destination.
    const bound = uploads.materializeUploads(second.id, [photo.id], owner);
    assert.equal((await patch(second.id, [{ id: randomUUID(), text: "", attachments: bound }])).status, 200);
    assert.equal(jobs.drainNextQueuedMessage(second.id, owner)!.attachments![0].id, photo.id);
  });
  await t.test("only the editing account can still preview the queued file after removing its prompt", async () => {
    const [{ GET }, { DELETE }, { createProject }] = await Promise.all([
      import("../app/api/uploads/[chatId]/[name]/route"),
      import("../app/api/chats/[id]/queue/[messageId]/route"),
      import("../lib/projects"),
    ]);
    const project = createProject({ ownerId: owner });
    db.prepare("INSERT INTO project_members VALUES(?,?,?)").run(project.id, foreign, new Date().toISOString());
    const chat = store.createChat("Private draft in a shared chat", undefined, owner, undefined, { projectId: project.id });
    const id = randomUUID();
    assert.equal((await patch(chat.id, [{ id, text: "", uploadIds: [photo.id] }])).status, 200);
    const attachment = store.getChat(chat.id, owner)!.queuedMessages![0].attachments![0];
    const params = Promise.resolve({ chatId: chat.id, name: attachment.storedName });
    const request = (cookie?: string) => new Request("http://test/attachment", { headers: cookie ? { cookie } : {} });
    const read = async () => {
      const response = await GET(request(headers.cookie), { params });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    };
    await read();
    assert.ok(store.getChat(chat.id, foreign), "The collaborator can see the chat, not another account's queue or draft");
    assert.equal((await GET(request("ai_chat_auth=" + peerToken), { params })).status, 404);
    const remove = (messageId: string, edit: boolean) => DELETE(
      new Request("http://test/queue" + (edit ? "?edit=1" : ""), { method: "DELETE", headers }),
      { params: Promise.resolve({ id: chat.id, messageId }) },
    );
    assert.equal((await remove(id, true)).status, 200);
    assert.equal(store.getChat(chat.id, owner)!.queuedMessages, undefined);
    await read();
    assert.equal((await GET(request("ai_chat_auth=" + peerToken), { params })).status, 404);
    assert.equal((await GET(request(), { params })).status, 401);

    const nextId = randomUUID();
    assert.equal((await patch(chat.id, [{ id: nextId, text: "No attachments" }])).status, 200);
    assert.equal((await remove(nextId, true)).status, 200);
    assert.equal((await GET(request(headers.cookie), { params })).status, 404, "Replacing the draft does not keep exposing old files");
    const deleteId = randomUUID();
    assert.equal((await patch(chat.id, [{ id: deleteId, text: "", uploadIds: [photo.id] }])).status, 200);
    assert.equal((await remove(deleteId, false)).status, 200);
    assert.equal((await GET(request(headers.cookie), { params })).status, 404, "Ordinary removal does not retain a draft preview");
  });

  await t.test("reverting a sent message keeps its document preview, not files from the discarded turns", async () => {
    const [{ GET }, { POST: revert }] = await Promise.all([
      import("../app/api/uploads/[chatId]/[name]/route"),
      import("../app/api/chats/[id]/revert/route"),
    ]);
    const chat = store.createChat("Revert previews", undefined, owner);
    const docBytes = new TextEncoder().encode("Original draft document");
    const upload = uploads.createUpload(owner, { name: "draft.txt", mimeType: "text/plain", size: docBytes.byteLength });
    await uploads.appendUpload(owner, upload.id, 0, new ReadableStream({ start(c) { c.enqueue(docBytes); c.close(); } }));
    uploads.completeUpload(owner, upload.id);
    const [document, discarded] = uploads.materializeUploads(chat.id, [upload.id, photo.id], owner);
    const target = { id: randomUUID(), role: "user" as const, content: "", attachments: [document], createdAt: new Date().toISOString() };
    store.saveChat({ ...chat, messages: [target, { ...target, id: randomUUID(), attachments: [discarded] }] });
    const request = new Request("http://test/revert", { method: "POST", headers, body: JSON.stringify({ messageId: target.id }) });
    assert.equal((await revert(request, { params: Promise.resolve({ id: chat.id }) })).status, 200);
    assert.deepEqual(store.getChat(chat.id, owner)!.messages, []);
    const preview = await GET(new Request("http://test/preview", { headers }), {
      params: Promise.resolve({ chatId: chat.id, name: document.storedName }),
    });
    assert.equal(preview.status, 200);
    assert.equal(await preview.text(), "Original draft document");
    assert.equal((await GET(new Request("http://test/attachment", { headers }), {
      params: Promise.resolve({ chatId: chat.id, name: discarded.storedName }),
    })).status, 404);
  });

  await t.test("invalid, incomplete and foreign uploads never replace the queue or start text-only jobs", async () => {
    const chat = store.createChat("Rejected", undefined, owner), original = { id: randomUUID(), text: "Keep" };
    store.updateChat(chat.id, { queuedMessages: [original] }, owner);
    const incomplete = uploads.createUpload(owner, { name: "pending.png", mimeType: "image/png", size: 1 });
    for (const ids of [[other.id], [incomplete.id], [photo.id, photo.id], [123]]) {
      assert.equal((await patch(chat.id, [{ id: randomUUID(), text: "Invalid", uploadIds: ids }])).status, 400);
      assert.deepEqual(store.getChat(chat.id, owner)!.queuedMessages, [original]);
    }
    const foreignChat = store.createChat("Foreign", undefined, foreign);
    assert.equal((await patch(foreignChat.id, [{ id: randomUUID(), text: "No", uploadIds: [photo.id] }])).status, 404);
    assert.equal(store.getChat(foreignChat.id, foreign)!.queuedMessages, undefined);
  });
});
