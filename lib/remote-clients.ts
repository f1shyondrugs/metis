import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase, isSqliteBusyError, transaction } from "@/lib/sqlite";
import { queueRemotePresence, getRemotePresence } from "@/lib/remote-presence";
import { applyRuntimeCapabilities, normalizePermissionMode, validateUserRemoteRequest, type RemotePermissionMode } from "@/lib/remote-security";
import { redactSensitiveData } from "@/lib/agent-trace";

export type RemotePolicyMode = "restricted" | "approval_required" | "full_access";
export type RemoteClientStatus = "online" | "offline" | "revoked";
export type RemoteAction =
  | "get_info"
  | "list_directory"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "execute_command"
  | "pty_open"
  | "pty_input"
  | "pty_resize"
  | "pty_close"
  | "computer_use";

export const REMOTE_PERMISSIONS = [
  "get_info", "list_directory", "read_file", "write_file", "edit_file",
  "delete_file", "execute_command", "terminal", "computer_use",
] as const;
export type RemotePermission = (typeof REMOTE_PERMISSIONS)[number];

export type RemotePolicy = {
  mode: RemotePolicyMode;
  allowlist: string[];
  permissions: RemotePermission[];
};

export const DEFAULT_REMOTE_POLICY: RemotePolicy = {
  mode: "full_access",
  allowlist: [],
  permissions: [...REMOTE_PERMISSIONS],
};

export function normalizeRemoteAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

export function normalizeRemotePolicy(policy?: Partial<RemotePolicy> | null): RemotePolicy {
  const mode = policy?.mode === "restricted" || policy?.mode === "approval_required" || policy?.mode === "full_access"
    ? policy.mode : DEFAULT_REMOTE_POLICY.mode;
  const legacyPermissions = mode === "full_access" ? [...REMOTE_PERMISSIONS] : DEFAULT_REMOTE_POLICY.permissions;
  return {
    mode,
    allowlist: normalizeRemoteAllowlist(policy?.allowlist),
    permissions: Array.isArray(policy?.permissions)
      ? REMOTE_PERMISSIONS.filter((permission) => policy.permissions?.includes(permission))
      : legacyPermissions,
  };
}

export function getGlobalRemoteAllowlist(ownerId: string): string[] {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ? AND owner_id = ?")
    .get(`remote-allowlist:${ownerId}`, ownerId) as { data?: string } | undefined;
  return normalizeRemoteAllowlist(safeJson(row?.data, []));
}

export function setGlobalRemoteAllowlist(ownerId: string, value: unknown): string[] {
  const allowlist = normalizeRemoteAllowlist(value);
  getDatabase().prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run(`remote-allowlist:${ownerId}`, ownerId, JSON.stringify(allowlist));
  return allowlist;
}

export type RemoteClient = {
  id: string;
  ownerId: string;
  name: string;
  status: RemoteClientStatus;
  os?: string;
  architecture?: string;
  version?: string;
  hostname?: string;
  address?: string;
  capabilities: string[];
  permissionMode: RemotePermissionMode;
  policy: RemotePolicy;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type RemoteAuditEntry = {
  id: string;
  ownerId: string;
  clientId?: string;
  source: "user" | "agent" | "client";
  action: string;
  requestData: Record<string, unknown>;
  status: "requested" | "running" | "approved" | "completed" | "denied" | "error" | "unknown";
  resultData?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
  createdAt: string;
};

export type RemoteApproval = {
  id: string;
  ownerId: string;
  clientId: string;
  action: RemoteAction;
  argsHash: string;
  requestData: Record<string, unknown>;
  source: "user" | "agent";
  runId?: string;
  toolCallId?: string;
  expiresAt: string;
  approvedAt?: string;
  consumedAt?: string;
  createdAt: string;
};

const iso = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const REMOTE_SEEN_WRITE_INTERVAL_MS = 60_000;
const remoteSeenWrittenAt = new Map<string, number>();

function ignoreBusyTelemetry(error: unknown, operation: string) {
  if (!isSqliteBusyError(error)) throw error;
  console.warn(`[remote-client] sqlite busy; skipped ${operation}`);
}
const safeJson = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function remoteArgsHash(params?: Record<string, unknown>) {
  return hash(JSON.stringify(stableValue(params || {})));
}

export class RemoteApprovalRequiredError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string) {
    super("Remote action requires explicit user approval");
    this.name = "RemoteApprovalRequiredError";
    this.approvalId = approvalId;
  }
}

