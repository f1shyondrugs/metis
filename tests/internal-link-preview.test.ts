import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { InternalLinkPreview } from "../lib/internal-link";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-internal-link-preview-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, METIS_AI_BOOTSTRAP_PASSWORD: "", CHAT_PASSWORD: "", CHAT_LEGACY_HEADER_AUTH: "false",
});

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/shared-context"),
  import("../lib/automations"),
  import("../lib/sqlite"),
  import("../app/api/internal-link-preview/route"),
]);
let modules: Awaited<typeof modulesPromise>;
let token = "", foreignToken = "", noteId = "", automationId = "", ownerId = "", foreignOwnerId = "";
const planId = "preview-plan", canvasId = "preview-canvas";

before(async () => {
  modules = await modulesPromise;
  const [{ createUser, authenticateUser }, { createChat, saveChat }, { createNote }, { createAutomation }] = modules;
  const owner = createUser("preview-owner", "test-password");
  const other = createUser("preview-other", "test-password");
  ownerId = owner.id;
  foreignOwnerId = other.id;
  token = authenticateUser("preview-owner", "test-password")!.token;
  foreignToken = authenticateUser("preview-other", "test-password")!.token;
  const chat = createChat("Preview source", undefined, owner.id);
  const now = new Date().toISOString();
  chat.archived = true;
  chat.workspaces = [
    {
      id: planId, type: "plan", name: "Launch plan",
      content: "# **Launch**\n\nKeep [docs](https://example.com) handy.\n\n- [x] Done\n- [ ] Pending\n\n" + "```md\n- [x] Example\n```",
      createdAt: now, updatedAt: now, version: 1,
    },
    { id: canvasId, type: "canvas", name: "C".repeat(500), content: "D".repeat(10_000), createdAt: now, updatedAt: now },
  ];
  saveChat(chat);
  noteId = createNote({
    ownerId: owner.id, chatId: chat.id, scope: "chat", title: "Project note", content: "N".repeat(10_000), icon: "lucide:rocket:#ef4444",
    todos: [{ id: "done", content: "Completed task", status: "completed" }, { id: "next", content: "Next task", status: "in_progress" }],
  }).id;
  const automationChat = createChat("Automation source", undefined, owner.id);
  automationId = createAutomation({
    ownerId: owner.id, chatId: automationChat.id, name: "Daily report", prompt: "P".repeat(10_000),
    schedule: { kind: "interval", everyMinutes: 1440 }, timezone: "Europe/Berlin",
  }).id;
});

after(() => {
  modules[4].getDatabase().close();
  rmSync(root, { recursive: true, force: true });
});

function request(kind: string | undefined, id: string | undefined, session = token, chatId?: string) {
  const params = new URLSearchParams();
  if (kind !== undefined) params.set("kind", kind);
  if (id !== undefined) params.set("id", id);
  if (chatId !== undefined) params.set("chatId", chatId);
  return new Request("http://localhost/api/internal-link-preview?" + params, {
    headers: session ? { cookie: "ai_chat_auth=" + session } : {},
  });
}

async function getPreview(kind: string, id: string, chatId?: string) {
  const response = await modules[5].GET(request(kind, id, token, chatId));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const data = await response.json() as InternalLinkPreview;
  assert.deepEqual(Object.keys(data).sort(), ["description", "details", ...(kind === "note" ? ["icon"] : []), "id", "kind", "title"].sort());
  assert.ok(data.title.length <= 200);
  assert.ok(data.description.length <= 600);
  assert.ok(data.details.length <= 5);
  for (const detail of data.details) {
    assert.deepEqual(Object.keys(detail).sort(), ["label", "value"]);
    assert.ok(detail.label.length <= 40);
    assert.ok(detail.value.length <= 200);
  }
  return data;
}

test("previews require a session and reject invalid targets before lookup", async () => {
  const { GET } = modules[5];
  const unauthorized = await GET(request("plan", planId, ""));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("Cache-Control"), "private, no-store");
  for (const [kind, id] of [
    [undefined, planId], ["plan", undefined], ["plan", ""], ["plan", "   "],
    ["file", "/root/private.txt"], ["unknown", planId], ["plan", "x".repeat(201)],
    ["note", "invalid/id"], ["note", "invalid\\id"], ["note", "invalid\u0000id"],
  ]) {
    assert.equal((await GET(request(kind, id))).status, 400, String(kind) + ":" + String(id));
  }
  for (const chatId of ["", "   ", "x".repeat(201), "invalid/id", "invalid\\id"]) {
    assert.equal((await GET(request("plan", planId, token, chatId))).status, 400);
  }
});

