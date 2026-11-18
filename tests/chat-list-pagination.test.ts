import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-chat-list-"));
Object.assign(process.env, { AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root, CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "" });
const modules = Promise.all([import("../lib/auth"), import("../lib/db-store"), import("../lib/sqlite"), import("../app/api/chats/route")]);
after(async () => { (await modules)[2].getDatabase().close(); rmSync(root, { recursive: true, force: true }); });
let sequence = 0;
async function user() {
  const [auth] = await modules;
  const username = "page-user-" + (++sequence);
  const result = auth.createUser(username, "fixture-password");
  return { ...result, token: auth.authenticateUser(username, "fixture-password")!.token };
}
function req(token?: string, params = new URLSearchParams()) {
  return new Request("http://localhost/api/chats?" + params, { headers: token ? { cookie: "ai_chat_auth=" + token } : {} });
}

test("API defaults to 30, walks deterministic pinned/timestamp ties without gaps and excludes private rows", async () => {
  const [, store, sqlite, route] = await modules;
  const owner = await user(), other = await user();
  const expected = [];
  for (let i = 0; i < 76; i++) {
    const chat = store.createChat("Chat " + i, undefined, owner.id);
    sqlite.getDatabase().prepare("UPDATE chat_list SET pinned=?, last_message_sent=? WHERE id=?").run(i < 34 ? 1 : 0, "2026-01-01T00:00:00.000Z", chat.id);
    expected.push(chat.id);
  }
  store.createChat("Other owner", undefined, other.id);
  store.createChat("Incognito", undefined, owner.id, undefined, { incognito: true });
  const archived = store.createChat("Archived", undefined, owner.id);
  store.updateChat(archived.id, { archived: true }, owner.id);
  const automated = store.createChat("Automated", undefined, owner.id);
  sqlite.getDatabase().prepare("UPDATE chat_list SET automation_run_id=? WHERE id=?").run("run", automated.id);
  store.clearStoreCaches();
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const response = await route.GET(req(owner.token, params));
    assert.equal(response.status, 200);
    const page = await response.json();
    if (pages === 0) assert.equal(page.chats.length, 30);
    assert.ok(page.chats.length <= 30);
    seen.push(...page.chats.map((chat: {id: string}) => chat.id));
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 76);
  assert.deepEqual([...seen].sort(), expected.sort());
  assert.deepEqual(seen, store.listChatsForUser(owner.id).map(chat => chat.id));
});

test("cursor survives insertion/deletion above the boundary; API input and authentication are bounded", async () => {
  const [, store,, route] = await modules, owner = await user();
  for (let i = 0; i < 7; i++) store.createChat("Cursor " + i, undefined, owner.id);
  const first = await (await route.GET(req(owner.token, new URLSearchParams({limit:"3"})))).json();
  store.deleteChat(first.chats[0].id, owner.id);
  store.createChat("Inserted newer chat", undefined, owner.id);
  const next = await (await route.GET(req(owner.token, new URLSearchParams({limit:"3", cursor:first.nextCursor})))).json();
  assert.equal(next.chats.length, 3);
  assert.ok(next.chats.every((chat: {id:string}) => !first.chats.some((entry: {id:string}) => entry.id === chat.id)));
  assert.equal((await route.GET(req())).status, 401);
  for (const limit of ["0", "-1", "101", "NaN", "1.5", ""]) {
    assert.equal((await route.GET(req(owner.token, new URLSearchParams({limit})))).status, 400);
  }
  for (const cursor of ["", "broken", "x".repeat(2049), Buffer.from('{"pinned":2}').toString("base64url")]) {
    assert.equal((await route.GET(req(owner.token, new URLSearchParams({cursor})))).status, 400);
  }
});

test("project filtering happens before pagination, honors hidden projects and revoked membership", async () => {
  const [, store,, route] = await modules, owner = await user(), member = await user(), other = await user();
  const projects = await import("../lib/projects"), sharing = await import("../lib/project-sharing");
  const project = projects.createProject({ownerId:owner.id,name:"Hidden pages"});
  projects.updateProject(project.id, {hideChatsFromAll:true}, owner.id);
  const invitation = sharing.inviteProjectMember(project.id, owner.id, member.username);
  sharing.respondProjectInvitation(invitation.id, member.id, "accept");
  const shared = store.createChat("Shared", undefined, member.id, undefined, {projectId:project.id});
  const own = store.createChat("Own", undefined, owner.id);
  const all = await (await route.GET(req(owner.token,new URLSearchParams({sidebar:"true"})))).json();
  assert.deepEqual(all.chats.map((c:{id:string})=>c.id),[own.id]);
  const filtered = await (await route.GET(req(owner.token,new URLSearchParams({sidebar:"true",projectId:project.id,limit:"1"})))).json();
  assert.deepEqual(filtered.chats.map((c:{id:string})=>c.id),[shared.id]);
  assert.equal((await (await route.GET(req(other.token,new URLSearchParams({projectId:project.id})))).json()).chats.length,0);
  const sqlite = (await modules)[2];
  sqlite.getDatabase().prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(project.id, member.id);
  store.clearStoreCaches();
  assert.equal((await (await route.GET(req(member.token,new URLSearchParams({projectId:project.id})))).json()).chats.length,0);
  // Archived/settings requests still enumerate all pages through the same bounded API.
  store.updateChat(own.id,{archived:true},owner.id);
  const archived = await (await route.GET(req(owner.token,new URLSearchParams({includeArchived:"true"})))).json();
  assert.ok(archived.chats.some((c:{id:string;archived?:boolean})=>c.id===own.id && c.archived));
});
