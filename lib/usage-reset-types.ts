export type UsageResetCredit = {
  id: string; title: string; description?: string; resetType: string; status: string;
  grantedAt?: string; expiresAt?: string | null;
};
export type UsageResetHistory = {
  id: string; connectionId: string; accountLabel: string; title: string; status: string;
  requestedAt: string; completedAt?: string; retryable: boolean;
};
export type UsageResetSnapshot = {
  connectionId: string; accountLabel: string; status: "live" | "unavailable";
  reason?: string; availableCount: number | null; credits: UsageResetCredit[];
  history: UsageResetHistory[]; fetchedAt: string;
};
export type UsageResetConfirmation = {
  id: string; token: string; expiresAt: string; connectionId: string; accountLabel: string;
  credit: UsageResetCredit; retry: boolean;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function date(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const ms = value * 1000;
  return Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString() : undefined;
}
export function parseResetCredits(value: unknown): { availableCount: number; credits: UsageResetCredit[]; detailsAvailable: boolean } | null {
  const data = record(value);
  if (!data || !Number.isSafeInteger(data.availableCount) || Number(data.availableCount) < 0) return null;
  const credits: UsageResetCredit[] = [];
  for (const raw of Array.isArray(data.credits) ? data.credits.slice(0, 500) : []) {
    const item = record(raw);
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 500) continue;
    const expiresAt = item.expiresAt === null ? null : date(item.expiresAt);
    credits.push({
      id: item.id, title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, 200) : "Usage limit reset",
      ...(typeof item.description === "string" ? { description: item.description.slice(0, 1000) } : {}),
      resetType: typeof item.resetType === "string" ? item.resetType : "unknown",
      status: item.expiresAt !== undefined && item.expiresAt !== null && expiresAt === undefined ? "unknown" : typeof item.status === "string" ? item.status : "unknown",
      ...(date(item.grantedAt) ? { grantedAt: date(item.grantedAt) } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  }
  return { availableCount: Number(data.availableCount), credits, detailsAvailable: Array.isArray(data.credits) };
}
export function resetCreditUsable(credit: UsageResetCredit, now = Date.now()) {
  return credit.status === "available" && credit.resetType === "codexRateLimits" &&
    (credit.expiresAt == null || Date.parse(credit.expiresAt) > now);
}
export function resetOutcomeLabel(status: string) {
  return ({ reset: "Reset used", alreadyRedeemed: "Reset already completed", nothingToReset: "No eligible limit to reset",
    noCredit: "No reset available", pending: "In progress", unknown: "Result not confirmed", failed: "Not applied" } as Record<string, string>)[status] || "Result unavailable";
}
