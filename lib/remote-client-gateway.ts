import { remoteDesktopEvents } from "@/lib/remote-desktop-events";
import { getRemoteClientAppearance } from "@/lib/remote-client-appearance";
import { buildFileEditProgram, normalizeFileEdit } from "../remote-client/file-edit.mjs";
import { bindNotificationSession } from "@/lib/notification-remote";
import {
  appendRemoteAudit,
  authenticateRemoteClient,
  authorizeRemoteAction,
  getRemoteClient,
  markRemoteClientOffline,
  markRemoteClientSeen,
  updateRemoteClientDesktopCapability,
  consumeRemoteApproval,
  createRemoteApproval,
  RemoteApprovalRequiredError,
  updateRemoteAudit,
  type RemoteAction,
} from "@/lib/remote-clients";
import { validateUserRemoteRequest } from "@/lib/remote-security";
import { redactSensitiveData } from "@/lib/agent-trace";
import { approvedRemoteActionId, publishRemoteApproval, waitForRemoteApproval } from "@/lib/remote-approval-flow";

type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  on: (event: "message" | "close" | "error", callback: (value?: unknown) => void) => void;
  close: () => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const OPEN = 1;
type GatewayState = {
  connections: Map<string, { socket: SocketLike; ownerId: string; pending: Map<string, Pending> }>;
  events: Map<string, Array<Record<string, unknown>>>;
};
const processGlobal = globalThis as typeof globalThis & { __metisRemoteGateway?: GatewayState };
const gatewayState = processGlobal.__metisRemoteGateway || {
  connections: new Map<string, { socket: SocketLike; ownerId: string; pending: Map<string, Pending> }>(),
  events: new Map<string, Array<Record<string, unknown>>>(),
};
processGlobal.__metisRemoteGateway = gatewayState;
const connections = gatewayState.connections;

export function disconnectRemoteClient(clientId: string) {
  const connection = connections.get(clientId);
  if (!connection) return;
  connection.socket.close();
  connections.delete(clientId);
}

export function authenticateClientMessage(message: unknown) {
  if (!message || typeof message !== "object") return null;
  const data = message as Record<string, unknown>;
  if (data.type !== "auth" || typeof data.clientId !== "string" || typeof data.credential !== "string") return null;
  return authenticateRemoteClient(data.clientId, data.credential);
}

export function attachRemoteClient(socket: SocketLike, clientId: string, ownerId: string, address?: string) {
  connections.get(clientId)?.socket.close();
  const pending = new Map<string, Pending>();
  connections.set(clientId, { socket, ownerId, pending });
  bindNotificationSession(socket, clientId, ownerId);
  markRemoteClientSeen(clientId, address);
  let lastHeartbeatAt = Date.now();
  let appearanceRevision: number | undefined;
  const heartbeatCheck = setInterval(() => {
    if (Date.now() - lastHeartbeatAt > 90_000) socket.close();
  }, 30_000);
  heartbeatCheck.unref?.();
  socket.on("message", (raw: unknown) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "heartbeat") {
      lastHeartbeatAt = Date.now();
      markRemoteClientSeen(clientId, address);
      if (typeof message.desktopGui === "boolean") updateRemoteClientDesktopCapability(clientId, message.desktopGui);
      let appearance;
      if (message.appearance === true) {
        // A bad saved theme must never break the device heartbeat or input path.
        try {
          const current = getRemoteClientAppearance(ownerId);
          if (current.revision !== appearanceRevision) appearance = current;
        } catch { /* Keep the client's last valid theme. */ }
      }
      socket.send(JSON.stringify({ type: "heartbeat_ack", timestamp: Date.now(), ...(appearance ? { appearance } : {}) }));
      if (appearance) appearanceRevision = appearance.revision;
      return;
    }
    if (message.type === "event" && typeof message.sessionId === "string") {
      const events = gatewayState.events.get(message.sessionId) || [];
      events.push(message);
      gatewayState.events.set(message.sessionId, events.slice(-200));
      return;
    }
    if (message.type !== "response" || typeof message.requestId !== "string") return;
    const item = pending.get(message.requestId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.requestId);
    if (message.ok === false) {
      const error = new Error(typeof message.error === "string" ? message.error : "Remote client request failed") as Error & { resultData?: Record<string, unknown> };
      if (message.result && typeof message.result === "object") error.resultData = message.result as Record<string, unknown>;
      item.reject(error);
    } else item.resolve(message.result);
  });
  socket.on("close", () => {
    clearInterval(heartbeatCheck);
    if (connections.get(clientId)?.socket !== socket) return;
    connections.delete(clientId);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Remote client disconnected"));
    }
    markRemoteClientOffline(clientId);
  });
}

