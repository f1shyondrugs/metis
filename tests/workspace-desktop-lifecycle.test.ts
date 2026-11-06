import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { chooseDesktopClient, desktopUnavailableReason } from "../lib/remote-desktop-view";
import type { RemoteClient } from "../lib/remote-clients";

// Execute the real effect callbacks and their real dependency arrays. The fake
// clock advances thousands of frames without opening a device or retaining
// image history in the test fixture.
const source = ts.createSourceFile("workspace-desktops-panel.tsx",
  readFileSync("components/workspace-desktops-panel.tsx", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: ts.CallExpression[] = [];
let responseError = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "responseError") responseError = node.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes('fetch("/api/remote-clients')) effects.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(effects.length, 2);
const compiled = ts.transpileModule(responseError + `
function renderEffects({ active, retry, deviceId, unavailable, paused, inventoryError, monitorId = null, monitorReady = true, monitorError = "", sourceKey = JSON.stringify([deviceId, monitorId]) }) {
  return [${effects.map(effect => `{ run: ${effect.arguments[0].getText(source)}, deps: ${effect.arguments[1].getText(source)} }`).join(",")}];
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Effect = { run: () => (() => void) | undefined; deps: unknown[] };
type Frame = { url: string; at: number; sourceKey: string };
type Timer = { callback: () => unknown; delay: number };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const device: RemoteClient = {
  id: "qa-desktop", ownerId: "qa-owner", name: "Fixture desktop", status: "online",
  permissionMode: "admin", capabilities: ["desktop_gui"],
  policy: { mode: "full_access", allowlist: [], permissions: ["computer_use"] },
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const freshInventory = () => [{ ...device, policy: { ...device.policy, permissions: [...device.policy.permissions] }, capabilities: [...device.capabilities] }];
function frameResponse(monitorId?: string): Response {
  return {
    ok: true,
    blob: async () => new Blob(["bounded-frame"], { type: "image/jpeg" }),
    headers: new Headers({ "X-Desktop-Captured-At": "1793500000000", ...(monitorId ? { "X-Desktop-Monitor-Id": encodeURIComponent(monitorId) } : {}) }),
  } as Response;
}

function harness() {
  const state = {
    active: true, retry: 0, paused: false, inventoryError: "", frameError: "", monitorId: null as string | null, monitorReady: true, monitorError: "",
    clients: [] as RemoteClient[], frame: null as Frame | null,
  };
  const timers = new Map<number, Timer>(), urls = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const slots: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  const stats = { captures: 0, inventories: 0, captureStarts: 0, inventoryStarts: 0, maxUrls: 0, inFlight: 0, maxInFlight: 0 };
  const errors: unknown[] = [];
  let nextTimer = 0, nextUrl = 0, mounted = true;
  let nextCapture: Promise<Response> | undefined, lastCaptureSignal: AbortSignal | undefined;
  const document = {
    hidden: false,
    addEventListener(name: string, callback: () => void) {
      const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks);
    },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
  };
  const context = {
    document, AbortController, Date, Number, encodeURIComponent,
    fetch: async (url: string, init?: RequestInit) => {
      if (url === "/api/remote-clients") {
        stats.inventories++;
        return { ok: true, json: async () => ({ clients: freshInventory() }) } as Response;
      }
      assert.equal(url, "/api/remote-clients/qa-desktop/desktop");
      assert.equal(init?.method, "POST");
      stats.captures++; stats.inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      lastCaptureSignal = init?.signal ?? undefined;
      const result = nextCapture; nextCapture = undefined;
      try { return result ? await result : frameResponse(JSON.parse(String(init?.body || "{}")).monitorId); } finally { stats.inFlight--; }
    },
    setClients: (clients: RemoteClient[]) => { state.clients = clients; },
    setInventoryError: (value: string) => { state.inventoryError = value; },
    setLoading: () => {},
    setFrame: (frame: Frame | null) => { state.frame = frame; },
    setFrameError: (value: string) => { state.frameError = value; },
    notifyClientError: (error: unknown) => { errors.push(error); },
    setTimeout: (callback: () => unknown, delay: number) => {
      const id = ++nextTimer; timers.set(id, { callback, delay }); return id;
    },
    clearTimeout: (id: number | undefined) => { if (id !== undefined) timers.delete(id); },
    URL: {
      createObjectURL: (_blob: Blob) => {
        const url = "blob:frame-" + (++nextUrl); urls.add(url); stats.maxUrls = Math.max(stats.maxUrls, urls.size); return url;
      },
      revokeObjectURL: (url: string) => { urls.delete(url); },
    },
  };
  const makeEffects = vm.runInNewContext(compiled + "; renderEffects", context) as (values: {
    active: boolean; retry: number; deviceId: string | null; unavailable: string | null; paused: boolean; inventoryError: string;
  }) => Effect[];
  function render() {
    if (!mounted) return;
    const selected = chooseDesktopClient(state.clients, device.id);
    const next = makeEffects({ ...state, deviceId: selected?.id ?? null, unavailable: selected ? desktopUnavailableReason(selected) : null });
    next.forEach((effect, index) => {
      const previous = slots[index];
      if (previous && effect.deps.length === previous.deps.length && effect.deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      previous?.cleanup?.();
      if (index === 0) stats.inventoryStarts++; else stats.captureStarts++;
      slots[index] = { deps: effect.deps, cleanup: effect.run() };
    });
  }
  async function settle() {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      render();
    }
  }
  function fire(delay: number) {
    const next = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(next, "Expected one timer with delay " + delay);
    timers.delete(next[0]);
    return next[1].callback();
  }
  function visibility(hidden: boolean) {
    document.hidden = hidden;
    for (const callback of [...(listeners.get("visibilitychange") ?? [])]) callback();
  }
  function unmount() {
    mounted = false;
    for (const slot of slots) slot.cleanup?.();
  }
  render();
  return {
    state, stats, timers, urls, errors, render, settle, fire, visibility, unmount,
    get captureSignal() { return lastCaptureSignal; },
    listenerCount: () => listeners.get("visibilitychange")?.size ?? 0,
    deferCapture: () => { const pending = deferred<Response>(); nextCapture = pending.promise; return pending; },
    timerCount: (delay: number) => [...timers.values()].filter(timer => timer.delay === delay).length,
  };
}

test("desktop preview stays within a constant resource budget across 3000 frames and inventory refreshes", async () => {
  const h = harness();
  await h.settle();
  const captureStarts = h.stats.captureStarts;
  for (let i = 0; i < 3000; i++) {
    await h.fire(1000);
    if (i % 5 === 0) await h.fire(5000);
    await h.settle();
    assert.equal(h.urls.size, 1, "Only the displayed frame may remain live after replacement");
    assert.equal(h.timerCount(1000), 1);
    assert.equal(h.timerCount(5000), 1);
    assert.equal(h.listenerCount(), 2, "Inventory and capture each retain one stable listener");
    assert.equal(h.stats.captureStarts, captureStarts, "New inventory objects must not restart the capture effect");
  }
  assert.equal(h.stats.captures, 3001);
  assert.equal(h.stats.inventories, 601);
  assert.equal(h.stats.maxInFlight, 1);
  assert.equal(h.stats.maxUrls, 2, "Replacement briefly has the new and previous URL, then revokes the previous one");
  h.unmount();
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount(), 0);
  assert.equal(h.captureSignal?.aborted, true);
  assert.equal(h.errors.length, 0);
});

test("hiding aborts an in-flight frame, ignores its late response, and resumes one capture loop", async () => {
  const h = harness(); await h.settle();
  const pending = h.deferCapture();
  const loading = h.fire(1000);
  const staleSignal = h.captureSignal;
  h.visibility(true);
  assert.equal(staleSignal?.aborted, true);
  assert.equal(h.state.frame, null);
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
  pending.resolve(frameResponse()); await loading; await h.settle();
  assert.equal(h.state.frame, null); assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
  h.visibility(false); await h.settle();
  assert.ok(h.state.frame); assert.equal(h.urls.size, 1);
  assert.equal(h.timerCount(1000), 1); assert.equal(h.timerCount(5000), 1); assert.equal(h.listenerCount(), 2);
  h.unmount(); assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount(), 0);
});

test("a capture response arriving after unmount cannot allocate a URL or recreate a timer", async () => {
  const h = harness(); await h.settle();
  const pending = h.deferCapture(), loading = h.fire(1000);
  h.unmount();
  assert.equal(h.captureSignal?.aborted, true);
  pending.resolve(frameResponse()); await loading; await h.settle();
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount(), 0);
  assert.equal(h.errors.length, 0);
});

test("pause and inactive-workspace transitions release capture resources without multiplying inventory listeners", async () => {
  const h = harness(); await h.settle();
  const calls = h.stats.captures;
  h.state.paused = true; h.render(); await h.settle();
  assert.equal(h.urls.size, 0); assert.equal(h.timerCount(1000), 0); assert.equal(h.listenerCount(), 1);
  await h.fire(5000); await h.settle(); assert.equal(h.stats.captures, calls);
  h.state.paused = false; h.render(); await h.settle();
  assert.equal(h.stats.captures, calls + 1); assert.equal(h.urls.size, 1); assert.equal(h.listenerCount(), 2);
  h.state.active = false; h.render(); await h.settle();
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listenerCount(), 0);
  h.unmount();
});

test("changing monitors aborts the old capture and a late old-monitor frame cannot replace the new one", async () => {
  const h = harness(); await h.settle();
  h.state.monitorId = "left"; h.render(); await h.settle();
  assert.equal(h.state.frame?.sourceKey, JSON.stringify([device.id, "left"]));
  const pending = h.deferCapture();
  const oldCapture = h.fire(1000), oldSignal = h.captureSignal;
  h.state.monitorId = "primary"; h.render(); await h.settle();
  assert.equal(oldSignal?.aborted, true);
  assert.equal(h.state.frame?.sourceKey, JSON.stringify([device.id, "primary"]));
  const url = h.state.frame?.url;
  pending.resolve(frameResponse("left")); await oldCapture; await h.settle();
  assert.equal(h.state.frame?.url, url);
  assert.equal(h.urls.size, 1);
  h.unmount(); assert.equal(h.urls.size, 0);
});
test("simultaneous monitor previews isolate capture failures and clean up independently", async () => {
  const left = harness(), primary = harness();
  left.state.monitorId = "left"; primary.state.monitorId = "primary";
  await Promise.all([left.settle(), primary.settle()]);
  assert.equal(left.state.frame?.sourceKey, JSON.stringify([device.id, "left"]));
  assert.equal(primary.state.frame?.sourceKey, JSON.stringify([device.id, "primary"]));
  const pending = left.deferCapture(), request = left.fire(1000);
  pending.resolve(frameResponse("wrong-monitor")); await request; await left.settle();
  assert.match(left.state.frameError, /different monitor/);
  await primary.fire(1000); await primary.settle();
  assert.ok(primary.state.frame); assert.equal(primary.errors.length, 0);
  assert.equal(primary.urls.size, 1);
  left.unmount(); assert.equal(primary.timerCount(1000), 1);
  primary.unmount();
  for (const preview of [left, primary]) {
    assert.equal(preview.urls.size, 0); assert.equal(preview.timers.size, 0); assert.equal(preview.listenerCount(), 0);
  }
});
test("a frame claiming a different monitor stops the preview and releases its image", async () => {
  const h = harness(); h.state.monitorId = "left"; await h.settle();
  const pending = h.deferCapture(), request = h.fire(1000);
  pending.resolve(frameResponse("primary")); await request; await h.settle();
  assert.equal(h.state.frame, null);
  assert.match(h.state.frameError, /different monitor/);
  assert.equal(h.urls.size, 0); assert.equal(h.timerCount(1000), 0);
  h.unmount();
});
