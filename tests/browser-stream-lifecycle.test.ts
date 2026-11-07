import test from "node:test";
import {ProtectedBrowserRouting} from "../lib/protected-browser-routing";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("shell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (n: ts.Node) => boolean) { let found: ts.Node | undefined; function walk(n: ts.Node) { if (!found && predicate(n)) found = n; ts.forEachChild(n, walk); } walk(tree); assert.ok(found); return found!; }
function evaluate(fn: ts.Node, context: Record<string, unknown>) { const js = ts.transpileModule("const callback=" + fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; return new Function(...Object.keys(context), js + ";return callback;")(...Object.values(context)); }
const effect = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect" && n.arguments[0]?.getText(tree).includes("/api/browser/stream?")) as ts.CallExpression;
function harness(visible = true) {
  const frames: unknown[] = [], sockets: Array<{onmessage?: (e: { data: unknown }) => void; onclose?: () => void; close: () => void; closed?: boolean}> = [];
  let disposed = 0, ready: (() => void) | undefined;
  const socketRef = { current: null as unknown };
  const presenterRef = { current: null as unknown };
  const noop = () => {};
  const context: Record<string, unknown> = {
    browserStreamVisible: visible, browserEnabled: true, activeChatId: "chat", loadingChatId: null,
    browserScreenshotRef: { current: {} }, browserFramePresenterRef: presenterRef,
    createBrowserFramePresenter: (_: unknown, onFrame: () => void) => { ready = onFrame; return { push: (frame: unknown) => frames.push(frame), dispose: () => disposed++ }; },
    markBrowserFrameVisible: noop, beginBrowserLoading: noop, clearBrowserFrame: noop,
    browserUrlRef: { current: "" }, activeBrowserTabId: "browser-1", activeBrowserTabIdRef: { current: "browser-1" },
    browserRealtime: true, browserFps: 30, browserDefaultViewport: { width: 1280, height: 800 },
    browserSocketRef: socketRef, browserLoadingRef: { current: false },
    window: { location: { protocol: "http:", host: "test" }, setTimeout: () => 1, clearTimeout: noop },
    URLSearchParams, Blob,
    WebSocket: function () { const socket = { close() { this.closed = true; }, closed: false }; sockets.push(socket); return socket; },
    setBrowserLoading: noop, setBrowserError: noop,
  };
  const cleanup = evaluate(effect.arguments[0], context)();
  return { sockets, socketRef, presenterRef, frames, cleanup, get disposed() { return disposed; }, ready: () => ready?.() };
}
test("visibility contract excludes collapsed panes, other tabs, account/notebooks and hidden documents", () => {
  const decl = find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === "browserStreamVisible") as ts.VariableDeclaration;
  const base = { workspaceOpen: true, workspaceMounted: true, workspaceTab: "browser", accountView: null, notesOpen: false, automationsOpen: false, projectHomeId: null, browserDocumentVisible: true };
  const js = ts.transpileModule("const callback=()=>(" + decl.initializer!.getText(tree) + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const visible = (values: Record<string, unknown>) => new Function(...Object.keys(values), js + ";return callback();")(...Object.values(values));
  assert.equal(visible(base), true);
  for (const patch of [{ workspaceOpen: false }, { workspaceMounted: false }, { workspaceTab: "files" }, { accountView: "settings" }, { notesOpen: true }, { automationsOpen: true }, { projectHomeId: "project" }, { browserDocumentVisible: false }]) assert.equal(visible({ ...base, ...patch }), false);
});
test("hidden browser never connects; teardown disposes frames and stale messages cannot paint", () => {
  assert.equal(harness(false).sockets.length, 0);
  const h = harness();
  assert.equal(h.sockets.length, 1);
  const socket = h.sockets[0], blob = new Blob(["frame"]);
  socket.onmessage!({ data: blob }); assert.equal(h.frames[0], blob);
  h.cleanup(); assert.equal(h.disposed, 1); assert.equal(socket.closed, true); assert.equal(h.presenterRef.current, null);
  socket.onmessage!({ data: new Blob(["late"]) }); assert.equal(h.frames.length, 1);
});


// Exercise the real server handler with simulated capture and time, without
// starting a server, a browser, or a database.
const serverSource = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const serverTree = ts.createSourceFile("server.mjs", serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sendFrameDeclaration = serverTree.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "sendFrame")!;
const connectionStatement = serverTree.statements.find((node): node is ts.ExpressionStatement =>
  ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
  node.expression.expression.getText(serverTree) === "websocketServer.on" &&
  node.expression.arguments[0]?.getText(serverTree) === '"connection"')!;
const connectionCallback = (connectionStatement.expression as ts.CallExpression).arguments[1];
const streamFrame = () => ({ tabId: "browser-1", activeTabId: "browser-1", url: "https://fixture.test/", title: "Fixture", tabs: [], viewport: { width: 1280, height: 800 }, data: new Uint8Array([1, 2, 3]) });
type StreamFrame = ReturnType<typeof streamFrame>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settleStream() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
class StreamSocket {
  readyState = 1;
  bufferedAmount = 0;
  sendAttempts = 0;
  closes: Array<{ code?: number }> = [];
  sent: Array<{ data: unknown; binary: boolean }> = [];
  handlers = new Map<"message" | "close" | "error", Array<(raw?: string) => unknown>>();
  on(event: "message" | "close" | "error", callback: (raw?: string) => unknown) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), callback]);
    return this;
  }
  send(data: unknown, options?: { binary?: boolean }) {
    this.sendAttempts++;
    assert.equal(this.readyState, 1, "a disconnected socket must never receive a send attempt");
    this.sent.push({ data, binary: options?.binary === true });
  }
  close(code?: number) {
    this.closes.push({ code });
    this.readyState = 3;
    for (const callback of this.handlers.get("close") || []) callback();
  }
  async message(message: unknown) {
    await Promise.all((this.handlers.get("message") || []).map(callback => callback(JSON.stringify(message))));
  }
  errors() { return this.sent.filter(item => !item.binary).map(item => JSON.parse(String(item.data))).filter(message => message.type === "error"); }
  frames() { return this.sent.filter(item => item.binary); }
}
function backendHarness(capture: (attempt: number) => Promise<StreamFrame>, action = async () => streamFrame()) {
  const timers = new Map<number, { callback: () => unknown; delay: number }>();
  const subscribers = new Map<string, Set<(event: { tabId: string }) => void>>();
  const captures: unknown[][] = [], actions: unknown[][] = [];
  const protectedBrowserRouting=new ProtectedBrowserRouting(async()=>({status:"protected_browser_ready"}),async()=>{throw Error("No ordinary tab is needed for this fixture");});
  let nextTimer = 0;
  const context = {
    protectedBrowserRouting,
    captureBrowserFrame: (...args: unknown[]) => { captures.push(args); return capture(captures.length); },
    performSharedBrowserAction: (...args: unknown[]) => { actions.push(args); return action(); },
    setBrowserViewport: async () => {}, browserStreamSubscribers: subscribers,
    setTimeout: (callback: () => unknown, delay: number) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id?: number) => { if (id !== undefined) timers.delete(id); }, queueMicrotask,
  };
  const connectHandler = new Function(...Object.keys(context), sendFrameDeclaration.getText(serverTree) + ";return (" + connectionCallback.getText(serverTree) + ");")(...Object.values(context));
  return {
    timers, subscribers, captures, actions, protectedBrowserRouting,
    connect(options: Record<string, unknown> = {}) {
      const socket = new StreamSocket();
      const done = connectHandler(socket, {}, { userId: "owner", chatId: "chat" }, { tabId: "browser-1", realtime: false, ...options }) as Promise<void>;
      return { socket, done };
    },
    notify() { for (const callback of subscribers.get("owner:chat") || []) callback({ tabId: "browser-1" }); },
    async runTimer(delay: number) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, "expected a " + delay + "ms timer");
      timers.delete(entry[0]);
      await entry[1].callback();
      await settleStream();
    },
  };
}

