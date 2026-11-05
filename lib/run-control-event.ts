export type ModelSwitchPart = {
  type: "model-switch";
  id: string;
  fromModelId: string;
  toModelId: string;
  timestamp: string;
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
    return { type: v.type, id: v.id as string, fromModelId: v.fromModelId as string, toModelId: v.toModelId as string, timestamp: v.timestamp as string };
  }
  if (v.type === "provider-wait" && field("resetAt") && field("detectedAt") && field("detail")) {
    return { type: v.type, id: v.id as string, resetAt: v.resetAt as string, detectedAt: v.detectedAt as string, detail: v.detail as string };
  }
  return null;
}