export function requestRemoteClient(input: {
  clientId: string;
  ownerId: string;
  action: RemoteAction;
  params?: Record<string, unknown>;
  source?: "user" | "agent";
  approvalId?: string;
  runId?: string;
  toolCallId?: string;
  timeoutMs?: number;
  /** Passive viewer frames stay in memory and never enter the audit database. */
  ephemeralPreview?: boolean;
  /** Trusted chat context supplied by the internal run lease, never by device input. */
  chatId?: string;
}) {
  // Keep the wire operation and any approval bound to the same arguments, even
  // if the caller changes its object while the native request is in flight.
  input = { ...input, params: structuredClone(input.params || {}) };
  const client = getRemoteClient(input.clientId, input.ownerId);
  if (!client) throw new Error("Remote client not found");
  if (input.action === "edit_file") normalizeFileEdit(input.params);
  const authorization = authorizeRemoteAction(client, input.action, input.params);
  if (!authorization.allowed) {
    appendRemoteAudit({
      ownerId: input.ownerId,
      clientId: input.clientId,
      source: input.source || "user",
      action: input.action,
      requestData: redact(input.params),
      status: "denied",
      error: authorization.reason,
    });
    throw new Error(authorization.reason || "Remote action denied");
  }
  if (authorization.requiresApproval) {
    const approvalId = input.approvalId || approvedRemoteActionId(input);
    if (!approvalId || !consumeRemoteApproval({
      id: approvalId,
      ownerId: input.ownerId,
      clientId: input.clientId,
      action: input.action,
      params: input.params,
    })) {
      if (approvalId) throw new Error(`Remote approval ${approvalId} is pending, expired, already used, or does not match this action.`);
      const approval = createRemoteApproval({
        ownerId: input.ownerId,
        clientId: input.clientId,
        action: input.action,
        params: input.params,
        source: input.source,
        runId: input.runId,
        toolCallId: input.toolCallId,
      });
      publishRemoteApproval(input, approval.id);
      throw new RemoteApprovalRequiredError(approval.id);
    }
  }
  const connection = connections.get(input.clientId);
  if (!connection || connection.socket.readyState !== OPEN) throw new Error("Remote client is offline");
  const audit = input.ephemeralPreview ? null : appendRemoteAudit({
    ownerId: input.ownerId,
    clientId: input.clientId,
    source: input.source || "user",
    action: input.action,
    requestData: redact(input.params),
    status: "running",
  });
  const desktopActivity = input.source === "agent" && input.chatId && client.capabilities.includes("desktop_gui")
    && ["computer_use", "execute_command", "pty_input"].includes(input.action);
  const publishDesktop = (phase: "start" | "end") => {
    if (desktopActivity) remoteDesktopEvents.emit("activity", {
      ownerId: input.ownerId, chatId: input.chatId, clientId: input.clientId,
      action: input.action, phase, timestamp: Date.now(),
    });
  };
  publishDesktop("start");
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs || 60_000, 300_000));
  const promise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pending.delete(requestId);
      reject(new Error("Remote client request timed out"));
    }, timeoutMs);
    connection.pending.set(requestId, { resolve, reject, timer });
  });
  // A distinct wire action makes older clients reject batches instead of silently ignoring edits.
  const advancedEdit = input.action === "edit_file" && (Array.isArray(input.params?.edits)
    || input.params?.dryRun === true || input.params?.replaceAll === true
    || input.params?.expectedOccurrences != null);
  connection.socket.send(JSON.stringify({
    type: "request",
    requestId,
    action: advancedEdit ? "edit_file_batch" : input.action,
    params: input.params || {},
    timestamp: Date.now(),
  }));
  const send = (action: string, params: Record<string, unknown>) => {
    if (action === input.action && params === input.params) return promise;
    const fallbackId = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(fallbackId);
        reject(new Error("Remote client request timed out"));
      }, timeoutMs);
      connection.pending.set(fallbackId, { resolve, reject, timer });
      connection.socket.send(JSON.stringify({
        type: "request",
        requestId: fallbackId,
        action,
        params,
        timestamp: Date.now(),
      }));
    });
  };
  const resultPromise = promise.catch((error) => {
    const legacyAction = input.action === "write_file" || input.action === "edit_file" || input.action === "delete_file";
    const unsupported = error instanceof Error && /unsupported remote action/i.test(error.message);
    if (!legacyAction || !unsupported) throw error;
    if (advancedEdit && getRemoteClient(input.clientId, input.ownerId)?.policy.mode !== "full_access") {
      throw new Error("Batch edits under this remote policy require an updated remote client; no command fallback was executed.");
    }
    const currentClient = getRemoteClient(input.clientId, input.ownerId);
    if (!currentClient) throw new Error("Remote client not found");
    const params = input.params || {};
    const safety = validateUserRemoteRequest(input.action, params);
    if (currentClient.permissionMode === "user" && !safety.allowed) {
      throw new Error(safety.reason || "Remote file operation denied");
    }
    const fileAuthorization = authorizeRemoteAction(currentClient, input.action, params);
    if (!fileAuthorization.allowed) throw new Error(fileAuthorization.reason || "Remote file operation denied");
    if (fileAuthorization.requiresApproval && !authorization.requiresApproval) {
      throw new Error("Remote file operation now requires confirmation");
    }
    const command = legacyFileCommand(currentClient, input.action, params);
    const commandAuthorization = authorizeRemoteAction(currentClient, "execute_command", { command });
    if (!commandAuthorization.allowed) throw new Error(commandAuthorization.reason || "Legacy file command denied");
    // This is only the exact file operation authorized above. Its one-time file
    // approval covers the transport fallback, never a caller-supplied command.
    // Command permission and the exact allowlist still apply independently.
    if (commandAuthorization.requiresApproval && !authorization.requiresApproval) {
      throw new Error("Legacy file command requires confirmation");
    }
    return send("execute_command", { command }).then(result => {
      if (input.action === "edit_file" && result && typeof result === "object" && "stdout" in result) {
        try { return JSON.parse(String(result.stdout).trim()); }
        catch { throw new Error("Legacy file edit returned no valid result; check the file before retrying"); }
      }
      return result;
    });
  });
  return resultPromise.then((result) => {
    if (audit) updateRemoteAudit(audit.id, {
      status: "completed",
      resultData: result && typeof result === "object"
        ? (input.action === "computer_use"
          ? Object.fromEntries(Object.entries(result as Record<string, unknown>).filter(([key]) => key !== "png"))
          : result as Record<string, unknown>)
        : { value: result },
      durationMs: Date.now() - startedAt,
    });
    publishDesktop("end");
    return result;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "Remote request failed";
    if (audit) updateRemoteAudit(audit.id, {
      status: /disconnected|timed out/i.test(message) ? "unknown" : "error",
      error: message,
      resultData: error instanceof Error ? (error as Error & { resultData?: Record<string, unknown> }).resultData : undefined,
      durationMs: Date.now() - startedAt,
    });
    publishDesktop("end");
    throw error;
  });
}

