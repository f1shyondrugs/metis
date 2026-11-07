import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("manual workspaces and registered text imports persist without overwrites or filesystem access", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-workspace-create-"));
  Object.assign(process.env, { AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root, CHAT_LEGACY_HEADER_AUTH: "false" });
  const auth = await import("../lib/auth"), db = await import("../lib/db-store"), uploads = await import("../lib/uploads");
  const { POST, PATCH } = await import("../app/api/workspaces/route");
  const owner = auth.createUser("workspace-owner", "synthetic-password"), other = auth.createUser("workspace-other", "synthetic-password");
  const token = auth.authenticateUser("workspace-owner", "synthetic-password")!.token;
  const foreign = auth.authenticateUser("workspace-other", "synthetic-password")!.token;
  const chat = db.createChat("Files", undefined, owner.id);
  const request = (body: unknown, credential: string | null = token) => new Request("http://localhost/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json", ...(credential ? { cookie: "ai_chat_auth=" + credential } : {}) }, body: JSON.stringify(body) });
  try {
    const manual = { chatId: chat.id, type: "canvas", requestId: "manual-1" };
    assert.equal((await POST(request(manual, null))).status, 401);
    assert.equal((await POST(request(manual, foreign))).status, 404);
    for (const body of [null, [], {}, { ...manual, type: "file" }, { ...manual, requestId: "" }]) assert.equal((await POST(request(body))).status, 400);
    let response = await POST(request(manual)); assert.equal(response.status, 200);
    const canvas = (await response.json()).workspace;
    assert.equal(canvas.content, ""); assert.equal(canvas.name, "Canvas");
    assert.equal((await (await POST(request(manual))).json()).workspace.id, canvas.id);
    const second = (await (await POST(request({ ...manual, requestId: "manual-2" }))).json()).workspace;
    assert.equal(second.name, "Canvas (2)");
    assert.equal(db.getChat(chat.id, owner.id)!.workspaces!.length, 2);
    const source = path.join(root, "report.md"), content = "# Original\n\n- [ ] Check Grüße 🚀\n\nEND";
    writeFileSync(source, content);
    const file = await uploads.saveFileAttachment(chat.id, source, { name: "report.md", mimeType: "text/markdown" }, owner.id);
    db.appendMessage(chat.id, { id: "provided", role: "assistant", content: "", attachments: [file] }, owner.id);
    rmSync(source);
    const body = { chatId: chat.id, type: "canvas", sourceUrl: "/api/uploads/" + chat.id + "/" + file.storedName };
    response = await POST(request(body)); assert.equal(response.status, 200);
    const imported = (await response.json()).workspace;
    assert.equal(imported.content, content); assert.equal(imported.name, "report");
    assert.equal(db.getChat(chat.id, owner.id)!.workspaces!.find(w => w.id === imported.id)!.content, content);
    response = await PATCH(request({ chatId: chat.id, id: imported.id, version: 1, content: "# Edited" }));
    assert.equal(response.status, 200);
    assert.equal((await (await POST(request(body))).json()).workspace.content, "# Edited");
    const plan = (await (await POST(request({ ...body, type: "plan" }))).json()).workspace;
    assert.equal(plan.content, content); assert.notEqual(plan.id, imported.id);
    for (const sourceUrl of [source, "workspace://file/private", "https://example.org/test.md", "/api/uploads/other/" + file.storedName, body.sourceUrl + "?download=1", "/api/uploads/" + chat.id + "/..%2fsecret"]) assert.equal((await POST(request({ ...body, sourceUrl }))).status, 404);
    assert.equal((await POST(request(body, foreign))).status, 404);
    for (const [name, bytes, status] of [
      ["large.txt", Buffer.from("x".repeat(100_001)), 413],
      ["huge.txt", Buffer.alloc(500_000, 120), 413],
      ["binary.txt", Buffer.from([0, 1, 2]), 415],
      ["invalid.txt", Buffer.from([0xff, 0x80]), 415],
      ["archive.zip", Buffer.from("zip"), 415],
    ] as const) {
      writeFileSync(source, bytes);
      const attachment = await uploads.saveFileAttachment(chat.id, source, { name, mimeType: "application/octet-stream" }, owner.id);
      db.appendMessage(chat.id, { id: name, role: "assistant", content: "", attachments: [attachment] }, owner.id);
      assert.equal((await POST(request({ ...body, sourceUrl: "/api/uploads/" + chat.id + "/" + attachment.storedName }))).status, status);
    }
    const count = db.getChat(chat.id, owner.id)!.workspaces!.length;
    const concurrent = await Promise.all([POST(request({ ...body, type: "plan" })), POST(request({ ...body, type: "plan" }))]);
    assert.equal((await concurrent[0].json()).workspace.id, (await concurrent[1].json()).workspace.id);
    assert.equal(db.getChat(chat.id, owner.id)!.workspaces!.length, count);
    const current = db.getChat(chat.id, owner.id)!;
    db.saveChat({ ...current, workspaces: Array.from({ length: 20 }, (_, i) => ({ ...canvas, id: "existing-" + i, name: "Item " + i })) });
    assert.equal((await POST(request({ ...manual, requestId: "full" }))).status, 409);
    assert.equal(db.getChat(chat.id, owner.id)!.workspaces!.length, 20);
    db.saveChat({ ...db.getChat(chat.id, owner.id)!, incognito: true });
    assert.equal((await POST(request(manual))).status, 403);
  } finally {
    (await import("../lib/sqlite")).getDatabase().close();
    rmSync(root, { recursive: true, force: true });
  }
});
