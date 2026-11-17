import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "sync-provider-clis.mjs");

test("CLI sync installs latest Codex and preserves a pinned version", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "metis-cli-sync-"));
  const bin = path.join(temp, "bin");
  const data = path.join(temp, "data");
  mkdirSync(bin);
  const npm = path.join(bin, "npm");
  writeFileSync(npm, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const version = process.env.MOCK_CLI_VERSION;
if (args[0] === "view") { console.log(version); process.exit(0); }
if (args[0] !== "install") process.exit(2);
const prefix = args[args.indexOf("--prefix") + 1];
const packageName = args.at(-1).split("@").slice(0, -1).join("@");
const selected = args.at(-1).split("@").at(-1);
const packageDir = path.join(prefix, "node_modules", ...packageName.split("/"));
const binaryDir = path.join(prefix, "node_modules", ".bin");
fs.mkdirSync(packageDir, { recursive: true });
fs.mkdirSync(binaryDir, { recursive: true });
fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: selected }));
const binary = path.join(binaryDir, "codex");
fs.writeFileSync(binary, "#!/usr/bin/env node\\nconsole.log('codex-cli " + selected + "')\\n", { mode: 0o755 });
`);
  chmodSync(npm, 0o755);
  const which = path.join(bin, "which");
  writeFileSync(which, "#!/bin/sh\nexit 1\n");
  chmodSync(which, 0o755);
  const run = (version: string) => execFileSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CHAT_DATA_DIR: data, MOCK_CLI_VERSION: version },
    encoding: "utf8",
  });
  try {
    assert.ok(run("0.156.1").includes("codex: 0.156.1"));
    const manifestPath = path.join(data, "agent-runtimes", "codex", "active.json");
    const initial = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(initial.tracking, "latest");
    assert.equal(initial.version, "0.156.1");

    const cliRoot = path.dirname(manifestPath);
    for (let i = 0; i < 20; i++) {
      const version = path.join(cliRoot, "0.155." + i);
      mkdirSync(path.join(version, "node_modules/@openai/codex"), { recursive: true });
      writeFileSync(path.join(version, "node_modules/@openai/codex/package.json"), JSON.stringify({ version: "0.155." + i }));
      const old = new Date(Date.now() - 3 * 86400000);
      utimesSync(version, old, old);
    }
    assert.ok(run("0.156.2").includes("obsolete CLI versions"));
    const upgraded = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(upgraded.previousVersion, "0.156.1");
    assert.ok(existsSync(path.join(cliRoot, "0.156.1")), "rollback retained");
    assert.ok(!existsSync(path.join(cliRoot, "0.155.0")), "old managed CLI removed");
    assert.ok(!existsSync(path.join(cliRoot, ".sync.lock")));

    writeFileSync(manifestPath, JSON.stringify({ ...initial, tracking: "pinned" }));
    assert.ok(run("0.999.0").includes("codex: 0.156.1 (pinned)"));
    const pinned = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(pinned.version, "0.156.1");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
