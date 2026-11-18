import assert from "node:assert/strict";
import test from "node:test";
import { allModes, modeById } from "../lib/modes";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test("Deep Research is a distinct read-only mode; Agent stays the default", () => {
  const mode = modeById("deep-research");
  assert.equal(mode.name, "Deep Research");
  assert.equal(mode.icon, "telescope");
  assert.deepEqual(mode.allowedCategories, ["read", "browser", "plan"]);
  assert.equal(allModes()[0].id, "agent");
  assert.equal(modeById("nonexistent").id, "agent");
  assert.equal(allModes([{ ...mode, name: "duplicate" }]).filter(m => m.id === mode.id).length, 1);
});


test("research skill activates for mode or explicit request and respects disabling", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-research-skill-"));
  try {
    const skillPath = "skills/manual/deep-research/SKILL.md";
    mkdirSync(path.join(root, path.dirname(skillPath)), { recursive: true });
    writeFileSync(path.join(root, skillPath), "---\nname: deep-research\ndescription: Research fixture\n---\n# Research fixture\n");
    writeFileSync(path.join(root, "skills-lock.json"), JSON.stringify({
      version: 1, skills: { "deep-research": { source: "fixture", sourceType: "local", skillPath } },
    }));
    const script = [
      "import assert from 'node:assert/strict';",
      "import contextModule from './lib/skill-context.ts';",
      "const { buildSkillContext } = contextModule;",
      "const active = 'Deep Research skill is active for this task:';",
      "assert.ok(buildSkillContext('Vergleiche diese Optionen', undefined, { modeId: 'deep-research' }).includes(active));",
      "assert.ok(buildSkillContext('Nutze Deep Research für diese Frage').includes(active));",
      "assert.ok(!buildSkillContext('hello', undefined, { modeId: 'agent' }).includes(active));",
      "assert.ok(!buildSkillContext('hello', { enabledSkills: { 'deep-research': false } }, { modeId: 'deep-research' }).includes(active));",
      "console.log('ISOLATED_RESEARCH_SKILL_OK');",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root,
        CHAT_DATA_DIR: path.join(root, "data"), CHAT_DB_PATH: path.join(root, "data", "chat.sqlite"),
        AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"), METIS_AI_BOOTSTRAP_PASSWORD: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ISOLATED_RESEARCH_SKILL_OK/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
