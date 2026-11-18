import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { buildSkillContext } from "../lib/skill-context";
import { isAlwaysOnSkill, listInstalledSkills, projectSkillSettings, skillsCatalogPrompt } from "../lib/skills";

test("Skill Creator content is injected on every turn and explicit overrides remain effective", () => {
  for (const message of ["Hello", "Continue the previous task", "Redesign the UI"]) {
    const prompt = buildSkillContext(message);
    assert.equal(prompt.split("Always-on skill skill-creator is active").length - 1, 1);
    assert.match(prompt, /# Skill Creator/);
    assert.match(prompt, /Metis integration/);
    assert.match(prompt, /## Autonomous learning from experience/);
    assert.match(prompt, /without waiting for an explicit/);
    assert.doesNotMatch(skillsCatalogPrompt(), /- skill-creator /);
  }
  assert.doesNotMatch(buildSkillContext("Hello", { enabledSkills: { "skill-creator": false } }), /Always-on skill skill-creator|# Skill Creator/);
  const switchedOff = buildSkillContext("Hello", { alwaysOnSkills: { "skill-creator": false } });
  assert.doesNotMatch(switchedOff, /Always-on skill skill-creator|# Skill Creator/);
  assert.match(switchedOff, /- skill-creator .*SKILL.md/);
  const projectSettings = projectSkillSettings(undefined, { disabledSkillIds: ["skill-creator"] });
  assert.doesNotMatch(buildSkillContext("Hello", projectSettings), /Always-on skill skill-creator|# Skill Creator/);
});

test("fresh installation injects the bundled Creator before the provider user turn without saved settings", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-fresh-skills-"));
  try {
    const record = listInstalledSkills().find(skill => skill.id === "skill-creator")!;
    mkdirSync(path.join(root, path.dirname(record.skillPath)), { recursive: true });
    writeFileSync(path.join(root, record.skillPath), readFileSync(path.resolve(record.skillPath)));
    writeFileSync(path.join(root, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": record } }));
    const script = [
      "import assert from 'node:assert/strict';",
      "import skillModule from './lib/skills.ts';",
      "import contextModule from './lib/skill-context.ts';",
      "import providerModule from './lib/providers/prompt-context.ts';",
      "import dbModule from './lib/db-store.ts';",
      "import sqlModule from './lib/sqlite.ts';",
      "sqlModule.getDatabase().prepare(\"INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)\").run('fresh-owner','fresh-owner','fixture-only',new Date().toISOString());",
      "const chat=dbModule.createChat('Fresh chat', undefined, 'fresh-owner');",
      "const prompt=providerModule.buildProviderPrompt({job:{chatId:chat.id,userId:'fresh-owner',message:'Hello',modeId:'agent',attachments:[]},toolNames:['read_file']});",
      "assert.equal(skillModule.skillEnabled('skill-creator'),true);",
      "assert.equal(skillModule.isAlwaysOnSkill('skill-creator'),true);",
      "assert.match(prompt,/Always-on skill skill-creator is active/);",
      "assert.match(prompt,/# Skill Creator/);",
      "assert.match(prompt,/## Autonomous learning from experience/);",
      "assert.match(prompt,/Do not persist learning from Incognito chats/);",
      "assert.equal(prompt.split('# Skill Creator').length-1,1);",
      "assert.match(contextModule.buildSkillContext('Continue'),/# Skill Creator/);",
      "console.log('FRESH_INSTALL_CREATOR_CONTEXT_OK');",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: path.join(root, "data"), CHAT_DB_PATH: path.join(root, "data", "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"), METIS_AI_BOOTSTRAP_PASSWORD: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FRESH_INSTALL_CREATOR_CONTEXT_OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("registered learned packages are discoverable on the next turn without becoming Always on", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-learned-skill-"));
  try {
    const folder = path.join(root, "skills/manual/tested-workflow");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "SKILL.md"), "---\nname: tested-workflow\ndescription: Reuse a verified fixture workflow.\n---\n\n# Tested workflow\nVerify the fixture result before recording success.\n");
    const registered = spawnSync("python3", [
      path.resolve("skills/bundled/skill-creator/scripts/register_skill.py"),
      folder, "--root", root,
    ], { encoding: "utf8" });
    assert.equal(registered.status, 0, registered.stderr);
    assert.match(registered.stdout, /Registered skill: tested-workflow/);
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { writeFileSync } from 'node:fs';
      import skillModule from './lib/skills.ts';
      import contextModule from './lib/skill-context.ts';
      const first = contextModule.buildSkillContext('Hello');
      assert.match(first, /tested-workflow .*SKILL.md/);
      assert.doesNotMatch(first, /Always-on skill tested-workflow/);
      assert.equal(skillModule.isAlwaysOnSkill('tested-workflow'), false);
      writeFileSync(${JSON.stringify(path.join(folder, "SKILL.md"))}, '# Updated verified procedure');
      assert.equal(skillModule.readSkillMarkdown('tested-workflow'), '# Updated verified procedure');
      assert.doesNotMatch(contextModule.buildSkillContext('Hello', {enabledSkills:{'tested-workflow':false}}), /tested-workflow/);
      console.log('LEARNED_SKILL_NEXT_TURN_OK');
    `], { cwd: process.cwd(), env: { ...process.env, AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: path.join(root, "data"), CHAT_DB_PATH: path.join(root, "data/chat.sqlite") }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LEARNED_SKILL_NEXT_TURN_OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Metis development guidance is registered and matching by default", () => {
  const record = listInstalledSkills().find(skill => skill.id === "metis-development");
  assert.ok(record);
  assert.equal(isAlwaysOnSkill(record.id), false);
  assert.match(skillsCatalogPrompt(), /metis-development/);
  const content = readFileSync(path.resolve(record.skillPath), "utf8");
  assert.match(content, /references\/code-map.md/);
  assert.match(content, /preserve contracts/i);
});
