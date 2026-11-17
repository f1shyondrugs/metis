import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { pruneManagedReleases, liveProcessReferences } from "../public/install/release-retention.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "metis-retention-"));
  const old = new Date(Date.now() - 3 * 86400000);
  const release = (name, complete = true) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    if (complete) fs.writeFileSync(path.join(dir, "managed.json"), "{}");
    fs.utimesSync(dir, old, old);
    return dir;
  };
  const active = release("1.0.20"), previous = release("1.0.19");
  const run = (options = {}) => pruneManagedReleases({
    root, active, previous, pattern: /^1[.]0[.][0-9]+$/,
    requiredFiles: ["managed.json"], references: [], ...options,
  });
  return { root, release, active, previous, run, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("twenty old releases converge to active plus rollback; repeat is idempotent", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 19; i++) f.release("1.0." + i);
    assert.equal(f.run().removed.length, 19);
    assert.deepEqual(fs.readdirSync(f.root).sort(), ["1.0.19", "1.0.20"]);
    assert.deepEqual(f.run().removed, []);
  } finally { f.close(); }
});

test("busy, recent, incomplete and unrelated directories survive", () => {
  const f = fixture();
  try {
    const busy = f.release("1.0.1");
    const recent = f.release("1.0.2");
    fs.utimesSync(recent, new Date(), new Date());
    f.release("1.0.3", false);
    f.release("my-notes");
    f.release("1.0.4");
    const result = f.run({ references: ["node " + busy + "/main.js"] });
    assert.deepEqual(result.removed, ["1.0.4"]);
    for (const name of ["1.0.1", "1.0.2", "1.0.3", "my-notes"]) assert.ok(fs.existsSync(path.join(f.root, name)));
  } finally { f.close(); }
});

test("unavailable process visibility fails closed", () => {
  const f = fixture();
  try {
    const obsolete = f.release("1.0.1");
    assert.match(f.run({ references: null }).reason, /visibility/);
    assert.ok(fs.existsSync(obsolete));
  } finally { f.close(); }
});

test("symlink candidates and out-of-root active/rollback paths are never deleted", () => {
  const f = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), "metis-retention-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "managed.json"), "{}");
    fs.symlinkSync(outside, path.join(f.root, "1.0.1"));
    const obsolete = f.release("1.0.2");
    assert.match(f.run({ previous: outside }).reason, /outside/);
    assert.ok(fs.existsSync(obsolete));
    f.run();
    assert.ok(fs.existsSync(path.join(outside, "managed.json")));
    assert.ok(fs.lstatSync(path.join(f.root, "1.0.1")).isSymbolicLink());
    assert.match(f.run({ active: outside }).reason, /invalid/);
  } finally { f.close(); fs.rmSync(outside, { recursive: true }); }
});

test("a real running release is preserved with complete or restricted process visibility", { skip: process.platform !== "linux" }, async () => {
  const f = fixture();
  const busy = f.release("1.0.1");
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setInterval(()=>{},1000)"], { cwd: busy, stdio: ["ignore", "pipe", "ignore"] });
  try {
    await once(child.stdout, "data");
    const references = liveProcessReferences();
    if(Array.isArray(references)){
      assert.ok(references.includes(busy));
      f.run({references});
    }else{
      assert.match(f.run({references}).reason,/visibility unavailable/);
    }
    assert.ok(fs.existsSync(busy));
  } finally { child.kill(); await once(child, "exit"); f.close(); }
});

test("ordinary Linux service users can inspect their processes without root ptrace access", { skip: process.platform !== "linux" || process.getuid() !== 0 || !fs.existsSync("/usr/sbin/runuser") || !fs.existsSync("/usr/bin/node") }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "metis-retention-user-"));
  try {
    fs.chmodSync(root, 0o755);
    const helper = path.join(root, "retention.mjs");
    fs.copyFileSync(new URL("../public/install/release-retention.mjs", import.meta.url), helper);
    fs.chmodSync(helper, 0o644);
    const result = spawnSync("/usr/sbin/runuser", ["-u", "nobody", "--", "/usr/bin/node", "--input-type=module", "-e",
      'import { liveProcessReferences } from ' + JSON.stringify(helper) + '; const refs=liveProcessReferences(); if(!Array.isArray(refs)||!refs.length)process.exit(1); console.log("UNPRIVILEGED_VISIBILITY_OK");'],
      { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /UNPRIVILEGED_VISIBILITY_OK/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("successful slot builds remove compiler cache, preserve runtime caches and rollback slot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "metis-build-retention-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    for (const file of ["build-production-slot.sh", "build-node-options.cjs"]) fs.copyFileSync(new URL("../scripts/" + file, import.meta.url), path.join(root, "scripts", file));
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    fs.mkdirSync(path.join(root, ".next-b"));
    fs.writeFileSync(path.join(root, ".next-b/BUILD_ID"), "active");
    const pnpm = path.join(root, "fake-pnpm");
    fs.writeFileSync(pnpm, '#!/bin/sh\nmkdir -p "$NEXT_DIST_DIR/cache/webpack" "$NEXT_DIST_DIR/cache/swc" "$NEXT_DIST_DIR/cache/images" "$NEXT_DIST_DIR/server"\necho cache > "$NEXT_DIST_DIR/cache/webpack/large"\necho cache > "$NEXT_DIST_DIR/cache/swc/large"\necho image > "$NEXT_DIST_DIR/cache/images/keep"\necho runtime > "$NEXT_DIST_DIR/server/keep"\necho new-build > "$NEXT_DIST_DIR/BUILD_ID"\n', { mode: 0o700 });
    for (const reuse of ["0", "1"]) {
      const result = spawnSync("bash", [path.join(root, "scripts/build-production-slot.sh"), ".next-a"], {
        env: { ...process.env, AI_CHAT_ROOT: root, PNPM_BIN: pnpm, METIS_REUSE_BUILD_CACHE: reuse }, encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(path.join(root, ".next-a/cache/webpack")), reuse === "1");
      assert.equal(fs.existsSync(path.join(root, ".next-a/cache/swc")), reuse === "1");
      assert.equal(fs.readFileSync(path.join(root, ".next-b/BUILD_ID"), "utf8"), "active");
      assert.ok(fs.existsSync(path.join(root, ".next-a/server/keep")));
      assert.ok(fs.existsSync(path.join(root, ".next-a/cache/images/keep")));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
