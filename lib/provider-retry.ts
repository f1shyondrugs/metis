import { isProviderUsageLimit } from "@/lib/provider-rate-limit";

/** Metis retry policy, separate from provider usage windows and SDK metadata. */
export const MAX_PROVIDER_RETRIES = 3;

export type ProviderRetryPart = {
  type: "provider-retry";
  id: string;
  attempt: number;
  maxRetries: number;
  message: string;
  detail: string;
};

export function providerErrorEvidence(error: unknown): Array<Record<string, unknown>> {
  const evidence: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || depth > 6 || seen.has(value)) return;
    seen.add(value);
    if (typeof value === "string") {
      evidence.push({ message: value });
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    evidence.push(record);
    for (const key of ["cause", "error", "data"]) visit(record[key], depth + 1);
    if (typeof record.responseBody === "string") {
      try { visit(JSON.parse(record.responseBody), depth + 1); } catch { /* Not JSON. */ }
    }
  };
  visit(error, 0);
  return evidence;
}

/** Diagnostic classification only; the run retry policy accepts all run errors. */
export function isTransientProviderError(error: unknown): boolean {
  const evidence = providerErrorEvidence(error);
  const messages = evidence.map(record => typeof record.message === "string" ? record.message : "").join("\n");
  if (/\b(?:MCP|Metis gateway|gateway tools|tool call|database|SQLite)\b/i.test(messages)) return false;
  if (evidence.some(record => typeof record.toolName === "string" || typeof record.toolCallId === "string"
    || /(?:ToolExecution|ToolCall|Mcp)/i.test(String(record.name ?? "")))) return false;
  if (evidence.some(isProviderUsageLimit)) return false;
  const statuses = evidence.map(record => Number(record.statusCode ?? record.status)).filter(Number.isFinite);
  if (statuses.some(status => status >= 400 && status < 500 && status !== 408)) return false;
  const codes = evidence.map(record => String(record.code ?? record.type ?? record.error_code ?? ""));
  if (codes.some(code => /^(?:insufficient_quota|credits_required|billing_hard_limit_reached|invalid_api_key|authentication_error|permission_denied|permission_error|invalid_request_error)$/i.test(code))) return false;
  return statuses.some(status => [408, 500, 502, 503, 504, 529].includes(status))
    || codes.some(code => /^(?:overloaded_error|server_error|service_unavailable|temporarily_unavailable|model_overloaded|model_under_capacity|capacity_exceeded|ECONNRESET|ETIMEDOUT|EAI_AGAIN)$/i.test(code))
    || /\b(?:model is (?:under|over) capacity|model (?:is )?(?:overloaded|temporarily unavailable)|server (?:is )?(?:overloaded|temporarily unavailable)|service (?:is )?temporarily unavailable)\b/i.test(messages);
}

export function providerRetryDetail(error: unknown): string {
  const messages = providerErrorEvidence(error).flatMap(record =>
    typeof record.message === "string" && record.message.trim() ? [record.message.trim()] : []);
  return [...new Set(messages)].join("\n\n").slice(0, 8000) || "Run failed without error details.";
}