test("protected sessions never capture or send images, including restoration by explicit tab identity",async()=>{
  for(const explicitTab of [false,true]){
    const h=backendHarness(async()=>streamFrame());
    if(!explicitTab)await h.protectedBrowserRouting.prepare("owner","chat",{tabId:"protected"});
    const {socket,done}=h.connect({tabId:explicitTab?"protected":"browser-1",frameAck:true});
    await done;
    assert.equal(h.captures.length,0);
    assert.equal(socket.frames().length,0);
    assert.match(socket.errors()[0]?.message??"",/Protected login/);
    socket.close();
  }
});

test("an opted-in slow client retains one unacknowledged image instead of a growing network backlog", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true, realtime: true, fps: 5 });
  await done;
  for (let i = 0; i < 1000; i++) {
    h.notify();
    const notify = [...h.timers.values()].find(timer => timer.delay === 45);
    if (notify) await h.runTimer(45);
    const periodic = [...h.timers.values()].find(timer => timer.delay === 200);
    if (periodic) await h.runTimer(200);
  }
  assert.equal(socket.frames().length, 1);
  assert.equal(h.captures.length, 1, "Do not encode images the client cannot consume");
  assert.ok(h.timers.size <= 1, "Only the acknowledgement deadline may remain");
  socket.close();
  assert.equal(h.timers.size, 0);
});

