import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const installRoot = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
const envPath = join(installRoot, ".env");
const args = process.argv.slice(2);
const allowed = new Set(["--open", "--stop"]);
if (args.some((arg) => !allowed.has(arg))) {
  console.error("Usage: windows-script-host.mjs [--open|--stop]");
  process.exitCode = 2;
  process.exit();
}
const wantsOpen = args.includes("--open");
const wantsStop = args.includes("--stop");
let stopping = false;

function parseEnv(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/^\uFEFF/u, "").trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[line.slice(0, at).trim()] = value;
  }
  return result;
}
const config = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
for (const [key, value] of Object.entries(config)) process.env[key] = value;
process.env.NODE_ENV = "production";

const dataDir = resolve(config.CHAT_DATA_DIR || config.METIS_DATA_DIR || join(installRoot, "data"));
mkdirSync(dataDir, { recursive: true });
const paths = {
  lock: join(dataDir, ".windows-script-host.lock"),
  stop: join(dataDir, ".windows-script-host.stop"),
  hostLog: join(dataDir, "host.log"),
};
const token = randomBytes(24).toString("hex");

function log(line) {
  appendFileSync(paths.hostLog, new Date().toISOString() + " " + line + "\n");
}
function windowsHidden(options = {}) {
  return { windowsHide: true, stdio: options.stdio || "ignore", cwd: installRoot, ...options };
}
function runHidden(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { ...windowsHidden(options), encoding: "utf8", timeout: options.timeout });
}
function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const result = runHidden("tasklist.exe", ["/FI", "PID eq " + pid, "/FO", "CSV", "/NH"], { stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 && new RegExp('"[^"]+","\\s*' + pid + '","', "u").test(result.stdout || "");
}
function atomicWrite(file, value) {
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  writeFileSync(temp, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, file);
}
function readLock() {
  try { return JSON.parse(readFileSync(paths.lock, "utf8")); } catch { return null; }
}
function staleLock() {
  const current = readLock();
  if (!current) {
    try { return Date.now() - statSync(paths.lock).mtimeMs > 15000; } catch { return false; }
  }
  return !processExists(Number(current.pid));
}
function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(paths.lock, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, root: installRoot, token, heartbeat: Date.now() }) + "\n"); } finally { closeSync(fd); }
      return true;
    } catch (error) {
      if (error.code !== "EEXIST" || !staleLock()) return false;
      try { renameSync(paths.lock, paths.lock + ".stale." + Date.now()); } catch {}
    }
  }
  return false;
}
function releaseLock() {
  const current = readLock();
  if (current?.pid === process.pid && current.token === token) rmSync(paths.lock, { force: true });
}
function requestStop() {
  const current = readLock();
  if (!current || current.root !== installRoot || !processExists(Number(current.pid))) return;
  atomicWrite(paths.stop, JSON.stringify({ root: installRoot, pid: current.pid, token: current.token, requestedAt: Date.now() }) + "\n");
  for (let i = 0; i < 75; i += 1) {
    if (!existsSync(paths.lock)) return;
    const latest = readLock();
    if (!latest || latest.root !== installRoot) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error("Metis background host did not stop within 15 seconds.");
}
function removeOwnStop() { try { rmSync(paths.stop, { force: true }); } catch {} }
function appendChildLog(name, chunk) {
  if (chunk) appendFileSync(join(dataDir, name + ".log"), chunk);
}
function childCommand(name) {
  const node = config.METIS_NODE_BIN || "node.exe";
  if (!["app", "worker", "mcp"].includes(name)) throw new Error("Unsupported service role");
  return { command: node, args: [join(installRoot, "scripts", "run-installed-service.cjs"), name] };
}
function startChild(name) {
  const command = childCommand(name);
  const child = spawn(command.command, command.args, {
    cwd: installRoot, env: { ...process.env, NODE_ENV: "production" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => appendChildLog(name, chunk));
  child.stderr.on("data", (chunk) => appendChildLog(name, chunk));
  child.on("error", (error) => log(name + " spawn error: " + error.message));
  return child;
}
function stopChild(child, name) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  log("stopping " + name + " tree pid=" + child.pid);
  runHidden("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 10000 });
}
function healthyUrl() { return config.AI_CHAT_PUBLIC_URL || "http://127.0.0.1:" + (config.PORT || "3100"); }
async function isHealthy() {
  try {
    const response = await fetch("http://127.0.0.1:" + (config.PORT || "3100") + "/api/status", { signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    return response.ok && typeof status.authenticated === "boolean" && status.worker?.ok === true && status.mcp?.ok === true;
  } catch { return false; }
}
async function openBrowser() {
  const url = healthyUrl();
  for (let i = 0; i < 60; i += 1) {
    if (stopping) return;
    if (await isHealthy()) {
      runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        "Start-Process -FilePath '" + url.replaceAll("'", "''") + "'"], { timeout: 5000 });
      return;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
  }
  throw new Error("Metis did not become ready at " + url + ". Check " + dataDir + " for startup errors.");
}
function showError(error) {
  log(error.stack || String(error));
  if (!wantsOpen) return;
  const message = String(error.message || error).replaceAll("'", "''");
  runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" + message + "','Metis AI','OK','Error') | Out-Null"], { timeout: 10000 });
}
function dockerEnabled() { return config.METIS_DOCKER === "1" || config.METIS_DOCKER === "true"; }
function dockerStart() {
  const result = runHidden("docker.exe", ["compose", "--env-file", envPath, "up", "-d", "--remove-orphans"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  appendChildLog("host", result.stdout || "");
  appendChildLog("host", result.stderr || "");
  if (result.status !== 0) throw new Error("Docker Compose failed. Check host.log.");
  log("docker compose started; stop leaves the compose stack running.");
}

async function main() {
  if (wantsStop) { requestStop(); return; }
  if (!acquireLock()) {
    if (wantsOpen) await openBrowser();
    return;
  }
  removeOwnStop();
  const children = [];
  const docker = dockerEnabled();
  try {
    if (config.PORT && config.MCP_PORT && config.PORT === config.MCP_PORT) throw new Error("PORT and MCP_PORT must be different.");
    if (!docker) {
      for (const portName of ["PORT", "MCP_PORT"]) {
        const port = Number(config[portName] || (portName === "PORT" ? 3100 : 8787));
        const probe = runHidden("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
          "$l=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any," + port + "); try{$l.Start();$l.Stop();exit 0}catch{exit 1}"], { timeout: 5000 });
        if (probe.status !== 0) throw new Error("Port " + port + " (" + portName + ") is occupied or unavailable.");
      }
      for (const name of ["app", "worker", "mcp"]) children.push({ name, child: startChild(name) });
    } else dockerStart();
    let openPromise;
    if (wantsOpen) { openPromise = openBrowser().catch(showError); }
    while (true) {
      const stopRequest = readLock();
      let command = null;
      try { command = JSON.parse(readFileSync(paths.stop, "utf8")); } catch {}
      if (command && command.root === installRoot && command.token === token && stopRequest?.token === token) break;
      for (const entry of children) {
        if (entry.child.exitCode !== null) {
          log(entry.name + " exited code=" + entry.child.exitCode + "; restarting");
          entry.child = startChild(entry.name);
        }
      }
      atomicWrite(paths.lock, JSON.stringify({ pid: process.pid, root: installRoot, token, heartbeat: Date.now() }) + "\n");
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
    }

  } finally {
    stopping = true;
    for (const entry of children) stopChild(entry.child, entry.name);
    removeOwnStop();
    releaseLock();
  }
}
main().catch((error) => { showError(error); process.exitCode = 1; });
