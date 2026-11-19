import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeComposerReferenceMention } from "../lib/composer-references";

test("the remove action only edits the full selected mention", () => {
  assert.equal(removeComposerReferenceMention("@SKILL.md use  this", "SKILL.md", ["SKILL.md"]), "use  this");
  assert.equal(removeComposerReferenceMention("a @SKILL.md later", "SKILL.md", ["SKILL.md"]), "a later");
  assert.equal(removeComposerReferenceMention("me@SKILL.md @SKILL.md backup", "SKILL.md", ["SKILL.md", "SKILL.md backup"]), "me@SKILL.md @SKILL.md backup");
});

test("composer references round-trip with the authenticated draft, scoped to its chat or account", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-composer-draft-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AGENT_CWD: root,
    CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
  });
  const [auth, chats, sqlite, preferences, route] = await Promise.all([
    import("../lib/auth"), import("../lib/db-store"), import("../lib/sqlite"),
    import("../app/api/preferences/route"), import("../app/api/chats/[id]/route"),
  ]);
  t.after(() => { sqlite.getDatabase().close(); rmSync(root, { recursive: true, force: true }); });
  const owner = auth.createUser("draft-owner", "fixture-password").id;
  auth.createUser("draft-other", "fixture-password");
  const token = auth.authenticateUser("draft-owner", "fixture-password")!.token;
  const otherToken = auth.authenticateUser("draft-other", "fixture-password")!.token;
  const chatId = chats.createChat("With draft", undefined, owner).id;
  const otherChatId = chats.createChat("Without draft", undefined, owner).id;
  const incognito = chats.createChat("Incognito", undefined, owner, undefined, { incognito: true }).id;
  const request = (pathname: string, body?: unknown, actor = token) => new Request("http://localhost" + pathname, {
    method: body === undefined ? "GET" : "PATCH",
    headers: { cookie: "ai_chat_auth=" + actor, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const chatPath = (id: string) => "/api/chats/" + id;
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const read = async (id: string) => (await (await route.GET(request(chatPath(id)), context(id))).json()).chat.sessionState;
  const write = async (id: string, sessionState: unknown) => {
    const res = await route.PATCH(request(chatPath(id), { sessionState }), context(id));
    assert.equal(res.status, 200, await res.text());
  };

  const reference = { kind: "file", id: "skill", label: "SKILL.md", detail: "read_file", path: "/fixture/SKILL.md", target: "server" };
  const payload = [{ ...reference, content: "Unsent snapshot" }, reference, { ...reference, kind: "invalid" }];
  const input = "Check @SKILL.md ";
  await write(chatId, { input, inputUpdatedAt: "2026-11-18T12:01:00Z", draftReferences: payload });
  assert.deepEqual((await read(chatId)).draftReferences, [reference]);
  assert.equal((await read(chatId)).input, input);
  assert.equal((await read(otherChatId))?.draftReferences, undefined);
  assert.equal((await route.GET(request(chatPath(chatId), undefined, otherToken), context(chatId))).status, 404);

  await write(chatId, { input: "Older edit", inputUpdatedAt: "2026-11-18T12:00:00Z", draftReferences: [] });
  assert.deepEqual((await read(chatId)).draftReferences, [reference]);
  await write(chatId, { input: "Check ", inputUpdatedAt: "2026-11-18T12:02:00Z", draftReferences: [] });
  assert.deepEqual((await read(chatId)).draftReferences, []);
  await write(incognito, { input, draftReferences: payload });
  assert.equal((await read(incognito))?.draftReferences, undefined);

  const pref = "/api/preferences";
  assert.equal((await preferences.PATCH(request(pref, { draftInput: input, draftReferences: payload }))).status, 200);
  assert.deepEqual((await (await preferences.GET(request(pref))).json()).settings.draftReferences, [reference]);
  assert.equal((await (await preferences.GET(request(pref, undefined, otherToken))).json()).settings.draftReferences, undefined);
  assert.equal((await preferences.PATCH(request(pref, { draftInput: "legacy edit without mention" }))).status, 200);
  assert.deepEqual((await (await preferences.GET(request(pref))).json()).settings.draftReferences, []);
  console.log("COMPOSER_DRAFT_ROUND_TRIP_OK");
});
