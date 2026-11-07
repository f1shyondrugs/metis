import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nextResetCreditExpiry, type UsageResetCredit } from "../lib/usage-reset-types";
import { usageResetExpiry, type UsageProvider } from "../lib/usage-display";
import { UsageResetsShortcut } from "../components/usage-resets-shortcut";
import { PlanUsageGauge } from "../components/quota-gauges";
Object.assign(globalThis, { React });

const day = 86_400_000;
const now = Date.parse("2026-11-06T12:00:00Z");
const provider = (remaining: number, patch: Partial<UsageProvider> = {}): UsageProvider => ({
  key: "codex", name: "Test account", status: "live", connectionId: "account-a",
  windows: [{ label: "5h", usedPercent: 25, resetsAt: null }],
  extra: { resetCredits: 3, resetCreditsExpiresAt: new Date(now + remaining).toISOString() },
  ...patch,
});

test("expiry thresholds include exactly 72h and 24h and exclude expired credits", () => {
  for (const [remaining, warning] of [
    [3 * day + 1, null], [3 * day, "warning"], [day + 1, "warning"],
    [day, "critical"], [1, "critical"],
  ] as const) assert.equal(usageResetExpiry(provider(remaining), now)?.warning, warning);
  assert.equal(usageResetExpiry(provider(0), now), null);
  assert.equal(usageResetExpiry(provider(-1), now), null);
});

test("unknown, stale, empty and other-account data cannot produce an expiry warning", () => {
  for (const status of ["stale", "error", "no_auth", "unsupported"] as const)
    assert.equal(usageResetExpiry(provider(day, { status }), now), null);
  const extras: NonNullable<UsageProvider["extra"]>[] = [
    {}, { resetCredits: 0 }, { resetCredits: 3, resetCreditsExpiresAt: "invalid" },
    { resetCredits: null, resetCreditsExpiresAt: new Date(now + day).toISOString() },
    { resetCredits: 0, resetCreditsExpiresAt: new Date(now + day).toISOString() },
  ];
  for (const extra of extras) assert.equal(usageResetExpiry(provider(day, { extra }), now), null);
  assert.equal(usageResetExpiry(null, now), null);
  assert.equal(usageResetExpiry(provider(5 * day, { connectionId: "account-b" }), now)?.warning, null);
});

test("summary picks the earliest usable expiry without inventing missing dates", () => {
  const credit = (id: string, remaining: number, patch: Partial<UsageResetCredit> = {}): UsageResetCredit => ({
    id, title: "Reset", status: "available", resetType: "codexRateLimits",
    expiresAt: new Date(now + remaining).toISOString(), ...patch,
  });
  const snapshot = { availableCount: 3, detailsAvailable: true, credits: [
    credit("later", 10 * day), credit("soon", 2 * day), credit("past", -day),
    credit("used", day, { status: "redeemed" }), credit("other", 1, { resetType: "unknown" }),
    credit("no-date", 1, { expiresAt: undefined }), credit("forever", 1, { expiresAt: null }),
    credit("invalid", 1, { expiresAt: "invalid" }),
  ] };
  assert.equal(nextResetCreditExpiry(snapshot, now), new Date(now + 2 * day).toISOString());
  assert.equal(nextResetCreditExpiry({ ...snapshot, availableCount: 0 }, now), null);
  assert.equal(nextResetCreditExpiry({ availableCount: 3, credits: [], detailsAvailable: false }, now), null);
  assert.equal(nextResetCreditExpiry(null, now), null);
});

test("usage percentage renders the correct warning dot and shortcut exposes its actual expiry", () => {
  for (const [remaining, severity, color] of [[2 * day, "warning", "yellow"], [day / 2, "critical", "red"]] as const) {
    const live = provider(remaining);
    live.extra!.resetCreditsExpiresAt = new Date(Date.now() + remaining).toISOString();
    const gauge = renderToStaticMarkup(<PlanUsageGauge provider={live} />);
    assert.match(gauge, new RegExp('data-reset-expiry="' + severity + '"'));
    assert.match(gauge, new RegExp("bg-" + color + "-400"));
    assert.match(gauge, /Next reset credit expires/);
    assert.match(gauge, /75%/);
    const shortcut = renderToStaticMarkup(<UsageResetsShortcut provider={live} onClick={() => {}} />);
    assert.match(shortcut, /Usage Resets \(3\)/);
    assert.match(shortcut, /Next reset credit expires/);
    assert.match(shortcut, new RegExp("text-" + color + "-400"));
    assert.match(shortcut, new RegExp("hover:text-" + color + "-300"));
    for (const hidden of [{ ...live, status: "stale" as const }, { ...live, extra: { resetCredits: 0 } }, provider(10 * day)]) {
      assert.doesNotMatch(renderToStaticMarkup(<PlanUsageGauge provider={hidden} />), /data-reset-expiry/);
    }
  }
});
