import type { ProviderRateLimit } from "./provider-rate-limit";

export type ProviderResetWait = { jobId: string; resetAt: string; detectedAt: string };

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value));
}

export function parseProviderResetWait(value: unknown): ProviderResetWait | null {
  if (!value || typeof value !== "object") return null;
  const wait = value as Record<string, unknown>;
  if (typeof wait.jobId !== "string" || !wait.jobId.trim() || wait.jobId.length > 200 ||
      !validTimestamp(wait.resetAt) || !validTimestamp(wait.detectedAt)) return null;
  return { jobId: wait.jobId, resetAt: wait.resetAt, detectedAt: wait.detectedAt };
}

export function providerResetWaitFromJob(job: {
  id: string; status: string; providerRateLimit?: ProviderRateLimit;
} | null): ProviderResetWait | null {
  return job?.status === "queued" && job.providerRateLimit
    ? parseProviderResetWait({ jobId: job.id, ...job.providerRateLimit }) : null;
}

export function providerResetWaitLabel(resetAt: string, now = Date.now(), timeZone?: string) {
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(reset)) return "Resume time unavailable";
  if (reset <= now) return "Resuming…";
  const day = (value: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(value);
    const field = (type: string) => parts.find(part => part.type === type)?.value || "";
    return field("year") + "-" + field("month") + "-" + field("day");
  };
  const today = day(now);
  const [year, month, date] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  const resetDay = day(reset);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(reset);
  const when = resetDay === today ? "today" : resetDay === tomorrow ? "tomorrow"
    : "on " + new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(reset);
  return "Resumes " + when + " at " + time;
}