function mapClient(row: Record<string, unknown>): RemoteClient {
  return {
    id: String(row.id),
    ownerId: String(row.ownerId),
    name: String(row.name),
    status: row.revokedAt ? "revoked" : (String(row.status) === "online" && (!row.lastSeenAt || Date.now() - Date.parse(String(row.lastSeenAt)) > 90_000) ? "offline" : String(row.status) as RemoteClientStatus),
    ...(row.os ? { os: String(row.os) } : {}),
    ...(row.architecture ? { architecture: String(row.architecture) } : {}),
    ...(row.version ? { version: String(row.version) } : {}),
    ...(row.hostname ? { hostname: String(row.hostname) } : {}),
    ...(row.address ? { address: String(row.address) } : {}),
    capabilities: safeJson<string[]>(row.capabilities, []),
    permissionMode: normalizePermissionMode(row.permissionMode),
    policy: normalizeRemotePolicy(safeJson<RemotePolicy>(row.policy, DEFAULT_REMOTE_POLICY)),
    ...(row.lastSeenAt ? { lastSeenAt: String(row.lastSeenAt) } : {}),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
  };
}

export function createEnrollmentToken(ownerId: string, ttlMs = 15 * 60 * 1000, permissionMode: RemotePermissionMode = "user") {
  const token = `${permissionMode === "admin" ? "a" : "u"}_${randomBytes(32).toString("base64url")}`;
  const createdAt = iso();
  getDatabase().prepare(
    "INSERT INTO remote_enrollment_tokens (token_hash, owner_id, expires_at, created_at, permission_mode) VALUES (?, ?, ?, ?, ?)",
  ).run(hash(token), ownerId, new Date(Date.now() + ttlMs).toISOString(), createdAt, permissionMode);
  return { token, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

export function consumeEnrollmentToken(token: string, permissionMode: RemotePermissionMode = "user") {
  return transaction(() => {
    const row = getDatabase().prepare(
      "SELECT token_hash as tokenHash, owner_id as ownerId, expires_at as expiresAt, used_at as usedAt, permission_mode as permissionMode FROM remote_enrollment_tokens WHERE token_hash = ?",
    ).get(hash(token)) as { tokenHash?: string; ownerId?: string; expiresAt?: string; usedAt?: string; permissionMode?: string } | undefined;
    if (!row?.ownerId || row.usedAt || !row.expiresAt || new Date(row.expiresAt).getTime() <= Date.now() || row.permissionMode !== permissionMode) return null;
    getDatabase().prepare("UPDATE remote_enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .run(iso(), row.tokenHash!);
    return { ownerId: row.ownerId };
  });
}

export function registerRemoteClient(token: string, input: {
  name?: string;
  os?: string;
  architecture?: string;
  version?: string;
  hostname?: string;
  capabilities?: string[];
  permissionMode?: RemotePermissionMode;
}) {
  const enrollment = consumeEnrollmentToken(token, normalizePermissionMode(input.permissionMode));
  if (!enrollment) return null;
  const id = randomUUID();
  const credential = randomBytes(32).toString("base64url");
  const now = iso();
  getDatabase().prepare(
    `INSERT INTO remote_clients
      (id, owner_id, name, status, os, architecture, version, hostname, capabilities, policy, permission_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    enrollment.ownerId,
    input.name?.trim() || input.hostname?.trim() || "Remote client",
    input.os?.trim() || null,
    input.architecture?.trim() || null,
    input.version?.trim() || null,
    input.hostname?.trim() || null,
    JSON.stringify(input.capabilities?.slice(0, 64) || []),
    JSON.stringify(DEFAULT_REMOTE_POLICY),
    normalizePermissionMode(input.permissionMode),
    now,
    now,
  );
  getDatabase().prepare(
    "INSERT INTO remote_client_credentials (id, client_id, secret_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run(randomUUID(), id, hash(credential), now);
  return { client: getRemoteClient(id, enrollment.ownerId), credential };
}

// Expose the accepted live heartbeat immediately while its durable write waits.
// Policies, ownership and revocation always come from the database.
function withPresence(client:RemoteClient):RemoteClient {
 const update=getRemotePresence(client.id,client.ownerId);
 if(!update || client.status==="revoked" || (client.lastSeenAt && client.lastSeenAt>update.at))return client;
 const capabilities=update.status==="online" ? applyRuntimeCapabilities(client.capabilities,update) : client.capabilities;
 return {...client,status:update.status,capabilities,
  ...(update.status==="online"?{lastSeenAt:update.at}:{}),
  ...(update.address?{address:update.address}:{}),
  updatedAt:client.updatedAt>update.at?client.updatedAt:update.at};
}
export function listRemoteClients(ownerId: string) {
  return (getDatabase().prepare(
    `SELECT id, owner_id as ownerId, name, status, os, architecture, version, hostname,
            address, capabilities, policy, permission_mode as permissionMode, last_seen_at as lastSeenAt, created_at as createdAt,
            updated_at as updatedAt, revoked_at as revokedAt
     FROM remote_clients WHERE owner_id = ? ORDER BY updated_at DESC`,
  ).all(ownerId) as Array<Record<string, unknown>>).map(row=>withPresence(mapClient(row)));
}

export function getRemoteClient(id: string, ownerId?: string) {
  const row = getDatabase().prepare(
    `SELECT id, owner_id as ownerId, name, status, os, architecture, version, hostname,
            address, capabilities, policy, permission_mode as permissionMode, last_seen_at as lastSeenAt, created_at as createdAt,
            updated_at as updatedAt, revoked_at as revokedAt
     FROM remote_clients WHERE id = ? AND (? IS NULL OR owner_id = ?)`,
  ).get(id, ownerId ?? null, ownerId ?? null) as Record<string, unknown> | undefined;
  return row ? withPresence(mapClient(row)) : null;
}

export function authenticateRemoteClient(id: string, credential: string, markSeen = true) {
  const row = getDatabase().prepare(
    `SELECT c.id, c.owner_id as ownerId, c.status, c.revoked_at as revokedAt,
            r.secret_hash as secretHash
     FROM remote_clients c JOIN remote_client_credentials r ON r.client_id = c.id
     WHERE c.id = ? AND r.revoked_at IS NULL
     ORDER BY r.created_at DESC LIMIT 1`,
  ).get(id) as { id?: string; ownerId?: string; status?: string; revokedAt?: string; secretHash?: string } | undefined;
  if (!row?.ownerId || row.revokedAt || !row.secretHash) return null;
  const actual = Buffer.from(hash(credential));
  const expected = Buffer.from(row.secretHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  if (markSeen) {
    const at=iso();
    queueRemotePresence({clientId:id,ownerId:row.ownerId,status:"online",at,
      credentialHash:row.secretHash,credentialUsedAt:at});
    markRemoteClientSeen(id, undefined, true);
  }
  return { clientId: id, ownerId: row.ownerId };
}

export function markRemoteClientSeen(id: string, address?: string, force = false) {
  const nowMs = Date.now();
  const lastWrittenAt = remoteSeenWrittenAt.get(id) || 0;
  if (!force && nowMs - lastWrittenAt < REMOTE_SEEN_WRITE_INTERVAL_MS) return false;
  const client=getRemoteClient(id);
  if(!client || client.status==="revoked")return false;
  const queued=queueRemotePresence({clientId:id,ownerId:client.ownerId,status:"online",at:new Date(nowMs).toISOString(),...(address?{address}:{})});
  if(queued)remoteSeenWrittenAt.set(id,nowMs);
  return queued;
}

export function updateRemoteClientDesktopCapability(id: string, available: boolean) {
  const client = getRemoteClient(id);
  if (!client) return false;
  const current = client.capabilities.includes("desktop_gui");
  if (current === available) return true;
  return queueRemotePresence({clientId:id,ownerId:client.ownerId,status:"online",at:iso(),desktopGui:available});
}

export function updateRemoteClientOverlayCapability(id: string, available: boolean) {
  const client = getRemoteClient(id);
  if (!client || client.status === "revoked") return false;
  if (client.capabilities.includes("overlay_annotations") === available) return true;
  return queueRemotePresence({clientId:id,ownerId:client.ownerId,status:"online",at:iso(),overlayAnnotations:available});
}

export function markRemoteClientOffline(id: string) {
  remoteSeenWrittenAt.delete(id);
  const client=getRemoteClient(id);
  if(!client || client.status==="revoked")return false;
  return queueRemotePresence({clientId:id,ownerId:client.ownerId,status:"offline",at:iso()});
}

export function updateRemoteClient(id: string, ownerId: string, patch: {
  name?: string;
  policy?: Partial<RemotePolicy>;
}) {
  const current = getRemoteClient(id, ownerId);
  if (!current) return null;
  const nextPolicy = patch.policy ? normalizeRemotePolicy({ ...current.policy, ...patch.policy }) : current.policy;
  getDatabase().prepare(
    "UPDATE remote_clients SET name = ?, policy = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
  ).run(patch.name?.trim() || current.name, JSON.stringify(nextPolicy), iso(), id, ownerId);
  return getRemoteClient(id, ownerId);
}

export function revokeRemoteClient(id: string, ownerId: string) {
  const changed = getDatabase().prepare(
    "UPDATE remote_clients SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
  ).run(iso(), iso(), id, ownerId);
  getDatabase().prepare("UPDATE remote_client_credentials SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL")
    .run(iso(), id);
  return changed.changes > 0;
}

export function deleteRemoteClient(id: string, ownerId: string) {
  const changed = getDatabase().prepare(
    "DELETE FROM remote_clients WHERE id = ? AND owner_id = ?",
  ).run(id, ownerId);
  return changed.changes > 0;
}

export function authorizeRemoteAction(client: RemoteClient, action: RemoteAction, commandOrParams?: string | Record<string, unknown>) {
  const params = typeof commandOrParams === "string" ? { command: commandOrParams } : (commandOrParams || {});
  if (client.status === "revoked") return { allowed: false, requiresApproval: false, reason: "Client is revoked" };

  const permission = (action.startsWith("pty_") ? "terminal" : action) as RemotePermission;
  if (action === "computer_use" && !client.policy.permissions.includes("computer_use")) {
    return { allowed: false, requiresApproval: false, reason: "Computer Use is switched off for this device" };
  }
  if (action === "computer_use" && !client.capabilities.includes("desktop_gui")) {
    return { allowed: false, requiresApproval: false, reason: "This device has no interactive GUI" };
  }
  if (client.policy.mode !== "full_access" && !client.policy.permissions.includes(permission)) {
    return { allowed: false, requiresApproval: false, reason: `Permission ${permission} is disabled for this device` };
  }
  const safety = validateUserRemoteRequest(action, params);
  if (client.permissionMode === "user" && !safety.allowed) {
    return { allowed: false, requiresApproval: false, reason: safety.reason };
  }
  if (client.permissionMode === "user" && permission === "terminal") {
    return { allowed: false, requiresApproval: false, reason: "Interactive terminal requires administrator access" };
  }
  if (action === "execute_command" && client.policy.mode !== "full_access") {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    const allowed = [...client.policy.allowlist, ...getGlobalRemoteAllowlist(client.ownerId)].includes(command);
    if (!allowed) return { allowed: false, requiresApproval: false, reason: "Command is not in the device or global allowlist" };
  }
  const sensitive = ["write_file", "edit_file", "delete_file", "execute_command", "terminal"].includes(permission);
  if (action === "computer_use") return { allowed: true, requiresApproval: false };
  const requiresApproval = sensitive && (client.policy.mode === "approval_required"
    || (client.policy.mode === "restricted" && client.permissionMode === "admin"));
  return {
    allowed: true,
    requiresApproval,
    ...(requiresApproval ? { reason: "Remote action requires confirmation" } : {}),
  };
}

export function createRemoteApproval(input: {
  ownerId: string;
  clientId: string;
  action: RemoteAction;
  params?: Record<string, unknown>;
  source?: "user" | "agent";
  runId?: string;
  toolCallId?: string;
  ttlMs?: number;
}) {
  const client = getRemoteClient(input.clientId, input.ownerId);
  if (!client) throw new Error("Remote client not found");
  const authorization = authorizeRemoteAction(
    client,
    input.action,
    input.params,
  );
  if (!authorization.allowed) throw new Error(authorization.reason || "Remote action denied");
  const id = randomUUID();
  const createdAt = iso();
  const expiresAt = new Date(Date.now() + Math.max(5_000, Math.min(input.ttlMs || 5 * 60_000, 15 * 60_000))).toISOString();
  getDatabase().prepare(
    `INSERT INTO remote_approval_requests
      (id, owner_id, client_id, action, args_hash, request_data, source, run_id, tool_call_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    input.clientId,
    input.action,
    remoteArgsHash(input.params),
    JSON.stringify(input.params || {}),
    input.source || "user",
    input.runId ?? null,
    input.toolCallId ?? null,
    expiresAt,
    createdAt,
  );
  appendRemoteAudit({
    ownerId: input.ownerId,
    clientId: input.clientId,
    source: input.source || "user",
    action: input.action,
    requestData: redactRemoteData(input.params),
    status: "requested",
  });
  return { id, expiresAt };
}

export function remoteApprovalScope(clientId: string, action: RemoteAction, params?: Record<string, unknown>) {
  return `remote:${clientId}:${action}:${remoteArgsHash(params)}`;
}

export function getRemoteApproval(id: string, ownerId: string): RemoteApproval | null {
  const row = getDatabase().prepare(
    "SELECT * FROM remote_approval_requests WHERE id = ? AND owner_id = ?",
  ).get(id, ownerId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), ownerId: String(row.owner_id), clientId: String(row.client_id),
    action: row.action as RemoteAction, argsHash: String(row.args_hash),
    requestData: safeJson(row.request_data, {}),
    source: row.source as RemoteApproval["source"],
    ...(row.run_id ? { runId: String(row.run_id) } : {}),
    ...(row.tool_call_id ? { toolCallId: String(row.tool_call_id) } : {}),
    expiresAt: String(row.expires_at), createdAt: String(row.created_at),
    ...(row.approved_at ? { approvedAt: String(row.approved_at) } : {}),
    ...(row.consumed_at ? { consumedAt: String(row.consumed_at) } : {}),
  };
}

export function findApprovedRemoteApproval(input: {
  ownerId: string; clientId: string; action: RemoteAction;
  params?: Record<string, unknown>; runId: string;
}) {
  const row = getDatabase().prepare(
    `SELECT id FROM remote_approval_requests
     WHERE owner_id = ? AND client_id = ? AND action = ? AND args_hash = ? AND run_id = ?
       AND approved_at IS NOT NULL AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(input.ownerId, input.clientId, input.action, remoteArgsHash(input.params), input.runId, iso()) as { id?: string } | undefined;
  return row?.id;
}

export function denyRemoteApproval(id: string, ownerId: string) {
  return getDatabase().prepare(
    "UPDATE remote_approval_requests SET expires_at = ?, consumed_at = ? WHERE id = ? AND owner_id = ? AND consumed_at IS NULL",
  ).run(iso(), iso(), id, ownerId).changes > 0;
}

export function approveRemoteApproval(id: string, ownerId: string) {
  const approvedAt = iso();
  // A visible chat prompt can wait indefinitely. The one-time execution grant
  // starts its short validity window only after the owner makes a decision.
  const chatApproval = getDatabase().prepare(
    "SELECT id FROM pending_approvals WHERE id = ? AND owner_id = ? AND (status = 'waiting_for_user' OR (status = 'resolved' AND decision IN ('allow', 'allow-session')))",
  ).get(id, ownerId);
  const grantExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const result = getDatabase().prepare(
    `UPDATE remote_approval_requests
     SET approved_at = ?, expires_at = CASE WHEN ? THEN ? ELSE expires_at END
     WHERE id = ? AND owner_id = ? AND approved_at IS NULL AND consumed_at IS NULL
       AND (expires_at > ? OR ?)`,
  ).run(approvedAt, chatApproval ? 1 : 0, grantExpiresAt, id, ownerId, approvedAt, chatApproval ? 1 : 0);
  return result.changes > 0;
}

export function consumeRemoteApproval(input: {
  id: string;
  ownerId: string;
  clientId: string;
  action: RemoteAction;
  params?: Record<string, unknown>;
}) {
  const consumedAt = iso();
  const result = getDatabase().prepare(
    `UPDATE remote_approval_requests
     SET consumed_at = ?
     WHERE id = ? AND owner_id = ? AND client_id = ? AND action = ?
       AND args_hash = ? AND approved_at IS NOT NULL AND consumed_at IS NULL
       AND expires_at > ?`,
  ).run(
    consumedAt,
    input.id,
    input.ownerId,
    input.clientId,
    input.action,
    remoteArgsHash(input.params),
    consumedAt,
  );
  return result.changes > 0;
}

let lastAuditCleanupAt = 0;
export function appendRemoteAudit(input: Omit<RemoteAuditEntry, "id" | "createdAt">) {
  const now = Date.now();
  if (now - lastAuditCleanupAt > 60 * 60_000) {
    lastAuditCleanupAt = now;
    const days = Math.max(1, Math.min(Number(process.env.REMOTE_AUDIT_RETENTION_DAYS) || 30, 365));
    try {
      getDatabase().prepare("DELETE FROM remote_audit WHERE created_at < ?")
        .run(new Date(now - days * 86_400_000).toISOString());
    } catch (error) {
      ignoreBusyTelemetry(error, "audit retention cleanup");
    }
  }
  const entry = { ...input, id: randomUUID(), createdAt: iso() };
  getDatabase().prepare(
    "INSERT INTO remote_audit (id, owner_id, client_id, source, action, request_data, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    entry.id,
    entry.ownerId,
    entry.clientId ?? null,
    entry.source,
    entry.action,
    JSON.stringify(entry.requestData),
    entry.status,
    entry.error ?? null,
    entry.createdAt,
  );
  return entry;
}

export function updateRemoteAudit(id: string, input: { status: RemoteAuditEntry["status"]; resultData?: Record<string, unknown>; error?: string; durationMs?: number }) {
  getDatabase().prepare(
    "UPDATE remote_audit SET status = ?, result_data = ?, error = ?, duration_ms = ? WHERE id = ?",
  ).run(input.status, JSON.stringify(redactRemoteData(input.resultData)), input.error ?? null, input.durationMs ?? null, id);
}

function redactRemoteData(params?: Record<string, unknown>) {
  return redactSensitiveData(params || {}, 2_000) as Record<string, unknown>;
}

export function listRemoteAudit(ownerId: string, clientId?: string) {
  return (getDatabase().prepare(
    `SELECT id, owner_id as ownerId, client_id as clientId, source, action, request_data as requestData,
            result_data as resultData, status, error, duration_ms as durationMs, created_at as createdAt FROM remote_audit
     WHERE owner_id = ? AND (? IS NULL OR client_id = ?) ORDER BY created_at DESC LIMIT 200`,
  ).all(ownerId, clientId ?? null, clientId ?? null) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    ownerId: String(row.ownerId),
    ...(row.clientId ? { clientId: String(row.clientId) } : {}),
    source: String(row.source) as RemoteAuditEntry["source"],
    action: String(row.action),
    requestData: safeJson<Record<string, unknown>>(row.requestData, {}),
    resultData: safeJson<Record<string, unknown>>(row.resultData, {}),
    status: String(row.status) as RemoteAuditEntry["status"],
    ...(row.durationMs != null ? { durationMs: Number(row.durationMs) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: String(row.createdAt),
  }));
}
