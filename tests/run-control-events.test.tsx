import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ModelSwitchDetails, RunEventDivider } from "../components/run-event-divider";
import { parseRunControlEvent } from "../lib/run-control-event";
import { layoutAssistantParts } from "../lib/tool-call-display";
import { reconcileMessageParts } from "../lib/message-parts";
import type { MessagePart, ToolPart } from "../lib/store";

Object.assign(globalThis, { React });
const switched = { type: "model-switch" as const, id: "switch:1", fromModelId: "codex:personal:first", toModelId: "cursor:work:second", timestamp: "2026-10-29T18:00:00Z" };
const waited = { type: "provider-wait" as const, id: "wait:1", detectedAt: "2026-10-29T18:00:00Z", resetAt: "2026-10-29T23:00:00Z", detail: "Usage limit reached <unsafe>" };

test("model switches disclose both identities without changing saved model keys", () => {
  const trigger = renderToStaticMarkup(<RunEventDivider event={switched} />);
  assert.match(trigger, /<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(trigger, /Switched model/);
  assert.doesNotMatch(trigger, /<details|Switched at/);
  const html = renderToStaticMarkup(<ModelSwitchDetails event={switched} modelLabel={id => id === switched.fromModelId ? "First advertised model" : "Second advertised model"} />);
  assert.match(html, /First advertised model/);
  assert.match(html, /Second advertised model/);
  assert.ok(html.includes(switched.fromModelId) && html.includes(switched.toModelId));
});
test("reasoning switches render and replay old/new values without claiming a different model", () => {
  const event = { ...switched, toModelId: switched.fromModelId, fromReasoning: "high", toReasoning: "low" };
  const trigger = renderToStaticMarkup(<RunEventDivider event={event} />);
  assert.match(trigger, /<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  assert.match(trigger, /Switched reasoning/);
  assert.doesNotMatch(trigger, /Switched model|Reasoning from|<details/);
  const html = renderToStaticMarkup(<ModelSwitchDetails event={event} />);
  assert.match(html, /Reasoning from/);
  assert.match(html, />high</);
  assert.match(html, />low</);
  assert.deepEqual(parseRunControlEvent(JSON.parse(JSON.stringify(event))), event);
  const parts: MessagePart[] = [{ type: "text", content: "Before" }, event, { type: "text", content: "After" }];
  assert.deepEqual(layoutAssistantParts<ToolPart>(reconcileMessageParts<ToolPart, MessagePart>({ parts, content: "BeforeAfter" })).map(part => part.type), ["text", "model-switch", "text"]);
});

test("resetting reasoning discloses unspecified defaults and combined switches keep model labels", () => {
  const event = { ...switched, fromReasoning: "high", toReasoning: null };
  assert.deepEqual(parseRunControlEvent(event), event);
  assert.match(renderToStaticMarkup(<RunEventDivider event={event} />), /Switched model/);
  const html = renderToStaticMarkup(<ModelSwitchDetails event={event} />);
  assert.match(html, /Default \(not specified\)/);
  assert.match(html, /Reasoning to/);
  assert.deepEqual(parseRunControlEvent({ ...event, toReasoning: {} }), switched);
  assert.deepEqual(parseRunControlEvent({ ...event, fromReasoning: "x".repeat(8001) }), switched);
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