test("owned targets project bounded metadata with actual task progress", async () => {
  const plan = await getPreview("plan", planId);
  assert.equal(plan.title, "Launch plan");
  assert.match(plan.description, /Launch Keep docs handy/);
  assert.deepEqual(plan.details.find(item => item.label === "Tasks"), { label: "Tasks", value: "1/2 completed" });
  assert.deepEqual(plan.details.find(item => item.label === "Chat"), { label: "Chat", value: "Preview source" });
  const canvas = await getPreview("canvas", canvasId);
  assert.equal(canvas.title.length, 200);
  assert.equal(canvas.description.length, 600);
  const note = await getPreview("note", noteId);
  assert.equal(note.title, "Project note");
  assert.equal(note.icon, "lucide:rocket:#ef4444");
  assert.equal(note.description.length, 600);
  assert.deepEqual(note.details.find(item => item.label === "Tasks"), { label: "Tasks", value: "1/2 completed" });
  assert.deepEqual(note.details.find(item => item.label === "Scope"), { label: "Scope", value: "Chat" });
  const automation = await getPreview("automation", automationId);
  assert.equal(automation.description.length, 600);
  assert.deepEqual(automation.details.find(item => item.label === "Status"), { label: "Status", value: "Active" });
  assert.deepEqual(automation.details.find(item => item.label === "Schedule"), { label: "Schedule", value: "Every day" });
  assert.deepEqual(automation.details.find(item => item.label === "Timezone"), { label: "Timezone", value: "Europe/Berlin" });
});

test("icon projection is owner-scoped and contains no note content", async () => {
  const { GET } = modules[5];
  const iconRequest = (session: string) => {
    const req = request("note", noteId, session);
    return new Request(req.url + "&view=icon", { headers: req.headers });
  };
  const response = await GET(iconRequest(token));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { icon: "lucide:rocket:#ef4444" });
  assert.equal((await GET(iconRequest(foreignToken))).status, 404);
  assert.equal((await GET(iconRequest(""))).status, 401);
});

test("summaries read rich block text without leaking serialized envelopes or code", async () => {
  const { createNote } = modules[2];
  const fence = String.fromCharCode(96).repeat(3);
  const rich = { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "Readable callout" }] }] };
  const note = createNote({ ownerId, scope: "global", title: "Rich preview",
    content: ["Start", fence + "metis-block", JSON.stringify(rich), fence, fence + "json", '{"hidden":"technical-data"}', fence, "Finish"].join("\n\n") });
  const result = await getPreview("note", note.id);
  assert.equal(result.description, "Start Readable callout Finish");
  assert.doesNotMatch(result.description, /type|content|hidden|technical-data/);
});

test("foreign, missing and mismatched IDs all return the same unavailable response", async () => {
  const { GET } = modules[5];
  for (const [kind, id] of [["plan", planId], ["canvas", canvasId], ["note", noteId], ["automation", automationId]]) {
    const foreign = await GET(request(kind, id, foreignToken));
    const missing = await GET(request(kind, "missing"));
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
    assert.equal(foreign.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal((await GET(request("canvas", planId))).status, 404);
  assert.equal((await GET(request("plan", canvasId))).status, 404);
});

test("chat context disambiguates repeated workspace IDs and legacy canvases", async () => {
  const { createChat, saveChat } = modules[1];
  const { GET } = modules[5];
  const legacy = createChat("Legacy canvas chat", undefined, ownerId);
  legacy.canvas = "# Legacy content";
  legacy.workspaces = [];
  saveChat(legacy);
  assert.equal((await getPreview("canvas", "canvas-default")).description, "Legacy content");
  assert.equal((await getPreview("canvas", "canvas-default", legacy.id)).title, "Canvas");

  const now = new Date().toISOString();
  const first = createChat("First workspace chat", undefined, ownerId);
  const second = createChat("Second workspace chat", undefined, ownerId);
  for (const [chat, content] of [[first, "First"], [second, "Second"]] as const) {
    chat.workspaces = [
      { id: "canvas-default", type: "canvas", name: content + " canvas", content: content + " canvas content", createdAt: now, updatedAt: now },
      { id: "shared-plan", type: "plan", name: content + " plan", content: content + " plan content", createdAt: now, updatedAt: now },
    ];
    saveChat(chat);
    assert.equal((await getPreview("canvas", "canvas-default", chat.id)).description, content + " canvas content");
    assert.equal((await getPreview("plan", "shared-plan", chat.id)).description, content + " plan content");
  }
  assert.equal((await GET(request("canvas", "canvas-default"))).status, 404);
  assert.equal((await GET(request("plan", "shared-plan"))).status, 404);
  assert.equal((await getPreview("canvas", "canvas-default", legacy.id)).description, "Legacy content");

  const empty = createChat("No matching workspace", undefined, ownerId);
  const foreign = createChat("Private foreign chat", undefined, foreignOwnerId);
  foreign.canvas = "Foreign content must remain private";
  saveChat(foreign);
  for (const chatId of [empty.id, foreign.id, "missing-chat"]) {
    const response = await GET(request("canvas", "canvas-default", token, chatId));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Preview not found" });
  }
  assert.equal((await GET(request("canvas", "canvas-default", foreignToken, first.id))).status, 404);
  assert.equal((await GET(request("plan", planId, token, empty.id))).status, 404);

  // Match the app shell: any explicit workspace list takes precedence over chat.canvas.
  empty.canvas = "Shadowed legacy canvas";
  empty.workspaces = [{ id: "another-canvas", type: "canvas", name: "Explicit canvas", content: "Visible canvas", createdAt: now, updatedAt: now }];
  saveChat(empty);
  assert.equal((await GET(request("canvas", "canvas-default", token, empty.id))).status, 404);
});
