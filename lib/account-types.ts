export type ProfileLink = { label: string; url: string };
export type AccountProfile = {
  displayName: string; bio: string; avatar: string | null; links: ProfileLink[];
  shareId: string | null; shareActivity: boolean; handle: string | null;
  banner?: string | null;
};
export type AccountIdentity = Pick<AccountProfile, "displayName" | "avatar">;

export type UsageTotals = {
  requests: number; inputTokens: number; outputTokens: number; tokens: number;
  uncachedInputTokens?: number; uncachedInputReports?: number;
  cachedInputTokens?: number; cachedInputReports?: number;
  cacheWriteInputTokens?: number; cacheWriteInputReports?: number;
  unclassifiedInputTokens?: number; unclassifiedInputReports?: number;
  estimatedCostUsd?: number | null; estimatedCostReports?: number;
  costUsd: number | null; tokenReports: number; costReports: number; inputReports: number; outputReports: number;
};
export type UsageDay = UsageTotals & { date: string };
export type UsageModel = UsageTotals & { modelId: string; providerId: string; apiPrice?: import("./usage-cost-estimate").ApiPrice };
export type UsageBucket = { value: string | null; requests: number };
export type UsageConfigurationCounts = {
  context: UsageBucket[]; reasoning: UsageBucket[]; speed: UsageBucket[];
};
export type UsageModelDetails = UsageModel & {
  from: string; to: string; timezone: "UTC";
  configurations: UsageConfigurationCounts;
  days: Array<UsageDay & { configurations: UsageConfigurationCounts }>;
};
export type AccountUsage = {
  from: string; to: string; timezone: "UTC"; totals: UsageTotals; days: UsageDay[];
  providers?: Array<{id:string;name:string;requests:number}>;
  modelDays?: Record<string, UsageModel[]>;
  models: UsageModel[]; pricing?: { sourceUrl: string; checkedAt: string };
};
