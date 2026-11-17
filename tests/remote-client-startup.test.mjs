import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { WebSocketServer } from "ws";

const root = fileURLToPath(new URL("../", import.meta.url));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, milliseconds = 8_000) {
  const deadline = Date.now() + milliseconds;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the test client");
    await delay(20);
  }
}

async function connectedClient(modulePath, allowAuthentication = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "metis-client-startup-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const sockets = [];
  const responses = [];
  const events = [];
  let authCount = 0;
  server.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "auth") {
        authCount++;
        if (allowAuthentication) socket.send(JSON.stringify({ type: "authenticated", clientId: "test-client" }));
      }
      if (message.type === "heartbeat") socket.send(JSON.stringify({ type: "heartbeat_ack" }));
      if (message.type === "response") responses.push({ connection: sockets.indexOf(socket), message });
    });
  });
  const { startRemoteClient } = await import(pathToFileURL(path.join(root, modulePath)));
  const client = startRemoteClient({
    configPath: path.join(directory, "config.json"),
    config: { server: "http://127.0.0.1:" + server.address().port, clientId: "test-client", credential: "test-credential" },
    onEvent: (event) => events.push(event),
  });
  await waitFor(() => authCount === 1 && (!allowAuthentication || events.some((event) => event.status === "online")));
  return {
    directory, sockets, responses, events,
    async close() {
      client.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const modulePath of ["remote-client/client.mjs", "public/install/remote-client.mjs"]) {
  test(modulePath + " preserves authentication and file/info actions", async () => {
    const fixture = await connectedClient(modulePath);
    try {
      const request = (requestId, action, params = {}) =>
        fixture.sockets[0].send(JSON.stringify({ type: "request", requestId, action, params }));
      const file = path.join(fixture.directory, "sample.txt");
      request("write", "write_file", { path: file, content: "remote startup regression" });
      await waitFor(() => fixture.responses.length === 1);
      request("read", "read_file", { path: file });
      request("info", "get_info");
      await waitFor(() => fixture.responses.length === 3);
      assert.equal(fixture.responses.find(({ message }) => message.requestId === "read").message.result.content, "remote startup regression");
      assert.ok(fixture.responses.find(({ message }) => message.requestId === "info").message.result.hostname);
    } finally {
      await fixture.close();
    }
  });

  test(modulePath + " validates batches and dry runs before writing", async () => {
    const fixture = await connectedClient(modulePath);
    try {
      const file = path.join(fixture.directory, "edit.txt");
      fs.writeFileSync(file, "one one\ntwo");
      async function edit(requestId, params) {
        fixture.sockets[0].send(JSON.stringify({ type: "request", requestId, action: "edit_file_batch", params:{path:file,...params} }));
        await waitFor(() => fixture.responses.some(({message})=>message.requestId===requestId));
        return fixture.responses.find(({message})=>message.requestId===requestId).message;
      }
      const dry=await edit("dry",{edits:[{oldText:"one",newText:"first",replaceAll:true},{oldText:"two",newText:"second"}],dryRun:true});
      assert.equal(dry.ok,true);assert.equal(dry.result.replacements,3);
      assert.equal(fs.readFileSync(file,"utf8"),"one one\ntwo");
      const bad=await edit("bad",{edits:[{oldText:"two",newText:"second"},{oldText:"absent",newText:"x"}]});
      assert.equal(bad.ok,false);assert.match(bad.error,/Edit 2:/);
      assert.equal(fs.readFileSync(file,"utf8"),"one one\ntwo");
      const result=await edit("apply",{edits:[{oldText:"one",newText:"first",replaceAll:true,expectedOccurrences:2},{oldText:"two",newText:"second"}]});
      assert.equal(result.ok,true);assert.equal(result.result.changed,true);
      assert.equal(fs.readFileSync(file,"utf8"),"first first\nsecond");
    } finally { await fixture.close(); }
  });

  test(modulePath + " ignores requests before authentication", async () => {
    const fixture = await connectedClient(modulePath, false);
    try {
      const file = path.join(fixture.directory, "must-not-exist.txt");
      fixture.sockets[0].send(JSON.stringify({
        type: "request", requestId: "unauthenticated", action: "write_file",
        params: { path: file, content: "must not execute" },
      }));
      await delay(100);
      assert.equal(fs.existsSync(file), false);
      assert.equal(fixture.responses.length, 0);
    } finally {
      await fixture.close();
    }
  });

  for (const failed of [false, true]) {
    test(modulePath + " keeps late " + (failed ? "errors" : "results") + " off the replacement connection", async () => {
      const fixture = await connectedClient(modulePath);
      try {
        fixture.sockets[0].send(JSON.stringify({
          type: "request", requestId: "old-request", action: "execute_command",
          params: { command: 'node -e "setTimeout(()=>process.exit(' + (failed ? 7 : 0) + '),2000)"', cwd: fixture.directory },
        }));
        await waitFor(() => fixture.events.some((event) => event.type === "command" && event.status === "running"));
        fixture.sockets[0].terminate();
        await waitFor(() => fixture.sockets.length === 2 && fixture.events.filter((event) => event.status === "online").length === 2);
        await waitFor(() => fixture.events.some((event) => event.type === "command" && event.status === (failed ? "error" : "completed")));
        assert.equal(fixture.responses.some(({ message }) => message.requestId === "old-request"), false);
        fixture.sockets[1].send(JSON.stringify({ type: "request", requestId: "current-request", action: "get_info" }));
        await waitFor(() => fixture.responses.some(({ message }) => message.requestId === "current-request"));
        assert.equal(fixture.responses.find(({ message }) => message.requestId === "current-request").connection, 1);
      } finally {
        await fixture.close();
      }
    });
  }
}

function executablePath(name) {
  return execFileSync("/bin/sh", ["-c", "command -v " + name], { encoding: "utf8" }).trim();
}

async function runInstaller(platform, mode, systemd = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "metis-installer-startup-"));
  const install = path.join(directory, "client directory");
  const bin = path.join(directory, "bin");
  const testHome = path.join(directory, "home");
  for (const file of [install, bin, testHome]) fs.mkdirSync(file);
  const executable = (name, lines) => fs.writeFileSync(path.join(bin, name), lines.join("\n") + "\n", { mode: 0o755 });
  for (const name of ["bash", "mkdir", "rmdir", "chmod", "nohup", "grep", "awk", "tail", "id", "cat", "mktemp", "mv", "tar", "gzip", "rm", "cksum", "sha256sum", "shasum", "readlink", "ln"]) {
    fs.symlinkSync(executablePath(name), path.join(bin, name));
  }
  executable("uname", ["#!/bin/sh", "if [ \"$1\" = -s ]; then echo " + (platform === "macos" ? "Darwin" : "Linux") + "; else echo x86_64; fi"]);
  executable("xcrun", ["#!/bin/sh", "exit 1"]);
  const nodeArchiveName = "node-v22.99.0-" + (platform === "macos" ? "darwin" : "linux") + "-x64.tar.gz";
  const nodeArchiveRoot = path.join(directory, nodeArchiveName.replace(".tar.gz", ""));
  fs.mkdirSync(path.join(nodeArchiveRoot, "bin"), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(nodeArchiveRoot, "bin", "node"));
  fs.symlinkSync(path.join(bin, "npm"), path.join(nodeArchiveRoot, "bin", "npm"));
  execFileSync(executablePath("tar"), ["-czf", path.join(directory, nodeArchiveName), "-C", directory, path.basename(nodeArchiveRoot)]);
  const { createHash } = await import("node:crypto");
  fs.writeFileSync(path.join(directory, "SHASUMS256.txt"), createHash("sha256").update(fs.readFileSync(path.join(directory, nodeArchiveName))).digest("hex") + "  " + nodeArchiveName + "\n");
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  // Shorten the polling interval; retain all 15 attempts and real client I/O.
  executable("sleep", ["#!/bin/sh", "exec " + executablePath("sleep") + " 0.2"]);

  // Enrollment and WebSockets are real. Download the checked-out scripts;
  // replace npm and service management so no host service can be changed.
  executable("npm", [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "if (!fs.existsSync('node_modules')) fs.symlinkSync(process.env.TEST_MODULES_DIR, 'node_modules', 'dir');",
  ]);
  executable("curl", [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const output = args.indexOf('-o');",
    "if (output >= 0) {",
    "  const file = args.find(value => value.startsWith('http')).split('/').pop();",
    "  const source = file === 'SHASUMS256.txt' || file.endsWith('.tar.gz') ? process.env.TEST_FIXTURE_DIR + '/' + file : process.env.TEST_REPO_ROOT + '/public/install/' + file;",
    "  fs.copyFileSync(source, args[output + 1]);",
    "} else {",
    "  fetch(args[args.indexOf('POST') + 1], { method: 'POST' }).then(async response => {",
    "    if (!response.ok) process.exitCode = 1;",
    "    else process.stdout.write(await response.text());",
    "  }).catch(() => { process.exitCode = 1; });",
    "}",
  ]);
  const serviceShim = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const dir = process.env.TEST_INSTALL_DIR;",
    "const command = process.argv.slice(2).find(value => !value.startsWith('--'));",
    "const pidFile = dir + '/test-service.pid';",
    "function stop() {",
    "  if (fs.existsSync(pidFile)) {",
    "    try { process.kill(Number(fs.readFileSync(pidFile)), 'SIGTERM'); } catch {}",
    "    fs.unlinkSync(pidFile);",
    "  }",
    "  if (process.env.TEST_INSTALL_MODE === 'race') fs.appendFileSync(dir + '/client.log', 'old-session authenticated new-client\\n');",
    "}",
    "function start() {",
    "  const child = spawn(process.execPath, [dir + '/current/client.mjs', '--config', dir + '/current/config.json'], { detached: true, stdio: 'ignore', env: process.env });",
    "  fs.writeFileSync(pidFile, String(child.pid));",
    "  fs.appendFileSync(dir + '/test-service-pids.jsonl', String(child.pid) + '\\n');",
    "  child.unref();",
    "}",
    "fs.appendFileSync(dir + '/service-calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');",
    "if (command === 'bootout' || command === 'stop') stop();",
    "if (command === 'restart') stop();",
    "if (command === 'bootstrap' || command === 'start' || command === 'restart') start();",
  ];
  if (platform === "macos") executable("launchctl", serviceShim);
  if (systemd) {
    executable("systemctl", serviceShim);
    executable("journalctl", ["#!/bin/sh", "exit 0"]);
    executable("sudo", [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const { spawnSync } = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'tee') fs.writeFileSync(process.env.TEST_INSTALL_DIR + '/generated.service', fs.readFileSync(0));",
      "else process.exitCode = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env: process.env }).status ?? 1;",
    ]);
  }
  if (mode === "stale") fs.writeFileSync(path.join(install, "client.log"), "old-session authenticated new-client\n");

  const releases = path.join(install, "releases");
  fs.mkdirSync(releases);
  for (let i = 0; i < 20; i++) {
    const version = path.join(releases, "release." + String(i).padStart(6, "0"));
    fs.mkdirSync(path.join(version, "runtime/bin"), { recursive: true });
    fs.writeFileSync(path.join(version, "client.mjs"), "");
    fs.writeFileSync(path.join(version, "config.json"), "{}");
    fs.writeFileSync(path.join(version, "runtime/bin/node"), "");
    const old = new Date(Date.now() - 3 * 86400000);
    fs.utimesSync(version, old, old);
  }
  if (mode === "success") fs.symlinkSync(path.join(releases, "release.000019"), path.join(install, "current"));
  let authCount = 0;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ client: { id: "new-client", permissionMode: "user" }, credential: "test-credential" }));
  });
  const websocket = new WebSocketServer({ server });
  websocket.on("connection", (socket) => socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "auth") {
      authCount++;
      if (mode === "success") socket.send(JSON.stringify({ type: "authenticated", clientId: "new-client" }));
      else {
        if (mode === "wrong-id") fs.appendFileSync(path.join(install, "client.log"), "old-session authenticated different-client\n");
        socket.close();
      }
    }
    if (message.type === "heartbeat") socket.send(JSON.stringify({ type: "heartbeat_ack" }));
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn("/bin/bash", [
    path.join(root, "public/install/remote-client" + (platform === "macos" ? "-macos" : "") + ".sh"),
    "--server", "http://127.0.0.1:" + server.address().port,
    "--enrollment-token", "test-token", "--install-dir", install,
  ], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, PATH: bin, HOME: testHome,
      TEST_INSTALL_DIR: install, TEST_INSTALL_MODE: mode,
      TEST_FIXTURE_DIR: directory, TEST_REPO_ROOT: root, TEST_MODULES_DIR: path.join(root, "node_modules"),
    },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  let timer;
  try {
    const exitCode = await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Installer timed out: " + output)), 20_000); }),
    ]);
    const unitsDir = path.join(testHome, ".config/systemd/user");
    const unit = systemd ? path.join(unitsDir, fs.readdirSync(unitsDir)[0]) : "";
    if (systemd && mode === "success") {
      const calls = fs.readFileSync(path.join(install, "service-calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).filter(value => value !== "--user"));
      assert.equal(calls.filter(([command]) => ["start", "restart"].includes(command)).length, 1);
      assert.ok(calls.filter(([command]) => command === "enable").every((args) => !args.includes("--now")));
      const validator = spawnSync("systemd-analyze", ["verify", unit], { encoding: "utf8" });
      if (!validator.error) assert.equal(validator.status, 0, validator.stderr);
      if (process.env.METIS_TEST_EVIDENCE_DIR) {
        fs.copyFileSync(unit, path.join(process.env.METIS_TEST_EVIDENCE_DIR, "installer-generated.service"));
      }
    }
    if (mode === "success") {
      if(process.platform==="linux" && platform==="linux" && !systemd){
        const pid=Number(fs.readFileSync(path.join(install,"client.pid"),"utf8"));
        const command=fs.readFileSync("/proc/"+pid+"/cmdline","utf8");
        assert.ok(command.includes(fs.realpathSync(path.join(install,"current"))+"/runtime/bin/node"),"launcher argv must name the physical release, not a movable symlink");
      }
      const retained = fs.readdirSync(releases);
      assert.ok(retained.includes("release.000019"), "previous working release must survive");
      if(output.includes("cleanup deferred: Process visibility unavailable")){
        assert.equal(retained.length,21,"unknown process visibility must preserve all releases");
      }else{
        assert.equal(retained.length,2,output);
        assert.match(output,/Obsolete client releases removed: 19/);
      }
    } else {
      assert.equal(fs.readdirSync(releases).length, 21, "failed authentication must never prune old releases");
    }
    assert.ok(!fs.existsSync(path.join(install, ".install.lock")), "installer must release its own lock");
    return { exitCode, output, authCount };
  } finally {
    clearTimeout(timer);
    // Stop only the process group and fake service created by this fixture.
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    const pidFile = path.join(install, "test-service-pids.jsonl");
    if (fs.existsSync(pidFile)) {
      for (const pid of fs.readFileSync(pidFile, "utf8").trim().split("\n")) {
        try { process.kill(Number(pid), "SIGTERM"); } catch {}
      }
    }
    for (const socket of websocket.clients) socket.terminate();
    await new Promise((resolve) => websocket.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const installerCases = [
  ["linux", "success", false],
  ["linux", "stale", false],
  ["linux", "wrong-id", false],
  ["macos", "success", false],
  ["macos", "race", false],
  ["macos", "wrong-id", false],
  ["linux", "success", true],
  ["linux", "race", true],
];
for (const [platform, mode, systemd] of installerCases) {
  test(platform + (systemd ? " systemd" : "") + " installer: " + mode, { skip: process.platform === "win32" }, async () => {
    const result = await runInstaller(platform, mode, systemd);
    assert.equal(result.exitCode, mode === "success" ? 0 : 1, result.output);
    assert.ok(result.authCount > 0, "the newly enrolled client must attempt authentication");
    if (mode === "success") assert.match(result.output, /Remote client authenticated/);
    else {
      assert.match(result.output, /No authenticated connection/);
      assert.doesNotMatch(result.output, /Remote client authenticated/);
    }
  });
}