function frameSequences(socket: StreamSocket) {
  return socket.sent.filter(item => !item.binary).map(item => JSON.parse(String(item.data)))
    .filter(message => message.type === "frame").map(message => message.sequence as number);
}

test("a matching receipt releases only one paced latest frame with current metadata", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true, realtime: true, fps: 5 });
  await done;
  assert.deepEqual(frameSequences(socket), [1]);
  const headerIndex = socket.sent.findIndex(item => !item.binary && JSON.parse(String(item.data)).type === "frame");
  assert.ok(socket.sent[headerIndex + 1].binary, "The sequence header immediately precedes its binary image");
  for (let i = 0; i < 2000; i++) h.notify();
  assert.equal(h.timers.size, 1, "notifications while decoding retain only one deadline");
  await socket.message({ type: "frame_ack", sequence: 1 });
  assert.equal(socket.frames().length, 1, "receipt is paced rather than an immediate capture");
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [200]);
  await h.runTimer(200);
  assert.deepEqual(frameSequences(socket), [1, 2]);
  assert.equal(h.captures.length, 2);
  assert.equal(h.captures[1][4], true, "coalesced actions still refresh browser metadata");
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [30_000]);
  socket.close();
  assert.equal(h.timers.size, 0);
  assert.equal(h.subscribers.size, 0);
});

test("wrong, stale and duplicated receipts cannot release an outstanding image", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true, realtime: true, fps: 5 });
  await done;
  for (const invalid of [null, "frame_ack", [], 1, true]) await socket.message(invalid);
  for (const sequence of [undefined, null, "1", 0, -1, 1.5, 2, Number.MAX_SAFE_INTEGER + 1]) {
    await socket.message({ type: "frame_ack", sequence });
  }
  assert.equal(h.captures.length, 1);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [30_000]);
  await socket.message({ type: "frame_ack", sequence: 1 });
  await socket.message({ type: "frame_ack", sequence: 1 });
  assert.equal(h.timers.size, 1);
  await h.runTimer(200);
  await socket.message({ type: "frame_ack", sequence: 1 });
  assert.equal(h.captures.length, 2);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [30_000]);
  socket.close();
});

test("action-driven receipts do not create an unsolicited continuous capture loop", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true });
  await done;
  await socket.message({ type: "frame_ack", sequence: 1 });
  assert.equal(h.timers.size, 0);
  h.notify();
  await h.runTimer(45);
  assert.deepEqual(frameSequences(socket), [1, 2]);
  await socket.message({ type: "frame_ack", sequence: 2 });
  assert.equal(h.timers.size, 0);
  socket.close();
});

test("unconsumed images close only their stream socket at the bounded receipt deadline", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true, realtime: true });
  await done;
  h.notify();
  await h.runTimer(30_000);
  assert.deepEqual(socket.closes, [{ code: 1011 }]);
  assert.match(socket.errors()[0].message, /acknowledgement timed out/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.subscribers.size, 0);
  await socket.message({ type: "frame_ack", sequence: 1 });
  h.notify();
  assert.equal(h.captures.length, 1);
});

test("legacy clients retain their existing binary-only periodic stream", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ realtime: true, fps: 5 });
  await done;
  await socket.message({ type: "frame_ack", sequence: 1 });
  for (let i = 0; i < 10; i++) await h.runTimer(200);
  assert.equal(socket.frames().length, 11);
  assert.deepEqual(frameSequences(socket), []);
  assert.equal(h.timers.size, 1);
  socket.close();
  assert.equal(h.timers.size, 0);
});

test("thousands of receipt cycles keep one image and one timer in flight", async () => {
  const h = backendHarness(async () => streamFrame());
  const { socket, done } = h.connect({ frameAck: true, realtime: true, fps: 30 });
  await done;
  for (let sequence = 1; sequence <= 2000; sequence++) {
    assert.equal(h.captures.length, sequence);
    await socket.message({ type: "frame_ack", sequence });
    assert.equal(h.timers.size, 1);
    await h.runTimer(33);
    assert.equal(h.timers.size, 1);
  }
  assert.equal(socket.frames().length, 2001);
  assert.equal(frameSequences(socket).at(-1), 2001);
  socket.close();
  assert.equal(h.timers.size, 0);
});

test("opt-in startup retry reserves a sequence only when a frame is actually sent", async () => {
  const h = backendHarness(async attempt => {
    if (attempt === 1) throw new Error("transient");
    return streamFrame();
  });
  const { socket, done } = h.connect({ frameAck: true });
  await done;
  assert.deepEqual(frameSequences(socket), []);
  await h.runTimer(500);
  assert.deepEqual(frameSequences(socket), [1]);
  await socket.message({ type: "frame_ack", sequence: 1 });
  assert.equal(h.timers.size, 0);
  socket.close();
});

