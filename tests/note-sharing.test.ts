import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { DatabaseSync } from "node:sqlite";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-note-sharing-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: dataDir,
  CHAT_DATA_DIR: dataDir,
  CHAT_DB_PATH: path.join(dataDir, "test.sqlite"),
  AGENT_CWD: dataDir,
  AI_CHAT_PUBLIC_URL: "https://metis.example",
  CHAT_PASSWORD: "",
  METIS_AI_BOOTSTRAP_PASSWORD: "",
  CHAT_LEGACY_HEADER_AUTH: "false",
});

// Start from the schema shipped before password support, as an actual upgrade does.
const legacyDatabase = new DatabaseSync(path.join(dataDir, "test.sqlite"));
legacyDatabase.exec(`CREATE TABLE note_shares (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_project_id TEXT,root_owner_id TEXT,created_at TEXT NOT NULL
)`);
legacyDatabase.close();
const imports = Promise.all([
  import("../lib/sqlite"),
  import("../lib/shared-context"),
  import("../lib/note-sharing"),
  import("../app/api/notes/[id]/share/route"),
  import("../app/api/shared-notes/[token]/route"),
]);
let modules: Awaited<typeof imports>;
const owner = randomUUID(), member = randomUUID(), stranger = randomUUID();
const sessions = new Map<string, string>();
function request(userId?: string, method = "GET", body?: unknown) {
  return new Request("https://metis.example/api/test", {
    method,
    headers: {
      ...(userId ? { cookie: "ai_chat_auth=" + sessions.get(userId) } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
function tokenContext(token: string) { return { params: Promise.resolve({ token }) }; }
function project(withMember = false) {
  const id = randomUUID(), now = new Date().toISOString();
  modules[0].getDatabase().prepare("INSERT INTO projects(id,owner_id,data,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, owner, JSON.stringify({ id, ownerId: owner, name: "Test project", instructions: "PRIVATE PROJECT INSTRUCTIONS" }), now, now);
  if (withMember) modules[0].getDatabase().prepare("INSERT INTO project_members(project_id,user_id,created_at) VALUES(?,?,?)").run(id, member, now);
  return id;
}

before(async () => {
  modules = await imports;
  const db = modules[0].getDatabase();
  for (const id of [owner, member, stranger]) {
    const token = randomUUID(); sessions.set(id, token);
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(id, id, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 600_000).toISOString());
  }
});
after(() => { modules?.[0].getDatabase().close(); rmSync(dataDir, { recursive: true, force: true }); });

test("share management requires a real account and current private-note or accepted-project access", async () => {
  const [, notes, shares, api] = modules;
  const privateNote = notes.createNote({ ownerId: owner, title: "Private note" });
  for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
    assert.equal((await api[method](request(undefined, method), context(privateNote.id))).status, 401);
    assert.equal((await api[method](request(stranger, method, method === "PATCH" ? {} : undefined), context(privateNote.id))).status, 404);
  }
  assert.equal((await api.GET(request(owner), context(privateNote.id))).status, 200);
  assert.deepEqual(await (await api.GET(request(owner), context(privateNote.id))).json(), { share: null });
  const created = await api.POST(request(owner, "POST"), context(privateNote.id));
  assert.equal(created.status, 200);
  const result = (await created.json()).share;
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.url, "/share/notes/" + result.token);
  assert.equal(shares.createNoteShare(privateNote.id, owner).token, result.token);
  assert.throws(() => shares.createNoteShare(privateNote.id, ""), shares.NoteShareUnavailableError);
  const projectId = project(true);
  const sharedPage = notes.createNote({ ownerId: owner, projectId });
  assert.equal((await api.POST(request(member, "POST"), context(sharedPage.id))).status, 200);
  assert.equal((await api.DELETE(request(member, "DELETE"), context(sharedPage.id))).status, 200);
});

test("malformed share requests cannot mint a token", async () => {
  const [, notes, shares, api] = modules;
  const page = notes.createNote({ ownerId: owner });
  for (const body of [null, [], "bad", { rotate: "yes" }, { rotate: 1 }]) {
    assert.equal((await api.POST(request(owner, "POST", body), context(page.id))).status, 400);
  }
  const invalidJson = new Request("https://metis.example", { method: "POST", headers: { cookie: "ai_chat_auth=" + sessions.get(owner) }, body: "{" });
  assert.equal((await api.POST(invalidJson, context(page.id))).status, 400);
  assert.equal(shares.getNoteShare(page.id, owner), null);
  const memory = notes.createNote({ ownerId: owner, kind: "learned_fact", content: "PRIVATE MEMORY" });
  assert.equal((await api.POST(request(owner, "POST"), context(memory.id))).status, 404);
});

test("a public link contains only its current readable subtree and explicit public page fields", async () => {
  const [sqlite, notes, shares, , publicApi] = modules;
  const projectId = project(true);
  const ancestor = notes.createNote({ ownerId: owner, projectId, title: "PRIVATE ANCESTOR", content: "PRIVATE ANCESTOR CONTENT" });
  const page = notes.createNote({
    ownerId: owner, parentId: ancestor.id, title: "Shared page", content: "Shared content", icon: "📚", fullWidth: true,
    todos: [{ id: "private-chat-reference", content: "Task", status: "pending", chatIds: ["PRIVATE CHAT"] }],
  });
  const child = notes.createNote({ ownerId: member, parentId: page.id, title: "Child", content: "Child content" });
  const leaf = notes.createNote({ ownerId: owner, parentId: child.id, title: "Leaf" });
  const sibling = notes.createNote({ ownerId: owner, parentId: ancestor.id, title: "PRIVATE SIBLING" });
  const otherProject = notes.createNote({ ownerId: owner, projectId: project(), title: "PRIVATE OTHER PROJECT" });
  const privatePage = notes.createNote({ ownerId: owner, title: "PRIVATE PERSONAL" });
  const fact = notes.createNote({ ownerId: owner, parentId: page.id, kind: "learned_fact", content: "PRIVATE MEMORY FACT" });
  const archived = notes.createNote({ ownerId: owner, parentId: page.id, title: "PRIVATE ARCHIVED" });
  notes.updateNote(archived.id, { ownerId: owner, archived: true });
  // A malformed legacy row in a different project must not cross the grant container.
  sqlite.getDatabase().prepare("UPDATE notes SET data=json_set(data,'$.parentId',?) WHERE id=?").run(page.id, otherProject.id);
  const token = shares.createNoteShare(page.id, owner).token;
  const response = await publicApi.GET(request(), tokenContext(token));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
  const body = await response.json();
  assert.equal(body.rootId, page.id);
  assert.deepEqual(new Set(body.notes.map((note: { id: string }) => note.id)), new Set([page.id, child.id, leaf.id]));
  assert.equal(body.notes.find((note: { id: string }) => note.id === page.id).parentId, null);
  assert.equal(body.notes.find((note: { id: string }) => note.id === child.id).parentId, page.id);
  for (const publicNote of body.notes) {
    for (const key of ["ownerId", "projectId", "chatId", "workspaceId", "scope", "author", "issueId", "position", "size", "favorite", "activities", "version"]) {
      assert.equal(Object.hasOwn(publicNote, key), false, key + " must not become public");
    }
    assert.equal(Boolean(publicNote.todos?.some((todo: { chatIds?: string[] }) => todo.chatIds)), false);
  }
  const serialized = JSON.stringify(body);
  for (const secret of [ancestor.id, sibling.id, otherProject.id, privatePage.id, fact.id, archived.id, owner, member, "PRIVATE PROJECT INSTRUCTIONS", "PRIVATE MEMORY FACT", "PRIVATE CHAT"]) {
    assert.equal(serialized.includes(secret), false, secret + " leaked");
  }
});

test("public resolution follows descendant additions, edits and moves without exposing destination neighbors", () => {
  const [, notes, shares] = modules;
  const projectId = project();
  const page = notes.createNote({ ownerId: owner, projectId });
  const child = notes.createNote({ ownerId: owner, parentId: page.id, title: "Moved child" });
  const grandchild = notes.createNote({ ownerId: owner, parentId: child.id });
  const neighbor = notes.createNote({ ownerId: owner, projectId, title: "Unshared neighbor" });
  const token = shares.createNoteShare(page.id, owner).token;
  notes.moveNote(child.id, { ownerId: owner, parentId: neighbor.id });
  assert.deepEqual(shares.getSharedNote(token)?.notes.map(note => note.id), [page.id]);
  const added = notes.createNote({ ownerId: owner, parentId: page.id, content: "Added later" });
  notes.updateNote(added.id, { ownerId: owner, content: "Updated later" });
  assert.equal(shares.getSharedNote(token)?.notes.find(note => note.id === added.id)?.content, "Updated later");
  assert.ok(!shares.getSharedNote(token)?.notes.some(note => [child.id, grandchild.id, neighbor.id].includes(note.id)));
  notes.moveNote(child.id, { ownerId: owner, parentId: page.id });
  assert.deepEqual(new Set(shares.getSharedNote(token)?.notes.map(note => note.id)), new Set([page.id, added.id, child.id, grandchild.id]));
});

test("rotation and revocation invalidate old tokens and leave authenticated note APIs private", async () => {
  const [, notes, shares, api, publicApi] = modules;
  const page = notes.createNote({ ownerId: owner });
  const first = shares.createNoteShare(page.id, owner).token;
  const rotatedResponse = await api.POST(request(owner, "POST", { rotate: true }), context(page.id));
  const second = (await rotatedResponse.json()).share.token;
  assert.notEqual(first, second);
  assert.equal((await publicApi.GET(request(), tokenContext(first))).status, 404);
  assert.equal((await publicApi.GET(request(), tokenContext(second))).status, 200);
  assert.equal((await api.DELETE(request(stranger, "DELETE"), context(page.id))).status, 404);
  assert.ok(shares.getSharedNote(second));
  assert.equal((await api.DELETE(request(owner, "DELETE"), context(page.id))).status, 200);
  assert.equal(shares.getSharedNote(second), null);
  const third = shares.createNoteShare(page.id, owner).token;
  assert.notEqual(third, first); assert.notEqual(third, second);
  for (const invalid of ["", "bad", "../" + third, third + "extra", "x".repeat(43)]) {
    assert.equal((await publicApi.GET(request(), tokenContext(invalid))).status, 404);
  }
  assert.equal("PATCH" in publicApi, false); assert.equal("DELETE" in publicApi, false);
});

test("moving the shared root across containers permanently invalidates its token until explicitly recreated", () => {
  const [, notes, shares] = modules;
  const projectA = project(), projectB = project();
  const page = notes.createNote({ ownerId: owner, projectId: projectA });
  const child = notes.createNote({ ownerId: owner, parentId: page.id });
  const token = shares.createNoteShare(page.id, owner).token;
  notes.moveNote(page.id, { ownerId: owner, projectId: projectB });
  assert.equal(shares.getSharedNote(token), null);
  assert.equal(shares.getNoteShare(page.id, owner), null);
  notes.moveNote(page.id, { ownerId: owner, projectId: projectA });
  assert.equal(shares.getSharedNote(token), null, "moving back must not revive an old grant");
  const fresh = shares.createNoteShare(page.id, owner);
  assert.notEqual(fresh.token, token);
  assert.deepEqual(new Set(shares.getSharedNote(fresh.token)?.notes.map(note => note.id)), new Set([page.id, child.id]));
});

test("archiving or deleting the root invalidates public access without restoring old grants", async () => {
  const [, notes, shares, api] = modules;
  const page = notes.createNote({ ownerId: owner });
  const token = shares.createNoteShare(page.id, owner).token;
  notes.updateNote(page.id, { ownerId: owner, archived: true });
  assert.equal(shares.getSharedNote(token), null);
  assert.equal((await api.POST(request(owner, "POST"), context(page.id))).status, 404);
  assert.equal((await api.DELETE(request(owner, "DELETE"), context(page.id))).status, 200);
  notes.updateNote(page.id, { ownerId: owner, archived: false });
  assert.equal(shares.getSharedNote(token), null);
  const fresh = shares.createNoteShare(page.id, owner).token;
  notes.updateNote(page.id, { ownerId: owner, archived: true });
  notes.updateNote(page.id, { ownerId: owner, archived: false });
  assert.equal(shares.getSharedNote(fresh), null, "restoring a page must not revive a previously public link");
  const newest = shares.createNoteShare(page.id, owner).token;
  notes.deleteNote(page.id, owner);
  assert.equal(shares.getSharedNote(newest), null);
});

test("links stop granting access when their creator loses project membership or the project disappears", () => {
  const [sqlite, notes, shares] = modules;
  const projectId = project(true);
  const page = notes.createNote({ ownerId: owner, projectId });
  const token = shares.createNoteShare(page.id, member).token;
  sqlite.getDatabase().prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(projectId, member);
  assert.equal(shares.getSharedNote(token), null);
  assert.throws(() => shares.getNoteShare(page.id, member), shares.NoteShareUnavailableError);
  const ownerLink = shares.createNoteShare(page.id, owner);
  assert.notEqual(ownerLink.token, token);
  sqlite.getDatabase().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  assert.equal(shares.getSharedNote(ownerLink.token), null);
  assert.equal(notes.getNote(page.id, owner)?.projectId, undefined);
});

test("public assets stream only exactly referenced files in the current subtree with bounded range responses", async () => {
  const [, notes, shares, , publicApi] = modules;
  const files = await import("../lib/note-attachments");
  const uploads = await import("../lib/file-upload-store");
  const assetApi = await import("../app/api/shared-notes/[token]/assets/route");
  const projectId = project(true);
  const ancestor = notes.createNote({ ownerId: owner, projectId, title: "Private ancestor" });
  const page = notes.createNote({ ownerId: owner, parentId: ancestor.id, title: "Shared assets" });
  const child = notes.createNote({ ownerId: member, parentId: page.id, title: "Child assets" });
  const sibling = notes.createNote({ ownerId: owner, parentId: ancestor.id });
  const [image, cover, stale] = await files.storeNoteFiles(page.id, [
    new File([new Uint8Array([137, 80, 78, 71, 13, 10])], "pixel.png", { type: "image/png" }),
    new File(["cover bytes"], "cover.png", { type: "image/png" }),
    new File(["stale bytes"], "removed.txt", { type: "text/plain" }),
  ], owner);
  const [childFile] = await files.storeNoteFiles(child.id, [new File(["child bytes"], "child.txt")], member);
  const [siblingFile] = await files.storeNoteFiles(sibling.id, [new File(["PRIVATE sibling bytes"], "sibling.txt")], owner);
  const [ancestorFile] = await files.storeNoteFiles(ancestor.id, [new File(["PRIVATE ancestor bytes"], "ancestor.txt")], owner);
  const ownerUpload = uploads.createUpload(owner, { name: "embedded.txt", mimeType: "text/plain", size: 14 });
  await uploads.appendUpload(owner, ownerUpload.id, 0, new Response("embedded bytes").body);
  uploads.completeUpload(owner, ownerUpload.id);
  const uploadUrl = "/api/file-uploads/" + ownerUpload.id + "/file";
  const strangerUpload = uploads.createUpload(stranger, { name: "private.txt", mimeType: "text/plain", size: 7 });
  await uploads.appendUpload(stranger, strangerUpload.id, 0, new Response("PRIVATE").body);
  uploads.completeUpload(stranger, strangerUpload.id);
  const strangerUrl = "/api/file-uploads/" + strangerUpload.id + "/file";
  const external = "https://private.example/secret.png";
  const content = [
    "![" + image.name + "](" + image.url + ")",
    "[Child report](" + childFile.url + ")",
    "[Sibling must remain private](" + siblingFile.url + ")",
    "[Ancestor must remain private](" + ancestorFile.url + ")",
    "[Foreign upload must remain private](" + strangerUrl + ")",
    "![Remote source must stay inert](" + external + ")",
    "~~~file\n" + JSON.stringify({ url: uploadUrl, name: "embedded.txt", mimeType: "text/plain" }) + "\n~~~",
  ].join("\n\n");
  notes.updateNote(page.id, { ownerId: owner, content, cover: cover.url });
  const token = shares.createNoteShare(page.id, owner).token;
  const call = (url: string, headers?: HeadersInit) => assetApi.GET(new Request(
    "https://metis.example/api/shared-notes/" + token + "/assets?url=" + encodeURIComponent(url),
    { headers },
  ), tokenContext(token));
  const response = await publicApi.GET(request(), tokenContext(token));
  const payload = await response.json();
  for (const source of [image.url, childFile.url, cover.url, uploadUrl]) {
    assert.equal(typeof payload.assets[source], "string", source + " should project to a public asset URL");
    assert.ok(payload.assets[source].startsWith("/api/shared-notes/" + token + "/assets?"));
  }
  assert.equal(payload.notes.find((note: { id: string }) => note.id === page.id).cover, payload.assets[cover.url]);
  for (const source of [stale.url, siblingFile.url, ancestorFile.url, strangerUrl, external]) {
    assert.equal(Object.hasOwn(payload.assets, source), false, source + " must not acquire a public asset URL");
    assert.equal((await call(source)).status, 404, source + " must stay private");
  }
  const imageResponse = await call(image.url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.match(imageResponse.headers.get("cache-control") || "", /no-store/);
  assert.equal(imageResponse.headers.get("referrer-policy"), "no-referrer");
  assert.match(imageResponse.headers.get("x-robots-tag") || "", /noindex/);
  assert.equal(imageResponse.headers.get("content-security-policy"), "sandbox");
  assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), new Uint8Array([137, 80, 78, 71, 13, 10]));
  const range = await call(image.url, { range: "bytes=1-3" });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 1-3/6");
  assert.deepEqual(new Uint8Array(await range.arrayBuffer()), new Uint8Array([80, 78, 71]));
  assert.equal((await call(image.url, { range: "bytes=999-1000" })).status, 416);
  assert.equal(await (await call(uploadUrl)).text(), "embedded bytes");
  assert.equal(await (await call(childFile.url)).text(), "child bytes");
  for (const source of [
    "/etc/passwd", "file:///etc/passwd", "/api/notes/" + page.id + "/attachments/../../secret",
    image.url + "?private=1", "//evil.example" + image.url, "https://evil.example" + image.url,
  ]) assert.equal((await call(source)).status, 404);
});

test("asset requests recheck reference removal, archived descendants, root moves and revocation", async () => {
  const [, notes, shares] = modules;
  const files = await import("../lib/note-attachments");
  const assetApi = await import("../app/api/shared-notes/[token]/assets/route");
  const projectId = project();
  const page = notes.createNote({ ownerId: owner, projectId });
  const child = notes.createNote({ ownerId: owner, parentId: page.id });
  const [attachment] = await files.storeNoteFiles(child.id, [new File(["scoped bytes"], "scoped.txt")], owner);
  const content = "[Download](" + attachment.url + ")";
  notes.updateNote(child.id, { ownerId: owner, content });
  let token = shares.createNoteShare(page.id, owner).token;
  const call = () => assetApi.GET(new Request(
    "https://metis.example/api/shared-notes/" + token + "/assets?url=" + encodeURIComponent(attachment.url),
  ), tokenContext(token));
  assert.equal(await (await call()).text(), "scoped bytes");
  notes.updateNote(child.id, { ownerId: owner, content: "" });
  assert.equal((await call()).status, 404, "stale stored files are not automatically shared");
  notes.updateNote(child.id, { ownerId: owner, content, archived: true });
  assert.equal((await call()).status, 404, "archived descendants cannot serve assets");
  notes.updateNote(child.id, { ownerId: owner, archived: false });
  notes.moveNote(child.id, { ownerId: owner, parentId: null });
  assert.equal((await call()).status, 404, "moved descendants cannot serve assets");
  notes.moveNote(child.id, { ownerId: owner, parentId: page.id });
  assert.equal(await (await call()).text(), "scoped bytes");
  shares.revokeNoteShare(page.id, owner);
  assert.equal((await call()).status, 404);
  token = shares.createNoteShare(page.id, owner).token;
  notes.moveNote(page.id, { ownerId: owner, projectId: project() });
  assert.equal((await call()).status, 404);
  token = shares.createNoteShare(page.id, owner).token;
  notes.updateNote(page.id, { ownerId: owner, archived: true });
  assert.equal((await call()).status, 404);
});

test("top-level uploaded media is projected with public metadata only", async () => {
  const [, notes, shares, , publicApi] = modules;
  const uploads = await import("../lib/file-upload-store");
  const assetApi = await import("../app/api/shared-notes/[token]/assets/route");
  const upload = uploads.createUpload(owner, { name: "media.png", mimeType: "image/png", size: 5 });
  await uploads.appendUpload(owner, upload.id, 0, new Response("media").body);
  uploads.completeUpload(owner, upload.id);
  const page = notes.createNote({ ownerId: owner, kind: "image", uploadId: upload.id, content: "A media caption" });
  const token = shares.createNoteShare(page.id, owner).token;
  const payload = await (await publicApi.GET(request(), tokenContext(token))).json();
  const source = "/api/file-uploads/" + upload.id + "/file";
  const asset = payload.notes.find((note: { id: string }) => note.id === page.id).asset;
  assert.deepEqual(asset, { url: payload.assets[source], name: "media.png", mimeType: "image/png", size: 5 });
  assert.equal(JSON.stringify(asset).includes(upload.id), true, "public route binds the original URL by value");
  assert.equal(Object.hasOwn(asset, "ownerId"), false);
  assert.equal(Object.hasOwn(asset, "storedName"), false);
  const response = await assetApi.GET(new Request("https://metis.example" + asset.url), tokenContext(token));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "media");
});


test("password protects notes and exact assets; unlock cookie is signed, expiring and scoped to one grant", async () => {
  const [, notes, shares, api, publicApi] = modules;
  const files = await import("../lib/note-attachments");
  const assetApi = await import("../app/api/shared-notes/[token]/assets/route");
  const page = notes.createNote({ ownerId: owner, title: "PRIVATE LOCKED TITLE", content: "PRIVATE LOCKED CONTENT" });
  const [attachment] = await files.storeNoteFiles(page.id, [new File(["locked file bytes"], "locked.txt")], owner);
  notes.updateNote(page.id, { ownerId: owner, content: "PRIVATE LOCKED CONTENT [file](" + attachment.url + ")" });
  const share = shares.createNoteShare(page.id, owner);
  assert.equal(share.active, true);
  assert.equal(share.passwordProtected, false);
  const protectedResponse = await api.PATCH(request(owner, "PATCH", { password: "correct password" }), context(page.id));
  assert.equal(protectedResponse.status, 200);
  const protectedLink = (await protectedResponse.json()).share;
  assert.equal(protectedLink.passwordProtected, true);
  assert.equal(protectedLink.token, share.token);
  const locked = await publicApi.GET(request(), tokenContext(share.token));
  assert.equal(locked.status, 401);
  assert.deepEqual(await locked.json(), {error:"Password required",passwordRequired:true});
  assert.equal(shares.getSharedNote(share.token), null);
  const assetRequest = (cookie?: string) => new Request("https://metis.example/api/shared-notes/" + share.token + "/assets?url=" + encodeURIComponent(attachment.url), {headers:cookie?{cookie}:{}});
  assert.equal((await assetApi.GET(assetRequest(),tokenContext(share.token))).status,401);
  const bad = await publicApi.POST(request(undefined,"POST",{password:"wrong"}),tokenContext(share.token));
  assert.equal(bad.status,401);
  assert.equal(JSON.stringify(await bad.json()).includes("PRIVATE"),false);
  const unlocked = await publicApi.POST(request(undefined,"POST",{password:"correct password"}),tokenContext(share.token));
  assert.equal(unlocked.status,200);
  const cookieHeader=unlocked.headers.get("set-cookie")!;
  assert.match(cookieHeader,/HttpOnly/);assert.match(cookieHeader,/SameSite=Lax/);assert.match(cookieHeader,/Max-Age=43200/);assert.match(cookieHeader,/; Secure/);
  assert.equal(cookieHeader.includes("correct password"),false);
  const cookie=cookieHeader.split(";")[0];
  assert.equal((await unlocked.json()).notes[0].title,"PRIVATE LOCKED TITLE");
  const withCookie=(value:string)=>new Request("https://metis.example",{headers:{cookie:value}});
  assert.equal((await publicApi.GET(withCookie(cookie),tokenContext(share.token))).status,200);
  assert.equal(await (await assetApi.GET(assetRequest(cookie),tokenContext(share.token))).text(),"locked file bytes");
  const [cookieName,credential]=cookie.split("=");
  const [expires,signature]=credential.split(".");
  for(const invalid of [expires+"."+signature.slice(1),String(Date.now()-1)+"."+signature,expires+"."+signature+".extra"]) {
    assert.equal((await publicApi.GET(withCookie(cookieName+"="+invalid),tokenContext(share.token))).status,401);
  }
  const other=notes.createNote({ownerId:owner});
  const second=shares.createNoteShare(other.id,owner);
  shares.updateNoteShare(other.id,owner,{password:"correct password"});
  assert.equal((await publicApi.GET(withCookie(shares.noteShareCookieName(second.token)+"="+credential),tokenContext(second.token))).status,401);
  const stored=modules[0].getDatabase().prepare("SELECT password_hash,access_key FROM note_shares WHERE note_id=?").get(page.id) as {password_hash:string;access_key:string};
  assert.notEqual(stored.password_hash,"correct password");
  assert.equal(JSON.stringify(protectedLink).includes(stored.password_hash),false);
  assert.equal(JSON.stringify(protectedLink).includes(stored.access_key),false);
});

test("stop/restart and password changes invalidate prior viewer credentials without changing the public link",async()=>{
  const [,notes,shares,api,publicApi]=modules;
  const page=notes.createNote({ownerId:owner,content:"Protected"});
  const share=shares.createNoteShare(page.id,owner);
  shares.updateNoteShare(page.id,owner,{password:"first"});
  const first=shares.unlockSharedNote(share.token,"first")!;
  assert.ok(shares.getSharedNote(share.token,first));
  const stopped=await api.PATCH(request(owner,"PATCH",{active:false}),context(page.id));
  assert.equal((await stopped.json()).share.active,false);
  assert.equal(shares.getSharedNoteAccess(share.token,first),"not_found");
  assert.equal((await publicApi.POST(request(undefined,"POST",{password:"first"}),tokenContext(share.token))).status,404);
  const resumed=shares.createNoteShare(page.id,owner);
  assert.equal(resumed.token,share.token);assert.equal(resumed.passwordProtected,true);assert.equal(resumed.active,true);
  assert.equal(shares.getSharedNoteAccess(share.token,first),"password_required");
  const second=shares.unlockSharedNote(share.token,"first")!;
  shares.updateNoteShare(page.id,owner,{password:"second"});
  assert.equal(shares.getSharedNoteAccess(share.token,second),"password_required");
  assert.equal(shares.unlockSharedNote(share.token,"first"),null);
  const third=shares.unlockSharedNote(share.token,"second")!;
  assert.ok(shares.getSharedNote(share.token,third));
  assert.equal(shares.updateNoteShare(page.id,owner,{password:null}).passwordProtected,false);
  assert.ok(shares.getSharedNote(share.token));
  shares.updateNoteShare(page.id,owner,{password:"second"});
  assert.equal(shares.getSharedNoteAccess(share.token,third),"password_required");
  shares.revokeNoteShare(page.id,owner);
  assert.equal(shares.getSharedNoteAccess(share.token,third),"not_found");
});

test("existing pre-password grants migrate as public and can acquire password protection",()=>{
  const [sqlite,notes,shares]=modules;
  const page=notes.createNote({ownerId:owner,content:"Legacy public note"});
  const token="L".repeat(43);
  sqlite.getDatabase().prepare("INSERT INTO note_shares(note_id,token,creator_id,root_project_id,root_owner_id,created_at) VALUES(?,?,?,?,?,?)")
    .run(page.id,token,owner,null,owner,new Date().toISOString());
  const legacy=shares.getNoteShare(page.id,owner)!;
  assert.equal(legacy.active,true);assert.equal(legacy.passwordProtected,false);
  assert.ok(shares.getSharedNote(token));
  shares.updateNoteShare(page.id,owner,{password:"protected legacy"});
  assert.equal(shares.getSharedNote(token),null);
  const credential=shares.unlockSharedNote(token,"protected legacy")!;
  assert.ok(shares.getSharedNote(token,credential));
});

test("sharing PATCH rejects malformed settings and does not publish an unshared note",async()=>{
  const [,notes,shares,api,publicApi]=modules;
  const page=notes.createNote({ownerId:owner});
  for(const body of [null,[],"bad",{active:1},{password:4},{password:"x".repeat(4097)},{unknown:true}]){
    assert.equal((await api.PATCH(request(owner,"PATCH",body),context(page.id))).status,400);
  }
  assert.equal((await api.PATCH(request(owner,"PATCH",{password:"secret"}),context(page.id))).status,404);
  assert.equal(shares.getNoteShare(page.id,owner),null);
  const token=shares.createNoteShare(page.id,owner).token;
  for(const body of [null,[],{},{password:3},{password:"x".repeat(4097)}]){
    assert.equal((await publicApi.POST(request(undefined,"POST",body),tokenContext(token))).status,400);
  }
});

test("public note password attempts use the existing bounded share rate limiter",async()=>{
  const [,notes,shares,,publicApi]=modules;
  const page=notes.createNote({ownerId:owner});
  const token=shares.createNoteShare(page.id,owner).token;
  shares.updateNoteShare(page.id,owner,{password:"secret"});
  for(let i=0;i<11;i++){
    const response=await publicApi.POST(request(undefined,"POST",{password:"incorrect"}),tokenContext(token));
    assert.equal(response.status,i<10?401:429);
    if(i===10)assert.ok(Number(response.headers.get("retry-after"))>0);
  }
});

test("checklist-only pages expose live todo text and statuses while dropping private and future todo metadata", async () => {
  const [sqlite, notes, shares, , publicApi] = modules;
  const todos = [
    { id: "pending-item", content: "Plan the release", status: "pending" as const },
    { id: "active-item", content: "Review the release", status: "in_progress" as const },
    { id: "finished-item", content: "Write the release notes", status: "completed" as const },
  ];
  const page = notes.createNote({ ownerId: owner, title: "Release checklist", content: "", todos });
  const privateTodos = todos.map(todo => ({
    ...todo,
    chatIds: ["PRIVATE CHECKLIST CHAT"],
    privateSecret: "PRIVATE CHECKLIST SECRET",
    futureState: { ownerId: "PRIVATE CHECKLIST OWNER", approval: "PRIVATE CHECKLIST APPROVAL" },
  }));
  sqlite.getDatabase().prepare("UPDATE notes SET data=json_set(data,'$.todos',json(?)) WHERE id=?")
    .run(JSON.stringify(privateTodos), page.id);
  const token = shares.createNoteShare(page.id, owner).token;
  const response = await publicApi.GET(request(), tokenContext(token));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const sharedPage = payload.notes.find((note: { id: string }) => note.id === page.id);
  assert.equal(sharedPage.content, "");
  assert.deepEqual(sharedPage.todos, todos);
  assert.equal(JSON.stringify(payload).includes("PRIVATE CHECKLIST"), false);
  assert.equal(Object.hasOwn(sharedPage.todos[0], "chatIds"), false);
  assert.equal(Object.hasOwn(sharedPage.todos[0], "privateSecret"), false);
  assert.equal(Object.hasOwn(sharedPage.todos[0], "futureState"), false);
  assert.deepEqual(notes.getNote(page.id, owner)?.todos, privateTodos, "public reads must not mutate the original checklist");
  const updated = todos.map(todo => todo.id === "pending-item"
    ? { ...todo, content: "Plan the published release", status: "completed" as const }
    : todo);
  notes.updateNote(page.id, { ownerId: owner, todos: updated });
  const current = shares.getSharedNote(token)?.notes.find(note => note.id === page.id);
  assert.equal(current?.content, "");
  assert.deepEqual(current?.todos, updated);
});
