import { resolveCapabilities } from "./capability-resolver";
import type { ProviderDefinition, ProviderModelDefinition } from "@/lib/providers/types";

const chatCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  agent: false,
  modelDiscovery: true,
  mcp: true,
  browser: false,
  skills: false,
  subagents: false,
} as const;

const compatibleCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  agent: false,
  modelDiscovery: true,
  mcp: true,
  browser: false,
  skills: false,
  subagents: false,
} as const;

const agentCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  agent: true,
  modelDiscovery: false,
  mcp: true,
  browser: true,
  skills: true,
  subagents: true,
} as const;

const CODEX_EFFORT_PARAMETER = {
  id: "effort",
  displayName: "Reasoning effort",
  values: [
    { value: "minimal", displayName: "Minimal" },
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
    { value: "xhigh", displayName: "Extra high" },
    { value: "max", displayName: "Max" },
    { value: "ultra", displayName: "Ultra" },
  ],
} as const;

const PORTABLE_REASONING_PARAMETER = {
  id: "effort",
  displayName: "Reasoning",
  values: [
    { value: "none", displayName: "None" },
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
    { value: "xhigh", displayName: "Extra high" },
  ],
} as const;


const CLAUDE_CONTEXT_PARAMETER = {
  id: "contextWindow",
  displayName: "Context",
  values: [
    { value: "200k", displayName: "200K" },
    { value: "1m", displayName: "1M" },
  ],
} as const;
const ANTHROPIC_REASONING_PARAMETER = {
  id: "effort",
  displayName: "Reasoning",
  values: [
    { value: "none", displayName: "None" },
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
  ],
} as const;

