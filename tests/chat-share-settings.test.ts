import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const data = mkdtempSync(path.join(os.tmpdir(), "metis-chat-share-settings-"));
process.env.CHAT_DATA_DIR = data;
process.env.CHAT_DB_PATH = path.join(data, "chat.sqlite");
process.env.AGENT_CWD = data;
process.env.AI_CHAT_ROOT = data;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
delete process.env.CHAT_PASSWORD;
after(async () => { (await import("../lib/sqlite")).getDatabase().close(); rmSync(data, { recursive: true, force: true }); });

test("opening chat share settings reads without publishing or reactivating a link", async () => {
  const auth = await import("../lib/auth");
  const db = await import("../lib/db-store");
  const { GET, PATCH } = await import("../app/api/chats/[id]/share/route");
  const user = auth.createUser("sharing-owner", "synthetic-account-password");
  const session = auth.authenticateUser(user.username, "synthetic-account-password")!.token;
  const chat = db.createChat("Synthetic sharing settings", undefined, user.id);
  const context = { params: Promise.resolve({ id: chat.id }) };
  const request = (method = "GET", body?: unknown) => new Request("http://localhost/api/chats/" + chat.id + "/share", {
    method, headers: { cookie: "ai_chat_auth=" + session, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const initial = await GET(request(), context);
  assert.equal(initial.status, 200);
  assert.match(initial.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await initial.json(), { share: null });
  assert.equal(db.getChat(chat.id, user.id)?.share, undefined);

  const created = await PATCH(request("PATCH", { active: true, password: "synthetic-view-password" }), context);
  const published = (await created.json()).share;
  assert.equal(created.status, 200);
  assert.equal(published.active, true);
  assert.deepEqual(published.content, { attachments: true, thinking: true, tools: true, suggestions: true, sources: true, workspaces: true });
  assert.equal(published.passwordProtected, true);
  assert.equal("passwordHash" in published, false);
  await PATCH(request("PATCH", { active: false }), context);
  const stopped = await GET(request(), context);
  const settings = (await stopped.json()).share;
  assert.equal(settings.id, published.id);
  assert.equal(settings.active, false);
  assert.equal(settings.passwordProtected, true);
  assert.equal("passwordHash" in settings, false);
  assert.equal(db.getChatByShareId(settings.id).status, "not_found");

  const restarted = await PATCH(request("PATCH", { active: true }), context);
  assert.equal((await restarted.json()).share.id, published.id);
  assert.equal(db.getChatByShareId(published.id).status, "password_required");
});

test("new shares include every content category while existing explicit and legacy choices stay intact", async () => {
  const auth=await import("../lib/auth"),db=await import("../lib/db-store");
  const user=auth.createUser("share-defaults-owner","synthetic-account-password");
  const chat=db.createChat("Defaults",undefined,user.id);
  db.appendMessage(chat.id,{id:"assistant",role:"assistant",content:"Response",thinking:"Reasoning",suggestions:["Next"]},user.id);
  let share=db.updateChatShare(chat.id,{active:true},user.id)!.share!;
  const visible=db.getChatByShareId(share.id);assert.equal(visible.status,"ok");
  if(visible.status==="ok"){assert.equal(visible.chat.messages[0].thinking,"Reasoning");assert.deepEqual(visible.chat.messages[0].suggestions,["Next"]);}
  const hidden={attachments:false,thinking:false,tools:false,suggestions:false,sources:false,workspaces:false};
  share=db.updateChatShare(chat.id,{content:hidden},user.id)!.share!;
  assert.deepEqual(db.updateChatShare(chat.id,{active:false},user.id)!.share!.content,hidden);
  assert.deepEqual(db.updateChatShare(chat.id,{active:true},user.id)!.share!.content,hidden);
  const legacy=db.createChat("Legacy defaults",undefined,user.id),now=new Date().toISOString();
  db.saveChat({...legacy,share:{id:"legacy-share",active:true,createdAt:now,updatedAt:now}});
  assert.equal(db.updateChatShare(legacy.id,{active:false},user.id)!.share!.content,undefined);
});

test("chat share settings require the authenticated owning account", async () => {
  const auth = await import("../lib/auth");
  const db = await import("../lib/db-store");
  const { GET } = await import("../app/api/chats/[id]/share/route");
  const owner = auth.createUser("private-sharing-owner", "synthetic-account-password");
  const other = auth.createUser("private-sharing-other", "synthetic-account-password");
  const session = auth.authenticateUser(other.username, "synthetic-account-password")!.token;
  const chat = db.createChat("Private metadata", undefined, owner.id);
  const context = { params: Promise.resolve({ id: chat.id }) };
  assert.equal((await GET(new Request("http://localhost"), context)).status, 401);
  const response = await GET(new Request("http://localhost", { headers: { cookie: "ai_chat_auth=" + session } }), context);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
  assert.equal(db.getChat(chat.id, owner.id)?.share, undefined);
});
