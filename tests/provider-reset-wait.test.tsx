import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ProviderResetWaitBar } from "../components/provider-reset-wait-banner";
import { parseProviderResetWait, providerResetWaitFromJob, providerResetWaitLabel } from "../lib/provider-reset-wait";

Object.assign(globalThis, { React });
const now = Date.parse("2026-11-06T18:00:00Z");
const wait = { jobId: "job", detectedAt: "2026-11-06T17:00:00Z", resetAt: "2026-11-07T09:55:00Z" };
const render = (props = {}) => renderToStaticMarkup(<ProviderResetWaitBar wait={wait} now={now} onWake={() => {}} onCancel={() => {}} {...props} />);

test("the compact wait bar exposes the real reset and both named actions", () => {
  const html = render();
  assert.match(html, /Usage limit reached/);
  assert.match(html, /Cancel auto-resume/);
  assert.match(html, /Wake now/);
  assert.match(html, /role="status"/);
  assert.match(html, /dateTime="2026-11-07T09:55:00Z"/i);
  assert.match(html, /aria-label="Provider reset wait"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("pending, failed and due waits have usable feedback without implying completion", () => {
  const pending = render({ pending: "wake" });
  assert.equal((pending.match(/disabled=""/g) || []).length, 2);
  assert.match(pending, /Waking…/);
  const failed = render({ error: "Could not retry <details>", onRefresh() {} });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Could not retry &lt;details&gt;/);
  assert.match(failed, /Retry/);
  const due = render({ now: Date.parse(wait.resetAt) });
  assert.match(due, /Resuming…/);
  assert.equal((due.match(/disabled=""/g) || []).length, 1);
});

test("local calendar labels preserve the user's timezone across midnight and DST", () => {
  assert.equal(providerResetWaitLabel(wait.resetAt, now, "Europe/Berlin"), "Resumes tomorrow at 10:55");
  assert.equal(providerResetWaitLabel(wait.resetAt, Date.parse("2026-11-06T23:30:00Z"), "Europe/Berlin"), "Resumes today at 10:55");
  assert.equal(providerResetWaitLabel("2026-10-26T09:55:00Z", Date.parse("2026-10-24T22:30:00Z"), "Europe/Berlin"), "Resumes tomorrow at 10:55");
  assert.equal(providerResetWaitLabel(wait.resetAt, Date.parse(wait.resetAt), "Europe/Berlin"), "Resuming…");
  assert.equal(providerResetWaitLabel("unknown", now), "Resume time unavailable");
});

test("only a queued job with explicit, valid reset evidence becomes a live wait", () => {
  const job = { id: "job", status: "queued", providerRateLimit: { resetAt: wait.resetAt, detectedAt: wait.detectedAt, source: "provider-field" as const } };
  assert.deepEqual(providerResetWaitFromJob(job), wait);
  for (const status of ["running", "completed", "cancelled", "error", "interrupted"]) assert.equal(providerResetWaitFromJob({ ...job, status }), null);
  assert.equal(providerResetWaitFromJob({ id: "job", status: "queued" }), null);
  for (const value of [null, {}, { ...wait, jobId: "" }, { ...wait, resetAt: "tomorrow" }, { ...wait, resetAt: "2026-11-07T10:55:00" }]) assert.equal(parseProviderResetWait(value), null);
});
