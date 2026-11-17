#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { pruneManagedReleases } from "../public/install/release-retention.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = process.env.CHAT_DATA_DIR || path.join(process.cwd(), "data");
const runtimes = path.join(dataDir, "agent-runtimes");
const packages = {
  codex: { name: "@openai/codex", binary: "codex" },
  grok: { name: "@xai-official/grok", binary: "grok" },
  opencode: { name: "opencode-ai", binary: "opencode" },
};
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

function run(command, args, options = {}) {
  if (process.platform === "win32" && command === "npm") {
    command = process.execPath;
    args = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args];
  }
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000, ...options }).trim();
}

export function readCliVersion(executable) {
  // Pass CMD its required outer quote pair verbatim; Node otherwise escapes it
  // using executable argument rules, which do not apply to CMD command strings.
  return process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", `""${executable}" --version"`], { windowsVerbatimArguments: true, windowsHide: true })
    : run(executable, ["--version"]);
}

function manifestFor(id) {
  const file = path.join(runtimes, id, "active.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Invalid ${id} CLI manifest: ${file}`);
  }
}

function syncManaged(id) {
  if (id !== "codex" && !manifestFor(id)) return;
  const root = path.join(runtimes, id);
  mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".sync.lock");
  mkdirSync(lock); // Never race another installer or remove its live staging version.
  try { syncManagedLocked(id); }
  finally { rmSync(lock, { recursive: true }); }
}

function syncManagedLocked(id) {
  const item = packages[id];
  const previous = manifestFor(id);
  if (id !== "codex" && !previous) return;
  const pinned = previous?.tracking === "pinned";
  const version = pinned ? previous.version : run("npm", ["view", `${item.name}@latest`, "version"]);
  if (!versionPattern.test(version)) throw new Error(`Invalid ${id} CLI version: ${version}`);
  const root = path.join(runtimes, id);
  const destination = path.join(root, version);
  const executable = path.join(destination, "node_modules", ".bin", process.platform === "win32" ? `${item.binary}.cmd` : item.binary);
  const packageFile = path.join(destination, "node_modules", ...item.name.split("/"), "package.json");
  let valid = false;
  try {
    valid = JSON.parse(readFileSync(packageFile, "utf8")).version === version && existsSync(executable);
  } catch {
    // Install a missing or incomplete version.
  }
  if (!valid) {
    mkdirSync(destination, { recursive: true });
    run("npm", ["install", "--prefix", destination, "--no-save", "--no-audit", "--no-fund", `${item.name}@${version}`]);
  }
  const reported = readCliVersion(executable);
  if (!reported.includes(version)) throw new Error(`${id} CLI version check failed: ${reported}`);
  mkdirSync(root, { recursive: true });
  const file = path.join(root, "active.json");
  const temporary = `${file}.${process.pid}.tmp`;
  const previousVersion = previous?.version !== version ? previous?.version : previous?.previousVersion;
  writeFileSync(temporary, JSON.stringify({ version, executable, tracking: pinned ? "pinned" : "latest", ...(previousVersion && versionPattern.test(previousVersion) ? { previousVersion } : {}) }), { mode: 0o600 });
  renameSync(temporary, file);
  try {
    const cleanup = pruneManagedReleases({
      root, active: destination,
      previous: previousVersion && versionPattern.test(previousVersion) ? path.join(root, previousVersion) : undefined,
      pattern: versionPattern,
      requiredFiles: [path.join("node_modules", ...item.name.split("/"), "package.json")],
    });
    console.log(`${id}: removed ${cleanup.removed.length} obsolete CLI versions${cleanup.reason ? " (cleanup deferred: " + cleanup.reason + ")" : ""}`);
  } catch (error) {
    console.warn(`${id}: cleanup deferred: ${error.message}`);
  }
  console.log(`${id}: ${version}${pinned ? " (pinned)" : ""}`);
}

function updateIfInstalled(binary) {
  try {
    run(process.platform === "win32" ? "where.exe" : "which", [binary]);
  } catch {
    return;
  }
  try {
    run(binary, ["update"], process.platform === "win32" ? { shell: true } : {});
    console.log(`${binary}: updated`);
  } catch (error) {
    console.warn(`${binary}: update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const id of Object.keys(packages)) syncManaged(id);
  updateIfInstalled("cursor-agent");
  updateIfInstalled("agy");
}
