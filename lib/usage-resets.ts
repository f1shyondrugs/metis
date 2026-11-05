import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { getProviderConnection, listProviderConnections } from "@/lib/provider-connections";
import { PROVIDERS, getProviderDefinition } from "@/lib/providers/registry";
import { requestCodexAccount } from "@/lib/providers/codex-account";
import { parseResetCredits, resetCreditUsable, type UsageResetCredit, type UsageResetConfirmation, type UsageResetHistory, type UsageResetSnapshot } from "@/lib/usage-reset-types";

export class UsageResetError extends Error { constructor(message: string, public status = 400) { super(message); } }
type Action = {
  id: string; owner_id: string; connection_id: string; account_label: string; binding: string;
  credit_id: string; credit_json: string; idempotency_key: string; status: string;
  confirmation_hash: string | null; confirmation_expires_at: number | null;
  requested_at: number | null; completed_at: number | null;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function database() {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS usage_reset_actions (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, connection_id TEXT NOT NULL, account_label TEXT NOT NULL,
    binding TEXT NOT NULL, credit_id TEXT NOT NULL, credit_json TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL, confirmation_hash TEXT, confirmation_expires_at INTEGER,
    requested_at INTEGER, completed_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS usage_reset_active_credit ON usage_reset_actions(owner_id, connection_id, binding, credit_id)
    WHERE status IN ('ready','pending','unknown','reset','alreadyRedeemed');`);
  // A process may have stopped after sending the provider request. Never infer success or retry it automatically.
  db.prepare("UPDATE usage_reset_actions SET status='unknown', completed_at=? WHERE status='pending' AND requested_at<?")
    .run(Date.now(), Date.now() - 60_000);
  return db;
}
function connection(ownerId: string, id: string) {
  const item = getProviderConnection(id, ownerId);
  if (!item) throw new UsageResetError("Account connection not found.", 404);
  return item;
}
function supported(ownerId: string, id: string) {
  const item = connection(ownerId, id);
  const support = getProviderDefinition(item.providerKey)?.usageResets;
  if (!support || !support.authTypes.includes(item.authType)) throw new UsageResetError("This connection does not expose manual reset credits.", 409);
  if (!item.enabled || !item.hasSecret) throw new UsageResetError("Reconnect this account before using a reset.", 409);
  return item;
}
export function usageResetHistory(ownerId: string, connectionId?: string): UsageResetHistory[] {
  const rows = database().prepare(`SELECT * FROM usage_reset_actions WHERE owner_id=? AND requested_at IS NOT NULL
    ${connectionId ? "AND connection_id=?" : ""} ORDER BY requested_at DESC LIMIT 50`)
    .all(...(connectionId ? [ownerId, connectionId] : [ownerId])) as Action[];
  return rows.map(row => ({
    id: row.id, connectionId: row.connection_id, accountLabel: row.account_label,
    title: (JSON.parse(row.credit_json) as UsageResetCredit).title, status: row.status,
    requestedAt: new Date(row.requested_at!).toISOString(),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
    retryable: row.status === "unknown",
  }));
}
export function usageResetCatalog(ownerId: string) {
  return {
    providers: PROVIDERS.map(provider => ({ key: provider.key, name: provider.name,
      status: provider.usageResets ? "integrated" : "not_exposed",
      reason: provider.usageResets ? "Availability is checked for each connected account." : "This integration does not expose manual reset credits.",
      documentationUrl: provider.usageResets?.documentationUrl,
    })),
    connections: listProviderConnections(ownerId).map(item => ({
      id: item.id, label: item.label, providerName: getProviderDefinition(item.providerKey)?.name || item.providerKey,
      supported: Boolean(item.enabled && item.hasSecret && getProviderDefinition(item.providerKey)?.usageResets?.authTypes.includes(item.authType)),
    })),
    history: usageResetHistory(ownerId),
  };
}
async function read(ownerId: string, connectionId: string) {
  const item = supported(ownerId, connectionId);
  const response = await requestCodexAccount(ownerId, connectionId, { method: "account/rateLimits/read", params: { excludeResetCreditDetails: false } });
  const credits = parseResetCredits(response.result.rateLimitResetCredits);
  return { item, binding: response.binding, credits };
}
export async function getUsageResets(ownerId: string, connectionId: string): Promise<UsageResetSnapshot> {
  const item = connection(ownerId, connectionId);
  const base = { connectionId, accountLabel: item.label, history: usageResetHistory(ownerId, connectionId), fetchedAt: new Date().toISOString() };
  const support = getProviderDefinition(item.providerKey)?.usageResets;
  if (!support || !support.authTypes.includes(item.authType) || !item.enabled || !item.hasSecret) {
    return { ...base, status: "unavailable", reason: "Manual reset credits are not exposed by this account connection.", availableCount: null, credits: [] };
  }
  try {
    const live = await read(ownerId, connectionId);
    if (!live.credits) return { ...base, status: "unavailable", reason: "The provider did not return reset-credit availability for this account.", availableCount: null, credits: [] };
    return { ...base, status: "live", availableCount: live.credits.availableCount, credits: live.credits.credits };
  } catch {
    return { ...base, status: "unavailable", reason: "Live reset availability could not be checked. Reconnect the account or refresh. Your Metis history is still available.", availableCount: null, credits: [] };
  }
}
export async function prepareUsageReset(ownerId: string, connectionId: string, creditId?: string, retryId?: string): Promise<UsageResetConfirmation> {
  const live = await read(ownerId, connectionId);
  if (!live.credits) throw new UsageResetError("Reset availability is unknown. Refresh before trying again.", 409);
  let action: Action | undefined;
  let credit: UsageResetCredit | undefined;
  if (retryId) {
    action = database().prepare("SELECT * FROM usage_reset_actions WHERE id=? AND owner_id=? AND connection_id=?").get(retryId, ownerId, connectionId) as Action | undefined;
    if (!action || action.status !== "unknown" || action.binding !== live.binding) throw new UsageResetError("This previous request cannot be retried for the current account.", 409);
    credit = JSON.parse(action.credit_json) as UsageResetCredit;
  } else {
    credit = live.credits.credits.find(item => item.id === creditId);
    if (!credit || live.credits.availableCount < 1 || !resetCreditUsable(credit)) throw new UsageResetError("This reset is no longer available. Refresh the list.", 409);
    const found = database().prepare("SELECT * FROM usage_reset_actions WHERE owner_id=? AND connection_id=? AND binding=? AND credit_id=? AND status IN ('ready','pending','unknown','reset','alreadyRedeemed')")
      .get(ownerId, connectionId, live.binding, credit.id) as Action | undefined;
    if (found && found.status !== "ready") throw new UsageResetError("This reset already has a request. Check History before continuing.", 409);
    action = found;
  }
  const token = randomBytes(32).toString("base64url");
  const expires = Date.now() + 2 * 60_000;
  const id = action?.id || randomUUID();
  transaction(() => {
    if (action) {
      const changed = database().prepare("UPDATE usage_reset_actions SET confirmation_hash=?, confirmation_expires_at=?, binding=?, credit_json=?, account_label=? WHERE id=? AND owner_id=? AND status=?")
        .run(hash(token), expires, live.binding, JSON.stringify(credit), live.item.label, id, ownerId, action.status).changes;
      if (changed !== 1) throw new UsageResetError("The reset state changed. Refresh and review it again.", 409);
    } else {
      database().prepare("INSERT INTO usage_reset_actions(id,owner_id,connection_id,account_label,binding,credit_id,credit_json,idempotency_key,status,confirmation_hash,confirmation_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, ownerId, connectionId, live.item.label, live.binding, credit!.id, JSON.stringify(credit), randomUUID(), "ready", hash(token), expires);
    }
  });
  return { id, token, expiresAt: new Date(expires).toISOString(), connectionId, accountLabel: live.item.label, credit: credit!, retry: Boolean(retryId) };
}
export async function consumeUsageReset(ownerId: string, connectionId: string, id: string, token: string, confirmed: unknown) {
  if (confirmed !== true) throw new UsageResetError("Explicit confirmation is required.", 409);
  supported(ownerId, connectionId);
  let action!: Action;
  transaction(() => {
    const row = database().prepare("SELECT * FROM usage_reset_actions WHERE id=? AND owner_id=? AND connection_id=?").get(id, ownerId, connectionId) as Action | undefined;
    if (!row) throw new UsageResetError("Confirmation not found.", 404);
    if (!["ready", "unknown"].includes(row.status) || row.confirmation_hash !== hash(token) || !row.confirmation_expires_at || row.confirmation_expires_at < Date.now()) {
      throw new UsageResetError("This confirmation expired or was already used. Review the reset again.", 409);
    }
    action = row;
    database().prepare("UPDATE usage_reset_actions SET status='pending', confirmation_hash=NULL, confirmation_expires_at=NULL, requested_at=?, completed_at=NULL WHERE id=?")
      .run(Date.now(), id);
  });
  let consumptionStarted = false;
  let outcome: string;
  try {
    const live = await read(ownerId, connectionId);
    if (live.binding !== action.binding) throw new UsageResetError("The account changed. Review the reset again.", 409);
    if (action.status !== "unknown") {
      const current = live.credits?.credits.find(item => item.id === action.credit_id);
      if (!current || !live.credits || live.credits.availableCount < 1 || !resetCreditUsable(current)) throw new UsageResetError("The selected reset is no longer available.", 409);
    }
    consumptionStarted = true;
    const response = await requestCodexAccount(ownerId, connectionId, {
      method: "account/rateLimitResetCredit/consume", expectedBinding: action.binding,
      params: { creditId: action.credit_id, idempotencyKey: action.idempotency_key },
    });
    if (!["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(String(response.result.outcome))) throw new Error("Unknown provider result.");
    outcome = String(response.result.outcome);
    database().prepare("UPDATE usage_reset_actions SET status=?, completed_at=? WHERE id=? AND owner_id=?").run(outcome, Date.now(), id, ownerId);
  } catch (error) {
    database().prepare("UPDATE usage_reset_actions SET status=?, completed_at=? WHERE id=? AND owner_id=?")
      .run(consumptionStarted ? "unknown" : "failed", Date.now(), id, ownerId);
    throw new UsageResetError(consumptionStarted
      ? "The provider result could not be confirmed. Check History; retrying the same request requires a new confirmation and reuses its request ID."
      : error instanceof UsageResetError ? error.message : "Live reset availability could not be verified. No reset request was sent.", consumptionStarted ? 503 : 409);
  }
  // An applied reset remains successful even if refreshing the display subsequently fails.
  let snapshot: UsageResetSnapshot | null = null;
  try { snapshot = await getUsageResets(ownerId, connectionId); } catch { /* next manual refresh can recover */ }
  return { outcome, snapshot, history: usageResetHistory(ownerId, connectionId) };
}