function models(...entries: Array<ProviderModelDefinition>) {
  return entries;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "cursor",
    // Cursor SDK TokenUsage.totalTokens sums input + output + cache read + cache write.
    apiPricing: { providers: ["openai", "anthropic", "google", "xai"], inputIncludesCache: false },
    name: "Cursor",
    description: "Cursor Agent SDK with filesystem tools, MCP, plans, and canvases.",
    kind: "cursor-agent",
    authTypes: ["api_key"],
    capabilities: agentCapabilities,
    models: models(),
    setupHint: "Add the Cursor SDK key as a per-user connection. Cursor does not use a configurable base URL.",
  },
  {
    key: "openai",
    apiPricing: { providers: ["openai"], inputIncludesCache: true },
    name: "OpenAI",
    description: "OpenAI API models through the official Vercel AI SDK provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "gpt-5", displayName: "GPT-5", tags: ["balanced", "reasoning"], contextWindow: 400_000, parameters: [PORTABLE_REASONING_PARAMETER] },
      { id: "gpt-5-mini", displayName: "GPT-5 Mini", tags: ["fast"], contextWindow: 400_000 },
      { id: "gpt-5-codex", displayName: "GPT-5 Codex", tags: ["coding", "reasoning"], contextWindow: 400_000, parameters: [PORTABLE_REASONING_PARAMETER] },
    ),
    setupHint: "Create an API key in the OpenAI dashboard.",
  },
  {
    key: "anthropic",
    apiPricing: { providers: ["anthropic"], inputIncludesCache: true },
    name: "Anthropic",
    description: "Claude API models through the official Anthropic provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet", tags: ["balanced", "coding"], contextWindow: 200_000 },
      { id: "claude-opus-4-6", displayName: "Claude Opus", tags: ["reasoning"], contextWindow: 200_000, parameters: [ANTHROPIC_REASONING_PARAMETER] },
      { id: "claude-haiku-4-5", displayName: "Claude Haiku", tags: ["fast"], contextWindow: 200_000 },
    ),
    setupHint: "Use a Claude Console API key. Claude.ai consumer OAuth is not supported for third-party apps.",
  },
  {
    key: "google",
    apiPricing: { providers: ["google"], inputIncludesCache: true },
    name: "Google Gemini",
    description: "Gemini API models through Google's official AI SDK provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    capabilities: chatCapabilities,
    models: models(
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tags: ["fast"], contextWindow: 1_048_576 },
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tags: ["reasoning", "coding"], contextWindow: 1_048_576, parameters: [PORTABLE_REASONING_PARAMETER] },
    ),
    setupHint: "Use a Google AI Studio Gemini API key.",
  },
  {
    key: "xai",
    apiPricing: { providers: ["xai"], inputIncludesCache: true },
    name: "xAI / Grok",
    description: "Grok models through the official xAI provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.x.ai/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "grok-4", displayName: "Grok 4", tags: ["reasoning"], contextWindow: 2_000_000, parameters: [PORTABLE_REASONING_PARAMETER] },
      { id: "grok-3-mini", displayName: "Grok 3 Mini", tags: ["fast"], contextWindow: 131_072 },
    ),
    setupHint: "Create an API key in the xAI console.",
  },
  {
    key: "openrouter",
    apiPricing: { providers: ["openrouter"], inputIncludesCache: true },
    name: "OpenRouter",
    description: "One connection to models from many providers.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "openai/gpt-5", displayName: "GPT-5 via OpenRouter", tags: ["balanced", "reasoning"], parameters: [PORTABLE_REASONING_PARAMETER] },
      { id: "anthropic/claude-sonnet-4-6", displayName: "Claude Sonnet via OpenRouter", tags: ["coding"], parameters: [ANTHROPIC_REASONING_PARAMETER] },
      { id: "google/gemini-2.5-flash", displayName: "Gemini Flash via OpenRouter", tags: ["fast"] },
    ),
    setupHint: "Create an OpenRouter API key. The model list is refreshed from OpenRouter when requested.",
  },
  {
    key: "ollama",
    name: "Ollama / Local",
    description: "Local models through an OpenAI-compatible Ollama endpoint.",
    kind: "compatible",
    authTypes: ["local", "api_key"],
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    capabilities: compatibleCapabilities,
    models: [],
    setupHint: "Start Ollama on the machine running Metis, or enter an Ollama endpoint reachable from that machine. Localhost refers to the Metis host. Installed models are discovered from Ollama; local mode needs no key.",
  },
  {
    key: "compatible",
    name: "OpenAI-compatible",
    description: "Any provider exposing an OpenAI-compatible chat endpoint.",
    kind: "compatible",
    authTypes: ["api_key", "local"],
    capabilities: compatibleCapabilities,
    models: [],
    setupHint: "Enter the provider's base URL and optional API key.",
  },
  {
    key: "codex",
    usageResets: { adapter: "codex", authTypes: ["oauth", "account"], documentationUrl: "https://learn.chatgpt.com/docs/app-server" },
    apiPricing: { providers: ["openai"], inputIncludesCache: true },
    name: "OpenAI Codex",
    description: "Codex agent through the official Codex SDK and CLI runtime.",
    kind: "codex-agent",
    // Official Codex config.toml numeric overrides; this does not advertise server capacity.
    configParameters: [{ id: "context", displayName: "Context (tokens)", values: [],
      customNumber: { min: 1024, max: Number.MAX_SAFE_INTEGER, step: 1,
        description: "Applied next turn. Model and account limits still apply. Leave automatic to use Codex defaults." } }],
    authTypes: ["oauth", "account", "api_key"],
    capabilities: agentCapabilities,
    models: models(
      {
        id: "gpt-6-astra",
        displayName: "GPT-6 Astra",
        tags: ["reasoning", "coding", "agent"],
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-6-sol",
        displayName: "GPT-6 Sol",
        tags: ["reasoning", "coding", "agent"],
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-6-luna",
        displayName: "GPT-6 Luna",
        tags: ["fast", "coding", "agent"],
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        tags: ["reasoning", "coding", "agent"],
        contextWindow: 1_050_000,
        capabilities: { fast: true },
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-5.6",
        displayName: "GPT-5.6",
        tags: ["coding", "agent"],
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        tags: ["balanced", "coding", "agent"],
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
      {
        id: "gpt-5.2",
        displayName: "GPT-5.2",
        tags: ["reasoning", "agent"],
        parameters: [CODEX_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: "medium" }],
      },
    ),
    setupHint: "Use OAuth or an account credential for ChatGPT/Codex usage, or an OpenAI API key.",
  },
  {
    key: "claude-code",
    apiPricing: { providers: ["anthropic"], inputIncludesCache: false },
    name: "Claude Code",
    description: "Claude Code agent through Anthropic's official Agent SDK.",
    kind: "claude-agent",
    authTypes: ["oauth"],
    capabilities: agentCapabilities,
    // Mirrors T3 Code's Claude model/context semantics: only models that
    // actually expose a 200K/1M switch get a context option. 4.7/4.8 are
    // already 1M at the API and therefore expose metadata, not a fake toggle.
    models: models(
      { id: "claude-fable-5", displayName: "Claude Fable 5", tags: ["reasoning", "coding", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog", parameters: [CLAUDE_CONTEXT_PARAMETER], defaultParams: [{ id: "contextWindow", value: "1m" }] },
      { id: "claude-opus-5", displayName: "Claude Opus 5", tags: ["reasoning", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog", parameters: [CLAUDE_CONTEXT_PARAMETER], defaultParams: [{ id: "contextWindow", value: "1m" }] },
      { id: "claude-opus-4-8", displayName: "Claude Opus 4.8", tags: ["reasoning", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog" },
      { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", tags: ["reasoning", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog" },
      { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", tags: ["reasoning", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog", parameters: [CLAUDE_CONTEXT_PARAMETER], defaultParams: [{ id: "contextWindow", value: "1m" }] },
      { id: "claude-opus-4-5", displayName: "Claude Opus 4.5", tags: ["reasoning", "agent"], contextWindow: 200_000, contextWindowSource: "catalog" },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", tags: ["reasoning", "coding", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog", parameters: [CLAUDE_CONTEXT_PARAMETER], defaultParams: [{ id: "contextWindow", value: "200k" }] },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", tags: ["coding", "agent"], contextWindow: 1_000_000, contextWindowSource: "catalog", parameters: [CLAUDE_CONTEXT_PARAMETER], defaultParams: [{ id: "contextWindow", value: "200k" }] },
      { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", tags: ["fast", "agent"], contextWindow: 200_000, contextWindowSource: "catalog" },
    ),
    setupHint: "Use OAuth to connect your Claude Code account.",
  },
  {
    key: "antigravity",
    apiPricing: { providers: ["google", "anthropic"], inputIncludesCache: true },
    name: "Google Antigravity",
    description: "Antigravity agent through the official Python SDK by default, or the agy CLI via OAuth.",
    kind: "antigravity-agent",
    authTypes: ["api_key", "oauth"],
    capabilities: agentCapabilities,
    models: models(
      ...[
        ["gemini-3.6-flash", "Gemini 3.6 Flash", ["balanced", "agent"], "medium"],
        ["gemini-3.5-flash", "Gemini 3.5 Flash", ["balanced", "agent"], "medium"],
        ["gemini-3.1-pro", "Gemini 3.1 Pro", ["reasoning", "coding", "agent"], "high"],
        ["claude-opus-4-6-thinking", "Claude Opus 4.6 Thinking", ["reasoning", "agent"], "high"],
        ["claude-sonnet-4-6", "Claude Sonnet 4.6", ["balanced", "coding", "agent"], "medium"],
        ["gpt-oss-120b-medium", "GPT-OSS 120B", ["balanced", "agent"], "medium"],
      ].map(([id, displayName, tags]) => ({
        id: id as string,
        displayName: displayName as string,
        tags: tags as string[],
        // agy options are model-specific. Names do not prove --effort support.
        parameters: [],
        defaultParams: [],
        parameterSource: "registry" as const,
      })),
    ),
    setupHint: "Default: paste a Gemini API key to run the official google-antigravity SDK. OAuth still uses the agy CLI if you want that path.",
  },
  {
    key: "grok-build",
    apiPricing: { providers: ["xai"], inputIncludesCache: true },
    name: "Grok Build",
    description: "Grok Build CLI agent over ACP stdio (grok agent stdio), with Metis MCP attached.",
    kind: "grok-agent",
    authTypes: ["local", "oauth"],
    capabilities: agentCapabilities,
    models: models({
      id: "grok-build",
      displayName: "Grok Build",
      tags: ["coding", "agent"],
    }),
    setupHint: "Install the Grok CLI and run grok login. Metis launches grok agent stdio and injects the Metis MCP gateway.",
  },
  {
    key: "opencode",
    name: "OpenCode",
    description: "OpenCode CLI agent over ACP-style stdio, with Metis MCP attached.",
    kind: "opencode-agent",
    authTypes: ["local", "oauth"],
    capabilities: agentCapabilities,
    models: models({
      id: "opencode",
      displayName: "OpenCode",
      tags: ["coding", "agent"],
    }),
    setupHint: "Install OpenCode and run opencode auth login. Metis prefers the Metis MCP gateway over OpenCode builtins.",
  },
];

const providerMap = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

export function getProviderDefinition(key: string) {
  return providerMap.get(key);
}

export function getProviderModelDefinition(providerKey: string, modelId: string) {
  const provider = providerMap.get(providerKey);
  if (!provider) return undefined;
  const exact = provider.models.find((model) => model.id === modelId);
  if (exact) return exact;
  // Discovery can expose a provider variant that is not in the static
  // registry. Reuse the provider's parameter contract for the same model
  // family, while keeping the discovered id and metadata authoritative.
  const family = provider.models.find((model) => {
    if (providerKey === "codex") return /^gpt-(?:5|6)(?:[.-]|$)/i.test(model.id) && /^gpt-(?:5|6)(?:[.-]|$)/i.test(modelId);
    return false;
  });
  return family;
}

export function listProviderDefinitions() {
  return PROVIDERS;
}

export function getVerifiedProviderCapabilities(providerKey: string, modelId?: string) {
  const provider = providerMap.get(providerKey);
  if (!provider) return undefined;
  const model = modelId ? getProviderModelDefinition(providerKey, modelId) : undefined;
  return resolveCapabilities(provider, model);
}
