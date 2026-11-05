import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { RunEventDivider } from "../components/run-event-divider";
import { parseRunControlEvent } from "../lib/run-control-event";
import { layoutAssistantParts } from "../lib/tool-call-display";
import { reconcileMessageParts } from "../lib/message-parts";
import type { MessagePart, ToolPart } from "../lib/store";

Object.assign(globalThis, { React });
const switched = { type: "model-switch" as const, id: "switch:1", fromModelId: "codex:personal:first", toModelId: "cursor:work:second", timestamp: "2026-10-29T18:00:00Z" };
const waited = { type: "provider-wait" as const, id: "wait:1", detectedAt: "2026-10-29T18:00:00Z", resetAt: "2026-10-29T23:00:00Z", detail: "Usage limit reached <unsafe>" };

test("model switches disclose both identities without changing saved model keys", () => {
  const html = renderToStaticMarkup(<RunEventDivider event={switched} modelLabel={id => id === switched.fromModelId ? "First advertised model" : "Second advertised model"} />);
  assert.match(html, /Switched model/);
  assert.match(html, /First advertised model/);
  assert.match(html, /Second advertised model/);
  assert.ok(html.includes(switched.fromModelId) && html.includes(switched.toModelId));
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});
test("limit waits retain the real reset and safely render provider diagnostics", () => {
  const html = renderToStaticMarkup(<RunEventDivider event={waited} />);
  assert.match(html, /Usage limit wait/);
  assert.ok(html.includes(waited.resetAt));
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /bg-amber/);
});
test("control events preserve interleaving across persistence, layout and replay", () => {
  const parts: MessagePart[] = [{ type: "text", content: "Before." }, switched, { type: "tool", id: "tool", name: "fixture", status: "completed" }, waited, { type: "text", content: "After." }];
  const saved = reconcileMessageParts<ToolPart, MessagePart>({ parts: JSON.parse(JSON.stringify(parts)), content: "Before.After." });
  assert.deepEqual(layoutAssistantParts<ToolPart>(saved).map(p => p.type), ["text", "model-switch", "tools", "provider-wait", "text"]);
  assert.deepEqual(parseRunControlEvent(switched), switched);
  assert.deepEqual(parseRunControlEvent(waited), waited);
  assert.equal(parseRunControlEvent({ type: "model-switch", id: "missing-fields" }), null);
  assert.equal(parseRunControlEvent({ ...waited, resetAt: {} }), null);
});
