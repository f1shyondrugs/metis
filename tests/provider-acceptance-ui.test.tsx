import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ProviderAcceptancePanel, acceptanceCounts } from "../components/provider-acceptance-panel";
import type { AcceptanceTarget } from "../lib/providers/acceptance";

Object.assign(globalThis, { React });

test("initial console is passive, accessible, and does not imply acceptance", () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => { calls++; throw new Error("Unexpected request"); }) as typeof fetch;
  try {
    const html = renderToStaticMarkup(<ProviderAcceptancePanel />);
    assert.equal(calls, 0);
    assert.match(html, /Loading acceptance catalog/);
    assert.match(html, /Opening this page never starts or resumes a test/);
    assert.match(html, /Blocked and untested checks are not passes/);
    assert.match(html, /0 passed/);
    assert.doesNotMatch(html, /checked=""/);
    assert.doesNotMatch(html, /Download JSON/);
  } finally { globalThis.fetch = original; }
});

test("counts preserve all five outcomes without treating blocked as passed", () => {
  const cells = (["passed", "failed", "blocked", "unsupported", "untested", "blocked"] as const)
    .map(status => ({ check: "response" as const, status, reason: "Recorded reason" }));
  const targets: AcceptanceTarget[] = [{
    id: "fixture", providerKey: "fixture", providerName: "Fixture", authType: "api_key",
    capabilities: {}, cells,
  }];
  assert.deepEqual(acceptanceCounts(targets), { passed: 1, failed: 1, blocked: 2, unsupported: 1, untested: 1 });
  assert.deepEqual(acceptanceCounts([]), { passed: 0, failed: 0, blocked: 0, unsupported: 0, untested: 0 });
});

test("safety wiring keeps opt-in, bounded requests, abort cleanup and passive downloads explicit", () => {
  const source = readFileSync(new URL("../components/provider-acceptance-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /useState<string\[\]>\(\[\]\)/);
  assert.match(source, /confirmLive: true/);
  assert.match(source, /maxTurns >= 1 && maxTurns <= 20/);
  assert.match(source, /seconds >= 15 && seconds <= 300/);
  assert.match(source, /Live tests may consume paid provider quota/);
  assert.match(source, /not a dollar-cost guarantee/);
  assert.match(source, /if \(!runId\) return/);
  assert.match(source, /!result.active && result.report.state === "running"/);
  assert.match(source, /abort.abort\(\); if \(timer\) clearTimeout\(timer\)/);
  assert.match(source, /window.removeEventListener\("offline", offline\)/);
  assert.match(source, /\["markdown", "html", "json"\]/);
});
