import { isTransientProviderError, providerErrorEvidence } from "@/lib/provider-retry";
import { isProviderUsageLimit, providerRateLimit } from "@/lib/provider-rate-limit";

export type ModelChainFailure = "usage" | "unavailable";
/** Only provider exhaustion and availability failures may advance a chain. */
export function modelChainFailure(error:unknown):ModelChainFailure|null {
  const evidence=providerErrorEvidence(error);
  const message=evidence.map(r=>typeof r.message==="string"?r.message:"").join("\n");
  if(/\b(?:MCP|Metis gateway|gateway tools|tool call|database|SQLite)\b/i.test(message)
    || evidence.some(r=>typeof r.toolName==="string"||typeof r.toolCallId==="string"))return null;
  const statuses=evidence.map(r=>Number(r.statusCode??r.status)).filter(Number.isFinite);
  if(statuses.some(s=>[401,403].includes(s)))return null;
  const codes=evidence.map(r=>String(r.code??r.type??r.error_code??""));
  if(codes.some(c=>/^(?:invalid_api_key|authentication_error|permission_denied|permission_error|invalid_request_error|context_length_exceeded|content_policy_violation)$/i.test(c)))return null;
  if(codes.some(c=>/^(?:insufficient_quota|credits_required|billing_hard_limit_reached|usage_limit_reached|usage_limit_exceeded|quota_exceeded)$/i.test(c))
    || providerRateLimit(error)!==null
    || evidence.some(isProviderUsageLimit)&&/\b(?:usage|quota|credits?|allowance)\b/i.test(message))return "usage";
  if(isTransientProviderError(error)
    || codes.some(c=>/^(?:model_not_found|model_unavailable|model_not_available|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)$/i.test(c))
    || /\b(?:stream (?:was )?disconnected|connection (?:was )?(?:refused|reset|closed)|network (?:is )?unreachable|connect(?:ion)? timed out)\b/i.test(message))return "unavailable";
  return null;
}
