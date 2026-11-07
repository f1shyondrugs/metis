import { callNativeDevelopmentBroker } from "@/lib/native-development-broker";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { callRemoteGatewayTool } from "@/lib/remote-gateway";
import { collectRemoteClientEvents, requestRemoteClient } from "@/lib/remote-client-gateway";
import { config } from "@/lib/config";
import { getUserAgentCwd } from "@/lib/mcp";
import { isInsideWorkspace } from "@/lib/user-isolation";
import { isHostAdmin, requireUserExecutionIdentity } from "@/lib/user-access";
import { stripReadFileLinePrefixes } from "@/lib/remote-file-content";
import { fileNameSearchPattern } from "@/lib/file-editor-search";
import { runFileIO } from "@/lib/file-sync-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CWD = config.agentCwd;
const terminalSessions = new Map<string, {
  ownerId?: string;
  cwd: string;
  process: pty.IPty;
  chunks: Array<{ id: number; data: string }>;
  nextChunkId: number;
  lastActivity: number;
}>();

function resolveRemotePath(value: unknown, cwd = DEFAULT_CWD) {
  const input = typeof value === "string" && value.trim() ? value.trim() : cwd;
  return path.resolve(input.startsWith("/") ? input : path.join(cwd, input));
}

function isInside(root: string, candidate: string) {
  return isInsideWorkspace(root, candidate);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sessionFor(sessionId: string | null, ownerId?: string) {
  if (!sessionId) return null;
  const session = terminalSessions.get(sessionId);
  if (!session || session.ownerId !== ownerId) return null;
  return session;
}

function cleanupTerminalSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sessionId, session] of terminalSessions) {
    if (session.lastActivity < cutoff) {
      session.process.kill();
      terminalSessions.delete(sessionId);
    }
  }
}

