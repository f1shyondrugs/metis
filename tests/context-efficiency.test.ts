import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { selectProjectContextFacts } from "../lib/context-layers";
import type { AgentJob } from "../lib/jobs";
import type { ProviderContext } from "../lib/providers/adapters/provider-support";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-context-efficiency-"));
Object.assign(process.env, { AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "test.sqlite"), METIS_AI_BOOTSTRAP_PASSWORD: "" });
after(() => rmSync(root, { recursive: true, force: true }));
const modules = Promise.all([
  import("../lib/auth"), import("../lib/db-store"), import("../lib/projects"),
  import("../lib/providers/prompt-context"), import("../lib/providers/adapters/provider-support"),
]);

test("project context selects whole relevant facts within budget without changing stored memory", () => {
  const facts = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), content: index === 0 ? "quartz rendering convention" : "unrelated " + "x".repeat(900),
    updatedAt: new Date(index * 1000).toISOString(),
  }));
  const before = structuredClone(facts);
  assert.deepEqual(selectProjectContextFacts("quartz", facts).map(f => f.id), ["0"]);
  const fallback = selectProjectContextFacts("weiter", facts);
  assert.deepEqual(fallback.map(f => f.id), ["99", "98"]);
  assert.deepEqual(selectProjectContextFacts("quartz", facts, 5), []);
  assert.deepEqual(facts, before);
});

test("native policy stays stable while task context, project selection and explicit references refresh", async () => {
  const [auth, store, projects, prompts, support] = await modules;
  const owner = auth.createUser("efficiency-owner", "fixture-password").id;
  const project = projects.createProject({ ownerId: owner, name: "Fixture", instructions: "Preserve all capabilities." });
  for (let index = 0; index < 60; index++) projects.createProjectMemory(project.id, index === 0 ? "quartz rendering convention" : "Unrelated saxophone " + "x".repeat(900), [], owner);
  const chat = store.createChat("Context fixture", undefined, owner);
  store.updateChat(chat.id, { projectId: project.id }, owner);
  const job = { id: "fixture", chatId: chat.id, userId: owner, message: "quartz", referenceText: "EXPLICIT_MARKER", status: "running", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as AgentJob;
  const before = projects.getProject(project.id, owner)!;
  const first = prompts.buildProviderPromptParts({ job, toolNames: ["metis_ai"], nativeTools: true });
  assert.match(first.instructions, /Current agent mode: Agent/);
  assert.doesNotMatch(first.instructions, /EXPLICIT_MARKER|quartz rendering convention/);
  assert.match(first.context, /quartz rendering convention/);
  assert.doesNotMatch(first.context, /Unrelated saxophone/);
  assert.match(first.context, /Preserve all capabilities/);
  assert.equal(first.context.split("EXPLICIT_MARKER").length - 1, 1);
  assert.equal(support.providerCurrentTurnPrompt({ job } as ProviderContext), "quartz");
  store.updateChat(chat.id, { title: "Renamed context fixture" }, owner);
  const next = prompts.buildProviderPromptParts({ job: { ...job, message: "saxophone", referenceText: "NEW_MARKER" }, toolNames: ["metis_ai"], nativeTools: true });
  assert.equal(next.instructions, first.instructions);
  assert.match(next.context, /Unrelated saxophone|NEW_MARKER/);
  assert.ok(next.context.length < 18_000, String(next.context.length));
  assert.deepEqual(projects.getProject(project.id, owner)!.memories, before.memories);
  const ask = prompts.buildProviderPromptParts({ job: { ...job, modeId: "ask" } });
  assert.match(ask.instructions, /Current agent mode: Ask/);
  const attachment = { id: "fixture-attachment", name: "ATTACHMENT_MARKER.png", storedName: "fixture.png", kind: "image" as const, mimeType: "image/png", size: 10 };
  const attached = prompts.buildProviderPromptParts({ job: { ...job, referenceText: "x".repeat(100_000), attachments: [attachment] } });
  assert.equal(attached.context.split("ATTACHMENT_MARKER.png").length - 1, 1);
  const privateTurn = prompts.buildProviderPromptParts({ job: { ...job, incognito: true } });
  assert.doesNotMatch(privateTurn.context, /quartz rendering convention|Preserve all capabilities/);
  console.log("CONTEXT_EFFICIENCY", JSON.stringify({ storedFacts: before.memories.length, selectedContextChars: first.context.length, broadContextChars: next.context.length }));
});
