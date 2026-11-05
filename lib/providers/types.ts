export type ProviderKind =
  | "cursor-agent"
  | "ai-sdk"
  | "codex-agent"
  | "claude-agent"
  | "antigravity-agent"
  | "grok-agent"
  | "opencode-agent"
  | "compatible";

export type ProviderAuthType =
  | "api_key"
  | "account"
  | "oauth"
  | "vertex_adc"
  | "local";

export type ProviderCapabilities = {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  agent: boolean;
  modelDiscovery: boolean;
  reasoning?: boolean;
  fast?: boolean;
  mcp?: boolean;
  browser?: boolean;
  skills?: boolean;
  subagents?: boolean;
  usage?: boolean;
};

export type NumericModelParameter = { min: number; max: number; step: number; description?: string };

export type ProviderModelParameter = {
  id: string;
  displayName?: string;
  values: ReadonlyArray<{ value: string; displayName?: string }>;
  customNumber?: NumericModelParameter;
};

export type ProviderModelDefinition = {
  id: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  contextWindowSource?: "provider" | "runtime" | "stored-provider" | "registry" | "catalog" | "inferred";
  maxOutputTokens?: number;
  capabilities?: Partial<ProviderCapabilities>;
  tags?: string[];
  /** Provenance distinguishes advertised options from legacy inferred catalog snapshots. */
  parameterSource?: "provider" | "registry";
  parameters?: ReadonlyArray<ProviderModelParameter>;
  defaultParams?: ReadonlyArray<{ id: string; value: string }>;
};

export type ProviderDefinition = {
  /** Exact public API catalog references for monetary-value estimates, not billing. */
  apiPricing?: { providers: readonly string[]; inputIncludesCache: boolean };
  key: string;
  name: string;
  description: string;
  kind: ProviderKind;
  authTypes: ProviderAuthType[];
  defaultBaseUrl?: string;
  capabilities: ProviderCapabilities;
  models: ProviderModelDefinition[];
  /** CLI configuration options available across this provider, independent of model discovery. */
  configParameters?: ReadonlyArray<ProviderModelParameter>;
  setupHint: string;
  /** Verified account-level reset integration; availability still comes from live account data. */
  usageResets?: { adapter: "codex"; authTypes: ReadonlyArray<ProviderAuthType>; documentationUrl: string };
};

export type ProviderConnection = {
  id: string;
  ownerId: string;
  providerKey: string;
  slug: string;
  label: string;
  authType: ProviderAuthType;
  baseUrl?: string;
  config: Record<string, unknown>;
  enabled: boolean;
  hasSecret: boolean;
  secretHint?: string | null;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderModel = ProviderModelDefinition & {
  key: string;
  providerKey: string;
  providerName: string;
  connectionId?: string;
  connectionLabel?: string;
  source: "catalog" | "discovered" | "cursor";
};

export type ParsedModelKey = {
  providerKey: string;
  connectionId?: string;
  modelId: string;
};

export function modelKey(providerKey: string, modelId: string, connectionId?: string) {
  if (providerKey === "cursor" && !connectionId) return modelId;
  return connectionId
    ? `${providerKey}:${connectionId}:${modelId}`
    : `${providerKey}:${modelId}`;
}

export function parseModelKey(value: string | undefined | null): ParsedModelKey {
  const clean = value?.trim() || "";
  const parts = clean.split(":");
  if (parts.length < 2 || !parts[0]) {
    return { providerKey: "cursor", modelId: clean };
  }
  if (parts.length >= 3 && parts[1]) {
    return {
      providerKey: parts[0],
      connectionId: parts[1],
      modelId: parts.slice(2).join(":"),
    };
  }
  return {
    providerKey: parts[0],
    modelId: parts.slice(1).join(":"),
  };
}