test("action-driven stream silently retries a transient initial capture without another action", async () => {
  const h = backendHarness(async attempt => {
    if (attempt === 1) throw new Error("Temporary screenshot failure");
    return streamFrame();
  });
  const { socket, done } = h.connect();
  await done;
  assert.equal(socket.readyState, 1);
  assert.deepEqual(socket.sent, [], "a recoverable first failure must not leave a stale error banner");
  h.notify(); h.notify();
  await h.runTimer(45);
  assert.equal(h.captures.length, 1, "notifications must respect the retry backoff");
  await h.runTimer(500);
  assert.equal(socket.frames().length, 1);
  assert.equal(socket.errors().length, 0);
  assert.equal(h.captures.length, 2);
  assert.equal(h.actions.length, 0);
  assert.equal(h.timers.size, 0);
  socket.close();
});

test("repeated initial capture failure reports diagnostics, closes once, and a new connection recovers", async () => {
  const h = backendHarness(async attempt => {
    if (attempt <= 2) throw new Error("Playwright Chromium is not installed. Click Install browser");
    return streamFrame();
  });
  const first = h.connect();
  await first.done;
  await h.runTimer(500);
  assert.deepEqual(first.socket.closes, [{ code: 1011 }]);
  assert.match(first.socket.errors()[0].message, /Chromium is not installed/);
  assert.equal(h.subscribers.size, 0);
  assert.equal(h.timers.size, 0, "a failed socket must not retry in a hot loop");
  const next = h.connect();
  await next.done;
  assert.equal(next.socket.frames().length, 1);
  assert.equal(h.captures.length, 3);
  assert.deepEqual(h.captures.map(args => args.slice(0, 3)), Array(3).fill(["owner", "chat", "browser-1"]));
  assert.equal(h.actions.length, 0, "recovery must retain the session and require no browser action");
  next.socket.close();
});

for (const completion of ["resolve", "reject"] as const) {
  test("disconnect during capture ignores late " + completion + " without sending or rejecting", async () => {
    const capture = deferred<StreamFrame>();
    const h = backendHarness(() => capture.promise);
    const { socket, done } = h.connect();
    assert.equal(h.captures.length, 1);
    socket.close();
    if (completion === "resolve") capture.resolve(streamFrame());
    else capture.reject(new Error("Capture completed after disconnect"));
    await assert.doesNotReject(done);
    await settleStream();
    assert.equal(socket.sendAttempts, 0);
    assert.equal(h.subscribers.size, 0);
    assert.equal(h.timers.size, 0);
  });
}

test("disconnect during an asynchronous browser action suppresses its metadata response", async () => {
  const action = deferred<StreamFrame>();
  const h = backendHarness(async () => streamFrame(), () => action.promise);
  const { socket, done } = h.connect();
  await done;
  const attempts = socket.sendAttempts;
  const pending = socket.message({ type: "action", action: "hover" });
  socket.close();
  action.resolve(streamFrame());
  await assert.doesNotReject(pending);
  assert.equal(socket.sendAttempts, attempts);
});

test("action bursts coalesce into one capture after the in-flight image", async () => {
  const first = deferred<StreamFrame>(), second = deferred<StreamFrame>();
  const h = backendHarness(attempt => attempt === 1 ? first.promise : second.promise);
  const { socket, done } = h.connect();
  h.notify(); h.notify(); h.notify();
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 45).length, 1);
  await h.runTimer(45);
  h.notify(); h.notify();
  await h.runTimer(45);
  assert.equal(h.captures.length, 1);
  first.resolve(streamFrame());
  await done;
  await settleStream();
  assert.equal(h.captures.length, 2);
  second.resolve(streamFrame());
  await settleStream();
  assert.equal(socket.frames().length, 2);
  assert.equal(h.captures.length, 2);
  assert.equal(h.timers.size, 0);
  socket.close();
});

test("a hanging first capture closes only its image socket after the startup deadline", async () => {
  const capture = deferred<StreamFrame>();
  const h = backendHarness(() => capture.promise);
  const { socket, done } = h.connect();
  await h.runTimer(30_000);
  assert.deepEqual(socket.closes, [{ code: 1011 }]);
  assert.match(socket.errors()[0].message, /startup timed out/);
  assert.equal(h.subscribers.size, 0);
  capture.resolve(streamFrame());
  await done;
  assert.equal(socket.frames().length, 0);
  assert.equal(h.actions.length, 0);
  assert.equal(h.timers.size, 0);
});
