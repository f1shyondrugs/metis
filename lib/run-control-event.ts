export type ModelSwitchPart = {
  type: "model-switch";
  id: string;
  fromModelId: string;
  toModelId: string;
  timestamp: string;
  fromReasoning?: string | null;
  toReasoning?: string | null;
  fromContext?: string | null;
  toContext?: string | null;
  reason?: "chain-usage" | "chain-unavailable";
  chainName?: string;
};

export type ProviderWaitPart = {
  type: "provider-wait";
  id: string;
  resetAt: string;
  detectedAt: string;
  detail: string;
};

export type RunControlPart = ModelSwitchPart | ProviderWaitPart;

export function parseRunControlEvent(value: unknown): RunControlPart | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const field = (key: string) => typeof v[key] === "string" && (v[key] as string).length <= 8000;
  if (!field("id") || !v.id) return null;
  if (v.type === "model-switch" && field("fromModelId") && field("toModelId") && field("timestamp")) {
    const reasoning = (v.fromReasoning === null || field("fromReasoning"))
      && (v.toReasoning === null || field("toReasoning"))
      ? { fromReasoning: v.fromReasoning as string | null, toReasoning: v.toReasoning as string | null }
      : {};
    const context = (v.fromContext === null || field("fromContext"))
      && (v.toContext === null || field("toContext"))
      ? { fromContext: v.fromContext as string | null, toContext: v.toContext as string | null }
      : {};
    return { ...reasoning, ...context, type: v.type, id: v.id as string, fromModelId: v.fromModelId as string, toModelId: v.toModelId as string, timestamp: v.timestamp as string, ...((v.reason === "chain-usage" || v.reason === "chain-unavailable") ? { reason: v.reason, ...(field("chainName") ? { chainName: v.chainName as string } : {}) } : {}) };
  }
  if (v.type === "provider-wait" && field("resetAt") && field("detectedAt") && field("detail")) {
    return { type: v.type, id: v.id as string, resetAt: v.resetAt as string, detectedAt: v.detectedAt as string, detail: v.detail as string };
  }
  return null;
}
