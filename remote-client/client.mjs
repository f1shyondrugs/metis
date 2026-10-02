#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");

export function startRemoteClient({ config: suppliedConfig, configPath, onEvent = () => {}, desktopGuiAvailable = () => false } = {}) {
  const resolvedPath = configPath || process.env.METIS_REMOTE_CLIENT_CONFIG ||
    path.join(os.homedir(), ".metis-ai", "remote-client.json");
  const config = suppliedConfig || JSON.parse(fs.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, ""));
  const logFile = path.join(path.dirname(resolvedPath), "client.log");
  const log = (...items) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${items.join(" ")}\n`); } catch {}
  };
  const emit = (event) => {
    try { onEvent(event); } catch (error) {
      log("event callback", error?.message || error);
      if (event.type === "computer_use") throw error;
    }
  };
  const server = String(config.server || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(server) || !config.clientId || !config.credential) {
    throw new Error("Remote client configuration is incomplete");
  }
  const wsUrl = server.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/ws/remote-client";
  const running = new Map();
  const computerUseControllers = new Set();
  const computerUsePending = new Map();
  let computerUseWorker;
  let computerUseQueue = Promise.resolve();
  let socket;
  let reconnectTimer;
  let heartbeatTimer;
  let heartbeatTimeout;
  let retryMs = 1_000;
  let stopped = false;

  const send = (message) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  function failComputerUsePending(error) {
    for (const { reject, cleanup } of computerUsePending.values()) {
      cleanup();
      reject(error);
    }
    computerUsePending.clear();
  }

  function ensureComputerUseWorker() {
    if (computerUseWorker) return computerUseWorker;
    const workerUrl = new URL("./computer-use-worker.mjs", import.meta.url);
    workerUrl.pathname = workerUrl.pathname.replace("/app.asar/", "/app.asar.unpacked/");
    const worker = new Worker(workerUrl);
    computerUseWorker = worker;
    worker.unref();
    worker.on("message", (message) => {
      const pending = computerUsePending.get(message?.id);
      if (!pending) return;
      computerUsePending.delete(message.id);
      pending.cleanup();
      if (message.type === "result") pending.resolve(message.result);
      else {
        const error = new Error(message?.error?.message || "Computer Use failed");
        if (message?.error?.stack) error.stack = message.error.stack;
        pending.reject(error);
      }
    });
    worker.on("error", (error) => {
      if (computerUseWorker === worker) computerUseWorker = undefined;
      failComputerUsePending(error);
    });
    worker.on("exit", (code) => {
      if (computerUseWorker !== worker) return;
      computerUseWorker = undefined;
      failComputerUsePending(new Error(`Computer Use worker stopped with code ${code}`));
    });
    return worker;
  }

  function runComputerUse(params, signal) {
    if (signal.aborted) return Promise.reject(new Error("Computer Use was cancelled"));
    const worker = ensureComputerUseWorker();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => worker.postMessage({ type: "cancel", id });
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      computerUsePending.set(id, { resolve, reject, cleanup });
      worker.postMessage({ type: "run", id, params });
    });
  }

  function terminateComputerUseWorker() {
    const worker = computerUseWorker;
    computerUseWorker = undefined;
    failComputerUsePending(new Error("Computer Use was stopped"));
    if (worker) void worker.terminate();
  }

  async function execute(action, params = {}) {
    if (action === "get_info") {
      return {
        hostname: os.hostname(),
        os: `${process.platform} ${os.release()}`,
        architecture: process.arch,
        version: "1.1.0",
        cwd: process.cwd(),
        memory: { total: os.totalmem(), free: os.freemem() },
        uptime: os.uptime(),
      };
    }
    if (action === "computer_use") {
      if (!desktopGuiAvailable()) throw new Error("Computer Use requires an interactive Windows display");
      const operation = String(params.operation || "");
      const controller = new AbortController();
      computerUseControllers.add(controller);
      const task = async () => {
        let captureSuspended = false;
        try {
          if (controller.signal.aborted) throw new Error("Computer Use was cancelled");
          if (operation !== "status") emit({ type: "computer_use", phase: "start", operation, key: operation === "key" ? params.key : undefined });
          if (operation === "observe") {
            emit({ type: "computer_use", phase: "capture-start", operation });
            captureSuspended = true;
          }
          return await runComputerUse(params, controller.signal);
        } finally {
          if (captureSuspended) emit({ type: "computer_use", phase: "capture-end", operation });
          if (operation !== "status") emit({ type: "computer_use", phase: "end", operation });
        }
      };
      const result = computerUseQueue.catch(() => {}).then(task);
      computerUseQueue = result;
      try {
        return await result;
      } finally {
        computerUseControllers.delete(controller);
      }
    }
    if (action === "execute_command") {
      const command = String(params.command || "");
      if (!command.trim()) throw new Error("Command is required");
      const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : os.homedir();
      const timeout = Math.max(1_000, Math.min(Number(params.timeout) || 60_000, 300_000));
      const result = await execFileAsync(shell, process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command], {
        cwd,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    }
    if (action === "list_directory") {
      const directory = String(params.path || os.homedir());
      return { path: directory, entries: fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() })) };
    }
    if (action === "read_file") {
      const file = String(params.path || "");
      if (!file) throw new Error("Path is required");
      const limit = Math.min(Number(params.limit) || 5_000_000, 10_000_000);
      return { path: file, content: fs.readFileSync(file, "utf8").slice(0, limit) };
    }
    if (action === "write_file") {
      const file = String(params.path || "");
      if (!file) throw new Error("Path is required");
      if (typeof params.content !== "string") throw new Error("Content is required");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, params.content, "utf8");
      return { path: file, bytes: Buffer.byteLength(params.content, "utf8") };
    }
    if (action === "edit_file") {
      const file = String(params.path || "");
      const oldText = String(params.oldText ?? "");
      const newText = String(params.newText ?? "");
      if (!file) throw new Error("Path is required");
      const content = fs.readFileSync(file, "utf8");
      const position = content.indexOf(oldText);
      if (position < 0) throw new Error("The requested oldText was not found in the file");
      const next = `${content.slice(0, position)}${newText}${content.slice(position + oldText.length)}`;
      fs.writeFileSync(file, next, "utf8");
      return { path: file, replacements: 1, bytes: Buffer.byteLength(next, "utf8") };
    }
    if (action === "delete_file") {
      const file = String(params.path || "");
      if (!file) throw new Error("Path is required");
      fs.rmSync(file, { force: false });
      return { path: file, deleted: true };
    }
    if (action === "pty_open") {
      const child = spawn(shell, process.platform === "win32" ? [] : ["-i"], {
        cwd: typeof params.cwd === "string" ? params.cwd : os.homedir(),
        env: process.env,
        stdio: "pipe",
        windowsHide: true,
      });
      const sessionId = randomUUID();
      running.set(sessionId, child);
      child.stdout.on("data", (data) => send({ type: "event", sessionId, event: "stdout", data: data.toString() }));
      child.stderr.on("data", (data) => send({ type: "event", sessionId, event: "stderr", data: data.toString() }));
      child.on("exit", (code) => {
        running.delete(sessionId);
        send({ type: "event", sessionId, event: "exit", code });
      });
      return { sessionId };
    }
    if (action === "pty_input") {
      const child = running.get(String(params.sessionId));
      if (!child?.stdin.writable) throw new Error("PTY session not found");
      child.stdin.write(String(params.data || ""));
      return { ok: true };
    }
    if (action === "pty_close") {
      running.get(String(params.sessionId))?.kill();
      return { ok: true };
    }
    throw new Error(`Unsupported remote action: ${action}`);
  }

  function connect() {
    if (stopped) return;
    emit({ type: "connection", status: "connecting" });
    const current = new WebSocket(wsUrl);
    socket = current;
    let authenticated = false;
    let opened = false;
    let socketError = "";
    current.on("open", () => {
      opened = true;
      log("connected", wsUrl);
      send({ type: "auth", clientId: config.clientId, credential: config.credential });
    });
    current.on("message", async (raw) => {
      if (socket !== current) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === "authenticated") {
        authenticated = true;
        retryMs = 1_000;
        log("authenticated", message.clientId || "");
        emit({ type: "connection", status: "online", at: new Date().toISOString() });
        send({ type: "heartbeat", desktopGui: Boolean(desktopGuiAvailable()) });
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => send({ type: "heartbeat", desktopGui: Boolean(desktopGuiAvailable()) }), 20_000);
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => current.terminate(), 75_000);
        return;
      }
      if (message.type === "heartbeat_ack") {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => current.terminate(), 75_000);
        return;
      }
      if (message.type !== "request" || typeof message.requestId !== "string" || !authenticated) return;
      emit({ type: "command", status: "running", action: message.action, at: new Date().toISOString() });
      try {
        const result = await execute(message.action, message.params);
        if (socket === current) send({ type: "response", requestId: message.requestId, ok: true, result });
        emit({ type: "command", status: "completed", action: message.action, at: new Date().toISOString() });
      } catch (error) {
        const result = error && typeof error === "object" && ("stdout" in error || "stderr" in error)
          ? { stdout: String(error.stdout || ""), stderr: String(error.stderr || ""), exitCode: typeof error.code === "number" ? error.code : null }
          : undefined;
        if (socket === current) send({ type: "response", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : "Action failed", result });
        emit({ type: "command", status: "error", action: message.action, at: new Date().toISOString() });
      }
    });
    current.on("close", (code, reason) => {
      log("closed", code, reason?.toString?.() || "");
      if (socket !== current) return;
      clearInterval(heartbeatTimer);
      clearTimeout(heartbeatTimeout);
      if (socket === current) socket = undefined;
      emit({ type: "connection", status: socketError || (opened && !authenticated) ? "error" : "offline", error: socketError || (opened && !authenticated ? "Authentication was not confirmed" : "") });
      if (!stopped) {
        reconnectTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(Math.round(retryMs * 1.7), 30_000);
      }
    });
    current.on("error", (error) => {
      if (socket !== current) return;
      socketError = error?.message || "Connection error";
      log("socket error", socketError);
      emit({ type: "connection", status: "error", error: socketError });
    });
  }

  connect();
  return {
    cancelComputerUse() {
      for (const controller of computerUseControllers) controller.abort();
    },
    stop() {
      stopped = true;
      for (const controller of computerUseControllers) controller.abort();
      computerUseWorker?.postMessage({ type: "cancel-all" });
      terminateComputerUseWorker();
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(heartbeatTimeout);
      socket?.close();
      for (const child of running.values()) child.kill();
      running.clear();
    },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--config");
  try {
    startRemoteClient({ configPath: index >= 0 ? args[index + 1] : undefined });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
