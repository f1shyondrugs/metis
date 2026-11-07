import { spawn, type ChildProcess } from "node:child_process";
import type { ToolPart } from "@/lib/store";
import { canonicalizeToolPart } from "@/lib/providers/tool-events";
import { providerProcessEnv } from "@/lib/providers/process-env";
import {assertNativeMcpServers,spawnNative} from "./native-sandbox";
import { type McpServerMap } from "@/lib/mcp";

export type AcpRunInput = {
  command: string;
  args: string[];
  cwd: string;
  prompt: string;
  env?: Record<string, string>;
  mcp: McpServerMap;
  signal: AbortSignal;
  clientName?: string;
  onText: (text: string) => void;
  onTool: (tool: ToolPart) => void;
};

export function mcpServersForAcp(servers: McpServerMap) {
  return Object.entries(servers).map(([name, server]) => {
    if (server.type === "http") {
      const headers = Object.entries(server.headers || {}).map(([headerName, value]) => ({
        name: headerName,
        value,
      }));
      return { type: "http" as const, name, url: server.url, headers };
    }
    return {
      type: "stdio" as const,
      name,
      command: server.command,
      args: server.args,
      env: Object.entries(server.env || {}).map(([envName, value]) => ({ name: envName, value })),
    };
  });
}

function writeLine(child: ChildProcess, payload: unknown) {
  child.stdin!.write(JSON.stringify(payload) + String.fromCharCode(10));
}

function writeRpc(child: ChildProcess, id: number, method: string, params: unknown) {
  writeLine(child, { jsonrpc: "2.0", id, method, params });
}

function writeResult(child: ChildProcess, id: number, result: unknown) {
  writeLine(child, { jsonrpc: "2.0", id, result });
}

function writeError(child: ChildProcess, id: number | string, code: number, message: string) {
  writeLine(child, { jsonrpc: "2.0", id, error: { code, message } });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function applyAcpSessionUpdate(
  update: Record<string, unknown>,
  handlers: { onText: (text: string) => void; onTool: (tool: ToolPart) => void },
) {
  const kind = asString(update.sessionUpdate);
  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = asRecord(update.content);
    const text = asString(content.text);
    if (text) handlers.onText(text);
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const title = asString(update.title) || asString(update.toolCallId) || "tool";
    const statusRaw = asString(update.status).toLowerCase();
    const status = statusRaw === "completed" || statusRaw === "failed" || statusRaw === "error"
      ? (statusRaw === "completed" ? "completed" : "error")
      : "running";
    handlers.onTool(canonicalizeToolPart({
      id: asString(update.toolCallId) || crypto.randomUUID(),
      name: title,
      status,
      input: update.rawInput ? JSON.stringify(update.rawInput) : undefined,
      result: update.content ? JSON.stringify(update.content) : undefined,
    }));
  }
}

export function rejectedAcpPermissionResult(params: unknown) {
  const options = Array.isArray(asRecord(params).options)
    ? asRecord(params).options as unknown[]
    : [];
  const rejection = options
    .map(asRecord)
    .find((option) => option.kind === "reject_once" || option.kind === "reject_always");
  const optionId = rejection && asString(rejection.optionId);
  return optionId
    ? { outcome: { outcome: "selected", optionId } }
    : { outcome: { outcome: "cancelled" } };
}

export async function runAcpStdioAgent(input: AcpRunInput): Promise<{ sessionId?: string }> {
  assertNativeMcpServers(input.mcp);
  const child: ChildProcess = spawnNative(input.command, input.args, {
    cwd: input.cwd,
    env: providerProcessEnv(input.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (input.signal.aborted) child.kill("SIGTERM");
  input.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });

  let buffer = "";
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  let sessionId: string | undefined;
  let nextId = 1;

  const wait = (id: number) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${input.command} ACP RPC timed out`)), 60_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

  const handleLine = (line: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return; }
    const record = asRecord(parsed);
    const rpcId = record.id;
    if (typeof record.method === "string" && (typeof rpcId === "number" || typeof rpcId === "string")) {
      const method = record.method;
      if (method === "session/request_permission" || method.endsWith("/request_permission")) {
        writeResult(child, rpcId as number, rejectedAcpPermissionResult(record.params));
        return;
      }
      writeError(
        child,
        rpcId,
        -32601,
        `Native ACP client method ${method} is disabled; use the Metis MCP gateway.`,
      );
      return;
    }
    if ((typeof rpcId === "number" || typeof rpcId === "string") && pending.has(Number(rpcId))) {
      const result = record.error ? { error: record.error } : asRecord(record.result);
      pending.get(Number(rpcId))!(result);
      pending.delete(Number(rpcId));
      return;
    }
    if (record.method === "session/update") {
      const params = asRecord(record.params);
      applyAcpSessionUpdate(asRecord(params.update), input);
    }
  };

  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    const newline = String.fromCharCode(10);
    const lines = buffer.split(newline);
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) handleLine(line.trim());
  });

  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code && code !== 0) reject(new Error(`${input.command} exited ${code}`));
      else resolve();
    });
  });

  try {
    const initId = nextId++;
    writeRpc(child, initId, "initialize", {
      protocolVersion: 1,
      clientInfo: { name: input.clientName || "metis-ai", version: "1.0.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    await wait(initId);

    const sessionReq = nextId++;
    writeRpc(child, sessionReq, "session/new", {
      cwd: input.cwd,
      mcpServers: mcpServersForAcp(input.mcp),
    });
    const session = await wait(sessionReq);
    sessionId = asString(session.sessionId);

    const promptId = nextId++;
    writeRpc(child, promptId, "session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: input.prompt }],
    });
    await wait(promptId);
    child.stdin!.end();
    await exit;
    return { sessionId };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}
