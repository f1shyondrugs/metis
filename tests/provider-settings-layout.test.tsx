import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module, { createRequire } from "node:module";
import type * as Layout from "../components/provider-settings-layout";

// Brand glyphs pull in browser-only ESM dependencies. Exercise the actual
// layout and controls with a decorative glyph; inspect real logos in-browser.
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let layout: typeof Layout;
try {
  loader._load = function (id, ...args) {
    if (id === "@/components/provider-logo") return { ProviderLogo: () => React.createElement("svg", { "aria-hidden": true }) };
    return originalLoad.call(this, id, ...args);
  };
  layout = createRequire(import.meta.url)("../components/provider-settings-layout");
} finally {
  loader._load = originalLoad;
}
const { ProviderSettingsLayout, providerConnectionStatus } = layout;

Object.assign(globalThis, { React });
const connections = [
  { id: "personal", providerKey: "codex", label: "Personal", enabled: true, hasSecret: true },
  { id: "work", providerKey: "codex", label: "Work", enabled: false, hasSecret: true },
];
function render(overrides: Partial<React.ComponentProps<typeof ProviderSettingsLayout>> = {}) {
  return renderToStaticMarkup(<ProviderSettingsLayout connections={connections}
    definitions={[{ key: "codex", name: "Codex" }]} selectedId="work" adding={false} loaded busy={false}
    onSelect={() => {}} onAdd={() => {}} onRefresh={async () => {}} onToggle={async () => {}}
    {...overrides}><p>Selected connection details</p></ProviderSettingsLayout>);
}

test("each account has an independent selector and labelled enable switch", () => {
  const html = render();
  assert.match(html, /aria-label="Provider connections"/);
  assert.match(html, /aria-current="true"[^>]*aria-controls="provider-connection-detail"[^>]*>.*?Work/s);
  assert.match(html, /role="switch"[^>]*aria-label="Enable Personal"/);
  assert.match(html, /role="switch"[^>]*aria-label="Enable Work"/);
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  assert.match(html, /id="provider-connection-detail"/);
  assert.match(html, /Selected connection details/);
});

test("adding, loading, empty and failed loads have accessible states", () => {
  const adding = render({ adding: true });
  assert.match(adding, /aria-current="true"[^>]*>.*?Add provider/s);
  const loading = render({ connections: [], loaded: false });
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading provider connections/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(render({ connections: [] }), /No connections yet/);
  const failed = render({ error: "Failed to load <providers>" });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Failed to load &lt;providers&gt;/);
  assert.match(failed, /Try again/);
});

test("connection state does not imply readiness from saved credentials alone", () => {
  const connection = connections[0];
  assert.equal(providerConnectionStatus(connection), "Credentials saved");
  assert.equal(providerConnectionStatus({ ...connection, hasSecret: false }), "Not checked");
  assert.equal(providerConnectionStatus({ ...connection, lastCheckedAt: "2026-11-06T12:00:00Z" }), "Ready");
  assert.equal(providerConnectionStatus({ ...connection, lastError: "Failed" }), "Connection error");
  assert.equal(providerConnectionStatus({ ...connection, enabled: false, lastError: "Failed" }), "Disabled");
});
