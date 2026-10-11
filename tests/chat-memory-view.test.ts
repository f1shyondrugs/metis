import assert from "node:assert/strict";
import test, {before, after} from "node:test";
import {mkdtempSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-memory-view-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "test.sqlite");
process.env.AI_CHAT_ROOT = dir;
async function setup() {
 return Promise.all([
  import("../lib/auth"), import("../lib/db-store"), import("../lib/projects"),
  import("../lib/chat-memory-actions"), import("../lib/chat-memory-view"),
  import("../lib/providers/prompt-context"), import("../app/api/chats/[id]/memories/route"),
 ]);
}
let modules: Awaited<ReturnType<typeof setup>>;
before(async () => {modules = await setup();});
after(() => rmSync(dir, {recursive: true, force: true}));

test("agent memory is private to each agent chat with shared project and owned global context", () => {
 const [auth, store, projects, actions, views, prompts] = modules;
 const owner = auth.createUser("memory-view-owner", "test-password").id;
 const outsider = auth.createUser("memory-view-outsider", "test-password").id;
 const project = projects.createProject({name: "Agent project", mode: "agents", ownerId: owner});
 const agent = store.createChat("Engineer", undefined, owner, undefined, {projectId: project.id});
 const sibling = store.createChat("Planner", undefined, owner, undefined, {projectId: project.id});
 actions.chatMemoryAction(owner, agent.id, "add", {content: "Engineer private decision"});
 actions.chatMemoryAction(owner, sibling.id, "add", {content: "Planner private decision"});
 projects.createProjectMemory(project.id, "Shared project convention", ["convention"], owner);
 store.createMemory("Owned account preference", ["preference"], owner);
 store.createMemory("Other account secret", [], outsider);
 const view = views.loadChatMemoryView(agent.id, owner)!;
 assert.equal(view.label, "Agent Memory");
 assert.deepEqual(view.groups.map(group => group.scope), ["chat", "project", "global"]);
 assert.deepEqual(view.groups[0].memories.map(memory => memory.content), ["Engineer private decision"]);
 assert.equal(view.groups[1].memories[0].content, "Shared project convention");
 assert.equal(view.groups[2].memories[0].content, "Owned account preference");
 assert.doesNotMatch(JSON.stringify(view), /Planner private|Other account secret|passwordHash|ownerId/);
 assert.equal(views.loadChatMemoryView(agent.id, outsider), null);
 assert.equal(views.loadChatMemoryView(agent.id, ""), null);
 const prompt = prompts.buildProviderPrompt({job: {
  id: "job", chatId: agent.id, userId: owner, message: "continue", status: "running",
  attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
 }});
 assert.match(prompt, /Agent working memory/);
 assert.match(prompt, /scope chat/);
 assert.doesNotMatch(prompt, /Chat working memory|Planner private decision/);
 projects.updateProject(project.id, {memoryMode: "project_only"}, owner);
 const isolated = views.loadChatMemoryView(agent.id, owner)!;
 assert.equal(isolated.groups[2].enabled, false);
 assert.deepEqual(isolated.groups[2].memories, []);
});

test("ordinary chats retain Chat Memory and Incognito exposes no durable memory", () => {
 const [auth, store, , actions, views] = modules;
 const owner = auth.createUser("memory-view-ordinary", "test-password").id;
 const chat = store.createChat("Ordinary", undefined, owner);
 actions.chatMemoryAction(owner, chat.id, "add", {content: "Current chat decision"});
 const view = views.loadChatMemoryView(chat.id, owner)!;
 assert.equal(view.label, "Chat Memory");
 assert.deepEqual(view.groups.map(group => group.scope), ["chat", "global"]);
 const memoryId = view.groups[0].memories[0].id;
 actions.chatMemoryAction(owner, chat.id, "delete", {id: memoryId});
 assert.deepEqual(views.loadChatMemoryView(chat.id, owner)!.groups[0].memories, []);
 store.createMemory("Account context", [], owner);
 const incognito = store.createChat("Private", undefined, owner, undefined, {incognito: true});
 assert.deepEqual(views.loadChatMemoryView(incognito.id, owner), {
  chatId: incognito.id, label: "Chat Memory", incognito: true, groups: [],
 });
});

test("memory endpoint requires an owned authenticated chat and never caches its response", async () => {
 const [auth, store, , , , , route] = modules;
 const owner = auth.createUser("memory-view-endpoint", "test-password");
 const outsider = auth.createUser("memory-view-endpoint-other", "test-password");
 const chat = store.createChat("Endpoint", undefined, owner.id);
 const params = {params: Promise.resolve({id: chat.id})};
 const url = "http://localhost/api/chats/" + chat.id + "/memories";
 assert.equal((await route.GET(new Request(url), params)).status, 401);
 const otherSession = auth.authenticateUser(outsider.username, "test-password")!;
 assert.equal((await route.GET(new Request(url, {
  headers: {cookie: "ai_chat_auth=" + otherSession.token},
 }), params)).status, 404);
 const session = auth.authenticateUser(owner.username, "test-password")!;
 const response = await route.GET(new Request(url, {
  headers: {cookie: "ai_chat_auth=" + session.token},
 }), params);
 assert.equal(response.status, 200);
 assert.equal(response.headers.get("Cache-Control"), "no-store");
 assert.equal((await response.json()).chatId, chat.id);
});
