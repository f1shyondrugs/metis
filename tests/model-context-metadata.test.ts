import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const zaiCoding = {
  providerKey: "compatible",
  slug: "zai-coding",
  label: "Z.AI Coding",
  baseUrl: "https://api.z.ai/api/coding/paas/v4",
};
const modelId = "fixture-context-model";
// Synthetic limits exercise precedence; they make no claim about any model.
const codingLimits = { contextWindow: 1_048_576, maxOutputTokens: 65_536 };
const standardLimits = { contextWindow: 262_144, maxOutputTokens: 32_768 };
const root = mkdtempSync(path.join(tmpdir(), "metis-context-registry-test-"));
let metadata: typeof import("../lib/model-context-metadata");

before(async () => {
  const data = path.join(root, "data");
  mkdirSync(data);
  writeFileSync(path.join(data, "model-context-registry.json"), JSON.stringify({
    providers: {
      "zai-coding-plan": { ["z-ai/" + modelId]: codingLimits },
      zai: { [modelId]: standardLimits },
    },
  }));
  const previous = process.env.AI_CHAT_ROOT;
  process.env.AI_CHAT_ROOT = root;
  try {
    // config.root is determined when imported; never read the developer's
    // generated registry or refresh models.dev during the test.
    metadata = await import("../lib/model-context-metadata");
  } finally {
    if (previous === undefined) delete process.env.AI_CHAT_ROOT;
    else process.env.AI_CHAT_ROOT = previous;
  }
});
after(() => rmSync(root, { recursive: true, force: true }));

test("compatible coding APIs resolve the namespaced model in the coding registry", () => {
  assert.ok(metadata.contextRegistryProviderCandidates(zaiCoding).includes("zai-coding-plan"));
  assert.deepEqual(metadata.lookupRegistryContextMetadata(zaiCoding, modelId), {
    ...codingLimits, source: "registry",
  });
});

test("the regular endpoint uses its own metadata for the same model ID", () => {
  const standard = { ...zaiCoding, slug: "zai", label: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4" };
  assert.deepEqual(metadata.lookupRegistryContextMetadata(standard, modelId), {
    ...standardLimits, source: "registry",
  });
});

test("provider-reported context wins stored, registry and catalog metadata", () => {
  const resolved = metadata.resolveModelContextMetadata({
    connection: zaiCoding, modelId,
    providerContextWindow: 777_777,
    storedContextWindow: 888_888,
    storedContextWindowSource: "stored-provider",
    catalogContextWindow: 999_999,
  });
  assert.equal(resolved.contextWindow, 777_777);
  assert.equal(resolved.source, "provider");
});

test("stored provider metadata wins registry/catalog when live model listing omits the limit", () => {
  const resolved = metadata.resolveModelContextMetadata({
    connection: zaiCoding, modelId,
    storedContextWindow: 888_888,
    storedContextWindowSource: "provider",
    catalogContextWindow: 999_999,
  });
  assert.equal(resolved.contextWindow, 888_888);
  assert.equal(resolved.source, "provider");
});

test("legacy unproven stored limits do not override a known upstream registry", () => {
  const resolved = metadata.resolveModelContextMetadata({
    connection: zaiCoding, modelId,
    storedContextWindow: 123_456,
    catalogContextWindow: 200_000,
  });
  assert.deepEqual(resolved, { ...codingLimits, source: "registry" });
});

test("unknown compatible endpoints do not borrow a context limit from an unrelated provider", () => {
  const found = metadata.lookupRegistryContextMetadata({
    providerKey: "compatible",
    slug: "my-local-gateway",
    label: "My Gateway",
    baseUrl: "https://models.example.test/v1",
  }, modelId);
  assert.equal(found.contextWindow, undefined);
});