function gatewayContext(ownerId?: string) {
  const identity = requireUserExecutionIdentity(ownerId);
  return {
    userId: ownerId,
    uid: identity.uid,
    gid: identity.gid,
    osUsername: identity.username,
    workspaceRoot: identity.workspaceRoot,
    home: identity.home,
    allowRoot: config.allowRootAgents,
    isHostAdmin: isHostAdmin(ownerId),
  };
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId")?.trim();
  if (clientId) {
    const sessionId = url.searchParams.get("sessionId")?.trim() || "";
    if (!sessionId) return Response.json({ error: "Remote terminal session is required" }, { status: 400 });
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const events = await collectRemoteClientEvents(sessionId, 0);
    const chunks = events
      .filter((event) => event.event === "stdout" || event.event === "stderr")
      .map((event, index) => ({ id: cursor + index + 1, data: String(event.data || "") }));
    return Response.json({ chunks, cursor: cursor + chunks.length });
  }
  if (process.env.METIS_DEVELOPMENT_BROKER) {
    const isolation = gatewayContext(ownerId);
    const result = await callNativeDevelopmentBroker({ action: "pty-chunks", uid: isolation.uid, root: isolation.workspaceRoot, owner: ownerId,
      body: { sessionId: url.searchParams.get("sessionId"), cursor: url.searchParams.get("cursor") } });
    const { status = 200, ...payload } = result;
    return Response.json(payload, { status: Number(status) });
  }
  const session = sessionFor(url.searchParams.get("sessionId"), ownerId);
  if (!session) return Response.json({ error: "Terminal session not found" }, { status: 404 });
  session.lastActivity = Date.now();
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const chunks = session.chunks.filter((chunk) => chunk.id > cursor);
  const nextCursor = chunks.at(-1)?.id ?? cursor;
  return Response.json({ chunks, cursor: nextCursor });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 401 });
  let isolation: ReturnType<typeof gatewayContext>;
  try {
    isolation = gatewayContext(ownerId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Workspace isolation is required" },
      { status: 403 },
    );
  }

  let body: {
    action?: string;
    query?: string;
    searchMode?: "files" | "content";
    regex?: boolean;
    caseSensitive?: boolean;
    path?: string;
    cwd?: string;
    content?: string;
    revision?: string;
    preview?: boolean;
    line?: number;
    newPath?: string;
    command?: string;
    timeout?: number;
    sessionId?: string;
    clientId?: string;
    data?: string;
    approvalId?: string;
    cols?: number;
    rows?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const defaultCwd = getUserAgentCwd(ownerId);
  const cwd = resolveRemotePath(body.cwd, defaultCwd);
  const targetPath = resolveRemotePath(body.path, cwd);
  if (!isInside(defaultCwd, cwd) || !isInside(defaultCwd, targetPath)) {
    return Response.json({ error: "Path must be inside the agent workspace." }, { status: 400 });
  }

  try {
    if (!body.clientId && process.env.METIS_DEVELOPMENT_BROKER &&
        ["pty-create", "pty-attach", "pty-input", "pty-resize", "pty-close"].includes(body.action || "")) {
      const result = await callNativeDevelopmentBroker({ action: body.action, uid: isolation.uid, root: defaultCwd, owner: ownerId, body: { ...body, cwd } });
      const { status = 200, ...payload } = result;
      return Response.json(payload, { status: Number(status) });
    }
    cleanupTerminalSessions();
    if (body.clientId) {
      const clientId = body.clientId.trim();
      if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 401 });
      if (body.action === "pty-create") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_open",
          ...(body.approvalId ? { approvalId: body.approvalId } : {}),
          params: { cwd },
        });
        return Response.json(result);
      }
      if (body.action === "pty-input") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_input",
          ...(body.approvalId ? { approvalId: body.approvalId } : {}),
          params: { sessionId: body.sessionId, data: body.data || "" },
        });
        return Response.json({ result });
      }
      if (body.action === "pty-close") {
        const result = await requestRemoteClient({
          clientId,
          ownerId,
          action: "pty_close",
          ...(body.approvalId ? { approvalId: body.approvalId } : {}),
          params: { sessionId: body.sessionId },
        });
        return Response.json(result);
      }
      if (body.action === "pty-resize") return Response.json({ ok: true });
      return Response.json({ error: "Unsupported remote client terminal action" }, { status: 400 });
    }
    if (body.action === "pty-attach") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session || session.cwd !== cwd) {
        return Response.json({ error: "Terminal session not found" }, { status: 404 });
      }
      session.lastActivity = Date.now();
      return Response.json({ sessionId: body.sessionId });
    }
    if (body.action === "pty-create") {
      const sessionId = randomUUID();
      const shell = process.env.SHELL?.trim() || "/bin/bash";
      const shellName = path.basename(shell);
      const shellArgs = shellName === "bash" || shellName === "zsh" ? ["--login"] : [];
      const terminal = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: Math.max(20, Math.min(Number(body.cols) || 80, 240)),
        rows: Math.max(5, Math.min(Number(body.rows) || 24, 100)),
        cwd,
        env: {
          ...process.env,
          HOME: isolation.home || process.env.HOME,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as Record<string, string>,
        uid: isolation.uid,
        gid: isolation.gid,
      });
      const session = {
        ownerId,
        cwd,
        process: terminal,
        chunks: [] as Array<{ id: number; data: string }>,
        nextChunkId: 1,
        lastActivity: Date.now(),
      };
      terminal.onData((data) => {
        session.chunks.push({ id: session.nextChunkId++, data });
        if (session.chunks.length > 2000) session.chunks.splice(0, session.chunks.length - 2000);
      });
      terminal.onExit(() => terminalSessions.delete(sessionId));
      terminalSessions.set(sessionId, session);
      return Response.json({ sessionId });
    }
    if (body.action === "pty-input") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session || typeof body.data !== "string") {
        return Response.json({ error: "Terminal session not found" }, { status: 404 });
      }
      session.lastActivity = Date.now();
      session.process.write(body.data);
      return Response.json({ ok: true });
    }
    if (body.action === "pty-resize") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (!session) return Response.json({ error: "Terminal session not found" }, { status: 404 });
      session.lastActivity = Date.now();
      session.process.resize(
        Math.max(20, Math.min(Number(body.cols) || 80, 240)),
        Math.max(5, Math.min(Number(body.rows) || 24, 100)),
      );
      return Response.json({ ok: true });
    }
    if (body.action === "pty-close") {
      const session = sessionFor(body.sessionId || null, ownerId);
      if (session) {
        session.process.kill();
        terminalSessions.delete(body.sessionId!);
      }
      return Response.json({ ok: true });
    }
    if (body.action === "search") {
      if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500 ||
        !["files", "content"].includes(body.searchMode || "") ||
        (body.regex !== undefined && typeof body.regex !== "boolean") ||
        (body.caseSensitive !== undefined && typeof body.caseSensitive !== "boolean")) {
        return Response.json({ error: "Enter a search query of up to 500 characters and choose Files or Contents." }, { status: 400 });
      }
      if (body.searchMode === "content" && body.regex) {
        try { new RegExp(body.query); }
        catch { return Response.json({ error: "Invalid regular expression." }, { status: 400 }); }
      }
      const files = body.searchMode === "files";
      const output = await callRemoteGatewayTool(files ? "file_search" : "grep_search", {
        path: targetPath, pattern: files ? fileNameSearchPattern(body.query.trim()) : body.query,
        include_hidden: true, limit: 100,
        ...(!files ? { regex: body.regex === true, case_sensitive: body.caseSensitive === true } : {}),
      }, isolation);
      return Response.json({ search: JSON.parse(output) });
    }
    if (body.action === "list") {
      const output = await callRemoteGatewayTool("list_directory", { target: "server", path: targetPath }, isolation);
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "snapshot" || body.action === "save") {
      if ((body.revision !== undefined && (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision))) ||
          (body.action === "save" && (typeof body.content !== "string" || !body.revision))) {
        return Response.json({ error: "A valid file revision and content are required." }, { status: 400 });
      }
      const result = await runFileIO({ action: body.action, path: targetPath, root: defaultCwd, revision: body.revision, content: body.content }, isolation) as {
        status: number; error?: string; revision?: string; content?: string; unchanged?: boolean;
      };
      if (![200,400,403,404,409,413,415,502].includes(result.status)) throw new Error("Invalid file server response.");
      const { status, ...payload } = result;
      return Response.json({ path: targetPath, ...payload }, { status });
    }
    if (body.action === "read") {
      const output = await callRemoteGatewayTool("read_file", {
        target: "server",
        path: targetPath,
        offset: body.preview === true && Number.isSafeInteger(body.line) && body.line! > 0 ? Math.max(1, body.line! - 3) : 1,
        limit: body.preview === true ? 80 : 5000,
      }, isolation);
      const content = stripReadFileLinePrefixes(output);
      return Response.json({ path: targetPath, content: body.preview === true ? content.slice(0, 8000) : content });
    }
    if (body.action === "create") {
      const script = "const fs=require('node:fs');const p=process.argv[1];try{fs.closeSync(fs.openSync(p,'wx'));console.log('METIS_FILE_CREATED')}catch(e){console.error(e.code==='EEXIST'?'A file or folder with this name already exists.':e.message);process.exitCode=1}";
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server", command: `${shellQuote(process.execPath)} -e ${shellQuote(script)} ${shellQuote(targetPath)}`,
        cwd, timeout: 60, sudo: false,
      }, isolation);
      if (!output.includes("METIS_FILE_CREATED")) throw new Error(output.trim() || "File could not be created.");
      return Response.json({ path: targetPath });
    }
    if (body.action === "write") {
      if (typeof body.content !== "string") {
        return Response.json({ error: "File content is required" }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("write_file", {
        target: "server",
        path: targetPath,
        content: body.content,
      }, isolation);
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "exec") {
      if (!body.command?.trim()) {
        return Response.json({ error: "Command is required" }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: body.command,
        cwd,
        timeout: Math.max(1, Math.min(body.timeout || 60, 3600)),
        sudo: false,
      }, isolation);
      return Response.json({ cwd, output });
    }
    if (body.action === "mkdir") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mkdir -- ${shellQuote(targetPath)} && printf METIS_FOLDER_CREATED`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      if (!output.includes("METIS_FOLDER_CREATED")) throw new Error(output.trim() || "Folder could not be created.");
      return Response.json({ path: targetPath, output });
    }
    if (body.action === "rename") {
      const newPath = resolveRemotePath(body.newPath, cwd);
      if (!isInside(defaultCwd, newPath)) {
        return Response.json({ error: "Path must be inside the agent workspace." }, { status: 400 });
      }
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `mv -T -n -- ${shellQuote(targetPath)} ${shellQuote(newPath)} && test ! -e ${shellQuote(targetPath)} && test ! -L ${shellQuote(targetPath)} && printf METIS_ENTRY_RENAMED`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      if (!output.includes("METIS_ENTRY_RENAMED")) throw new Error("Could not rename: the destination may already exist, or the entry is not writable.");
      return Response.json({ path: targetPath, newPath, output });
    }
    if (body.action === "delete") {
      const output = await callRemoteGatewayTool("execute_command", {
        target: "server",
        command: `rm -rf -- ${shellQuote(targetPath)}`,
        cwd,
        timeout: 60,
        sudo: false,
      }, isolation);
      return Response.json({ path: targetPath, output });
    }
    return Response.json({ error: "Unknown remote action" }, { status: 400 });
  } catch (error) {
    if (error && typeof error === "object" && "approvalId" in error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Remote action requires explicit user approval",
        approvalId: String((error as { approvalId: unknown }).approvalId),
      }, { status: 409 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Remote action failed" },
      { status: 502 },
    );
  }
}
