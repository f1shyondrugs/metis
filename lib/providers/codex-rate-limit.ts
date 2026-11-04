import {readCodexThreadRolloutTail} from "./codex-context";
import { isProviderUsageLimit, providerErrorWithCause, providerRateLimit } from "@/lib/provider-rate-limit";

/** Native telemetry only: no assumed window size, plan, model family or timezone. */
export function codexResetFromRollout(tail: string, turnStartedAt: number, now = Date.now()): string | undefined {
  for (const line of tail.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      const observedAt = Date.parse(event.timestamp);
      if (event.type !== "event_msg" || event.payload?.type !== "token_count" ||
          !Number.isFinite(observedAt) || observedAt < turnStartedAt || observedAt > now) continue;
      const limits = event.payload.rate_limits;
      if (!limits || typeof limits !== "object") continue;
      const resets = Object.values(limits).flatMap(value => {
        if (!value || typeof value !== "object") return [];
        const window = value as { used_percent?: number; resets_at?: number };
        if (typeof window.used_percent !== "number" || window.used_percent < 100 ||
            typeof window.resets_at !== "number") return [];
        const reset = providerRateLimit({ code: "rate_limit_exceeded", resetAt: window.resets_at }, now);
        return reset ? [reset.resetAt] : [];
      });
      // A later authoritative snapshot supersedes older observations, including recovery.
      return resets.sort().at(-1);
    } catch { /* A bounded tail may start/end inside a line. */ }
  }
}
export function codexLimitErrorFromRollout(error: unknown, home: string, threadId: string, turnStartedAt: number): Error {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message : "Codex provider turn failed.";
  if (!isProviderUsageLimit(error) || providerRateLimit(error) || !/^[a-f0-9-]{36}$/i.test(threadId)) {
    return providerErrorWithCause(message, error);
  }
  try {
    const tail=readCodexThreadRolloutTail(home,threadId);
    if (tail!==undefined) {
      const resetAt = codexResetFromRollout(tail, turnStartedAt);
      if (resetAt) return providerErrorWithCause(message, { code: "rate_limit_exceeded", resetAt, cause: error });
    }
  } catch { /* Missing telemetry leaves the reset unknown. */ }
  return providerErrorWithCause(message, error);
}