/** Internal agent calls wait on the visible card instead of returning an invisible ID. */
export async function requestRemoteClientWithApproval(
  input: Parameters<typeof requestRemoteClient>[0], signal?: AbortSignal,
) {
  try {
    return await requestRemoteClient(input);
  } catch (error) {
    if (!(error instanceof RemoteApprovalRequiredError)
      || !(await waitForRemoteApproval(input, error.approvalId, signal))) throw error;
    return requestRemoteClient({ ...input, approvalId: error.approvalId });
  }
}

export async function collectRemoteClientEvents(sessionId: string, waitMs = 150) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(waitMs, 1_000))));
  const events = gatewayState.events.get(sessionId) || [];
  gatewayState.events.delete(sessionId);
  return events;
}

function redact(params?: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveData(params || {}, 2_000) as Record<string, unknown>;
}

function base64(value: unknown) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function legacyFileCommand(client: { os?: string }, action: string, params: Record<string, unknown>) {
  if (action === "edit_file") {
    const program = Buffer.from(buildFileEditProgram(params), "utf8").toString("base64");
    const command = `node -e "eval(Buffer.from(\'${program}\',\'base64\').toString(\'utf8\'))"`;
    if (client.os?.toLowerCase().includes("win") && command.length > 7500) {
      throw new Error("This edit requires an updated remote client; the legacy Windows command is too large.");
    }
    return command;
  }
  const file = base64(params.path);
  const content = base64(params.content);
  const script = action === "write_file"
    ? `const f=Buffer.from('${file}','base64').toString(),c=Buffer.from('${content}','base64');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,c)`
    : `fs.rmSync(Buffer.from('${file}','base64').toString())`;
  const command = `node -e "const fs=require('fs'),path=require('path');${script}"`;
  return client.os?.toLowerCase().includes("win")
    ? command
    : command;
}
