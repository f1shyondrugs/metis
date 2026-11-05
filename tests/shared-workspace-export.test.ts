import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "metis-shared-workspaces-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root });
test.after(() => rmSync(root, { recursive: true, force: true }));

test("shared exports use saved content, cookie access, revocation and exact workspace scope", async () => {
  const auth = await import("../lib/auth"), db = await import("../lib/db-store");
  const { POST } = await import("../app/api/share/workspace/route"), shares = await import("../app/api/share/route");
  const owner = auth.createUser("workspace-export-owner", "synthetic-password");
  const workspace = { id: "public-doc", type: "canvas" as const, name: "Shared / report", content: "# Actual saved content\n\nFull report.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const chat = db.createChat("Shared", undefined, owner.id), foreign = db.createChat("Private", undefined, owner.id);
  db.saveChat({ ...chat, workspaces: [workspace] });
  db.saveChat({ ...foreign, workspaces: [{ ...workspace, id: "private-doc", content: "Secret" }] });
  let share = db.updateChatShare(chat.id, { active: true }, owner.id)!.share!;
  const request = (format = "md", cookie?: string, overrides = {}) => new Request("http://test/api/share/workspace", {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ id: share.id, workspaceId: workspace.id, format, ...overrides }),
  });
  let response = await POST(request());
  assert.equal(response.status, 200); assert.equal(await response.text(), workspace.content);
  assert.match(response.headers.get("content-disposition")!, /Shared%20-%20report.md/);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  response = await POST(request("txt")); assert.equal(response.status, 200);
  assert.equal(await response.text(), "Actual saved content\n\nFull report.");
  response = await POST(request("pdf")); assert.equal(response.status, 200);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await POST(request("md", undefined, { workspaceId: "private-doc" }))).status, 404);
  assert.equal((await POST(request("md", undefined, { content: "Injected export" }))).status, 400);
  assert.equal((await POST(request("html"))).status, 400);
  share = db.updateChatShare(chat.id, { password: "viewer-secret" }, owner.id)!.share!;
  assert.equal((await POST(request())).status, 401);
  const unlocked = await shares.POST(new Request("http://test/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: share.id, password: "viewer-secret" }) }));
  const cookie = unlocked.headers.get("set-cookie")!.split(";")[0];
  response = await POST(request("md", cookie)); assert.equal(response.status, 200); assert.equal(await response.text(), workspace.content);
  const otherShare = db.updateChatShare(foreign.id, { active: true, password: "viewer-secret" }, owner.id)!.share!;
  assert.equal((await POST(request("md", cookie, { id: otherShare.id, workspaceId: "private-doc" }))).status, 401);
  share = db.updateChatShare(chat.id, { password: "" }, owner.id)!.share!;
  const rendering = POST(request("pdf"));
  // Let the request validate and enter the asynchronous renderer before disabling the content.
  await new Promise(resolve => setTimeout(resolve, 30));
  db.updateChatShare(chat.id, { content: { workspaces: false } }, owner.id);
  assert.equal((await rendering).status, 404);
  assert.equal((await POST(request())).status, 404);
  db.updateChatShare(chat.id, { active: false }, owner.id);
  assert.equal((await POST(request())).status, 404);
});
