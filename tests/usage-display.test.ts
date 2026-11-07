import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lowQuotaAlerts,
 matchUsageProvider,
  parseCursorUsageBody,
 usageKeyForProvider,
  selectPrimaryUsageWindow,
 usageKeyForSelection,
  type UsageProvider,
} from "../lib/usage-display";

const providers: UsageProvider[] = [
  { key: "zai", name: "z.ai Coding Plan", status: "live", windows: [{ label: "5h", usedPercent: 12, resetsAt: null }] },
  { key: "codex", name: "Codex", status: "no_auth", windows: [], error: "login required" },
];

test("unknown and empty usage selections do not invent quota keys", () => {
 assert.equal(usageKeyForProvider("unknown-provider"), null);
 assert.equal(usageKeyForSelection({ providerId: "unknown-provider", connectionId: "connection-1" }), null);
 assert.equal(usageKeyForSelection({}), null);
});

test("plan usage paths use the runtime home directory", () => {
 const source = readFileSync(new URL("../lib/plan-usage.ts", import.meta.url), "utf8");
 assert.equal(source.includes("/home/samuel"), false);
 assert.equal(source.includes(".npm-global/bin/codex"), false);
 assert.match(source, /homedir\(\)/);
 assert.match(readFileSync(new URL("../lib/providers/codex-cli.ts", import.meta.url), "utf8"), /path\.join\(config\.root,/);
 assert.match(source, /path\.join\(homedir\(\), [\"']AiApi-Wrapper\/\.env[\"']\)/);
});

test("usage selection resolves a compatible z.ai connection by its real connection metadata", () => {
  assert.equal(usageKeyForSelection({
    providerId: "compatible",
    connectionLabel: "Z.ai Coding Plan (GLM)",
    modelId: "glm-5.3",
  }), "zai");
  assert.equal(matchUsageProvider(providers, {
    providerId: "compatible",
    connectionLabel: "Z.ai Coding Plan (GLM)",
    modelId: "glm-5.3",
  })?.key, "zai");
});

test("usage selection keeps unavailable providers visible instead of inventing quota", () => {
  const codex = matchUsageProvider(providers, { providerId: "codex" });
  assert.equal(codex?.status, "no_auth");
  assert.equal(codex?.windows.length, 0);
});


test("compact quota selects the most constrained window instead of preferring weekly", () => {
 assert.equal(selectPrimaryUsageWindow([
  { label: "weekly", usedPercent: 42, resetsAt: null },
  { label: "5h", usedPercent: 88, resetsAt: null },
 ])?.label, "5h");
});

test("usage selection maps Samuel gateway plan aliases to their real quota owner", () => {
  const providers = [
    { key: "codex", name: "Codex", status: "live" as const, windows: [{ label: "weekly", usedPercent: 42, resetsAt: null }] },
    { key: "antigravity", name: "Antigravity", status: "live" as const, windows: [{ label: "quota", usedPercent: 12, resetsAt: null }] },
    { key: "zai", name: "z.ai", status: "live" as const, windows: [{ label: "5h", usedPercent: 9, resetsAt: null }] },
    { key: "cursor", name: "Cursor", status: "live" as const, windows: [{ label: "included", usedPercent: 20, resetsAt: null }] },
  ];
  assert.equal(matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "gpt-5.6-luna" })?.key, "codex");
  assert.equal(matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "gpt-6-sol" })?.key, "codex");
  assert.equal(matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "agy-gemini-3.6-flash-high" })?.key, "antigravity");
  assert.equal(matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "gemini-3-flash" })?.key, "antigravity");
  assert.equal(matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "glm-5" })?.key, "zai");
});

test("usage keys resolve Cursor, Codex, z.ai, and Antigravity aliases", () => {
  assert.equal(usageKeyForProvider("cursor-agent"), "cursor");
  assert.equal(usageKeyForProvider("chatgpt"), "codex");
  assert.equal(usageKeyForProvider("agy"), "antigravity");
  assert.equal(usageKeyForProvider("zhipu"), "zai");
});

test("usage selection falls back to exact gateway telemetry without inventing a quota", () => {
  const providers = [
    {
      key: "gateway:gemini:gemini-3-flash",
      name: "Gateway · gemini · gemini-3-flash",
      status: "live" as const,
      windows: [],
      extra: { model: "gemini-3-flash", requests5h: 8, tokens5h: 12345, telemetry: "local" },
    },
  ];
  const matched = matchUsageProvider(providers, { providerId: "compatible", connectionLabel: "Samuel AI Gateway", modelId: "gemini-3-flash" });
  assert.equal(matched?.key, "gateway:gemini:gemini-3-flash");
  assert.equal(matched?.windows.length, 0);
  assert.equal(matched?.extra?.requests5h, 8);
});

test("usage response normalization accepts wrapped, string-valued, and fallback quota fields", () => {
  const parsed = parseCursorUsageBody({
    data: {
      membershipType: "pro",
      billing_cycle_end: 1_900_000_000,
      individualUsage: {
        planUsage: { used: "25", total: "100" },
        onDemandUsage: { percentage: "12.5", used: "5", total: "40" },
      },
    },
  });
  assert.deepEqual(parsed, {
    windows: [
      { label: "monthly", usedPercent: 25, resetsAt: new Date(1_900_000_000 * 1_000).toISOString() },
      { label: "on-demand", usedPercent: 13, resetsAt: new Date(1_900_000_000 * 1_000).toISOString() },
    ],
    planLabel: "Pro",
    extra: {
      planUsed: 25,
      planLimit: 100,
      onDemandUsed: 5,
      includedUsed: 25,
      includedLimit: 100,
      onDemandLimit: 40,
    },
  });
});

test("usage response normalization rejects malformed payloads without inventing a percentage", () => {
  assert.equal(parseCursorUsageBody({ data: { individualUsage: { plan: { used: "nope", limit: 0 } } } }), null);
  assert.equal(parseCursorUsageBody(null), null);
});

test("lowQuotaAlerts warns only on official dashboard windows at or below 10% remaining", () => {
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    providers: [
      { key: "cursor", name: "Cursor", status: "live" as const, source: "dashboard" as const, windows: [{ label: "included", usedPercent: 92, resetsAt: null }] },
      { key: "codex", name: "Codex", status: "live" as const, source: "dashboard" as const, windows: [{ label: "weekly", usedPercent: 10, resetsAt: null }] },
      { key: "gateway:glm:glm-5", name: "Gateway", status: "live" as const, source: "local" as const, windows: [{ label: "5h", usedPercent: 99, resetsAt: null }] },
    ],
  };
  const alerts = lowQuotaAlerts(snapshot);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.providerKey, "cursor");
  assert.equal(alerts[0]?.remainingPct, 8);
  assert.equal(lowQuotaAlerts(snapshot, 5).length, 0);
});
