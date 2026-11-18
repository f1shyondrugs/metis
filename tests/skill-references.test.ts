import assert from "node:assert/strict";
import test, { after } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReferenceResult } from "../lib/reference-search";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-skill-reference-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: process.cwd(), CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, CHAT_LEGACY_HEADER_AUTH: "false", AI_CHAT_SKILL_ROOT: path.join(root, "installed"),
});
after(() => rmSync(root, { recursive: true, force: true }));

test("authenticated search and both resolution paths use the owner and current project, never submitted skill payloads", async () => {
  const [auth, store, projects, personal, api, context, scoped, prompt, skillContext] = await Promise.all([
    import("../lib/auth"), import("../lib/db-store"), import("../lib/projects"), import("../lib/personal-skills"),
    import("../app/api/references/route"), import("../lib/context"), import("../lib/context-scope"),
    import("../lib/providers/prompt-context"), import("../lib/skill-context"),
  ]);
  const account = (name: string) => {
    const password = "synthetic-test-only";
    const id = auth.createUser(name, password).id;
    return { id, token: auth.authenticateUser(name, password)!.token };
  };
  const owner = account("skill-reference-owner");
  const outsider = account("skill-reference-outsider");
  const skill = (ownerId: string, id: string, name: string) => personal.addPersonalSkill(ownerId, id, [{
    path: "SKILL.md", encoding: "utf8",
    content: "---\nname: " + name + "\ndescription: Synthetic palette fixture\n---\n\nOWNER_INSTRUCTIONS_NOT_SEARCH_METADATA",
  }]);
  const installed = skill(owner.id, "picker-skill", "Picker Skill");
  assert.ok(installed.skillPath.startsWith(path.join(root, "installed", "skills", "personal") + path.sep));
  assert.equal(existsSync(path.join(root, "skills")), false);
  const { listSkillFiles } = await import("../lib/skill-files");
  assert.deepEqual(listSkillFiles("picker-skill", { skillOwnerId: owner.id }).map(file => file.path), ["SKILL.md"]);
  assert.throws(() => listSkillFiles("picker-skill", { skillOwnerId: outsider.id }), /Skill not found/);
  skill(owner.id, "deep-research", "Deep Research");
  skill(outsider.id, "foreign-skill", "Foreign Skill");
  const project = projects.createProject({ name: "Scoped fixture", ownerId: owner.id });
  const chat = store.createChat("Fixture", undefined, owner.id);
  chat.projectId = project.id;
  store.saveChat(chat);
  const lookup = async (token: string, query: string, chatId = "", projectId = "") => {
    const response = await api.GET(new Request("http://fixture/api/references?" + new URLSearchParams({ kind: "skill", q: query, chatId, projectId }),
      { headers: token ? { cookie: "ai_chat_auth=" + token } : {} }));
    if (!token) { assert.equal(response.status, 401); return []; }
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    return (await response.json()).results as ReferenceResult[];
  };
  const result = await lookup(owner.token, "picker", chat.id);
  assert.deepEqual(result, [{ kind: "skill", id: "picker-skill", label: "Picker Skill", detail: "Synthetic palette fixture" }]);
  assert.deepEqual(await lookup(owner.token, "foreign"), []);
  assert.deepEqual(await lookup(owner.token, "deep-research"), []);
  assert.deepEqual(await lookup(outsider.token, "", chat.id), []);
  assert.deepEqual(await lookup(outsider.token, "", "", project.id), []);
  await lookup("", "");

  const submitted = [{ kind: "skill" as const, id: "picker-skill", label: "FORGED", path: "/fake/path", content: "FORGED", source: "explicit" as const }];
  assert.deepEqual(context.resolveReferences(owner.id, chat.id, submitted), [{ ...result[0], source: "explicit" }]);
  assert.deepEqual(scoped.resolveScopeReferences(owner.id, chat.id, submitted), [{ ...result[0], source: "explicit" }]);
  const stamp = new Date().toISOString();
  const job = {
    id: "skill-reference-fixture", status: "running", attempts: 1, createdAt: stamp, updatedAt: stamp,
    chatId: chat.id, userId: owner.id, modeId: "agent", message: "Work", references: submitted,
  } satisfies Parameters<typeof prompt.buildProviderPrompt>[0]["job"];
  const used = prompt.buildProviderPrompt({ job });
  assert.match(used, /explicitly selected these skills/);
  assert.doesNotMatch(used, /FORGED|OWNER_INSTRUCTIONS_NOT_SEARCH_METADATA/);
  assert.doesNotMatch(prompt.buildProviderPrompt({ job: { ...job, references: [], message: "Work @Picker Skill" } }), /explicitly selected these skills/);
  assert.doesNotMatch(skillContext.buildSkillContext("Work", store.getGlobalModelSettings(outsider.id),
    { explicitSkillIds: ["picker-skill"] }), /explicitly selected these skills|picker-skill/);

  projects.updateProject(project.id, { disabledSkillIds: ["picker-skill"] }, owner.id);
  assert.deepEqual(await lookup(owner.token, "picker", chat.id), []);
  assert.deepEqual(await lookup(owner.token, "picker", "", project.id), []);
  assert.deepEqual(context.resolveReferences(owner.id, chat.id, submitted), []);
  assert.deepEqual(scoped.resolveScopeReferences(owner.id, chat.id, submitted, true), []);
  assert.doesNotMatch(prompt.buildProviderPrompt({ job }), /explicitly selected these skills|picker-skill/);
  store.saveGlobalModelSettings({ enabledSkills: { "picker-skill": false } }, owner.id);
  assert.deepEqual(await lookup(owner.token, "picker"), []);
});
