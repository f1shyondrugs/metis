import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { WebSocketServer } from "ws";

// Next's custom-server entrypoint expects this Node primitive to be exposed
// globally. The regular `next start` launcher does this during its bootstrap,
// but a custom server loaded through tsx does not.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
const {
  initializeRequestNetwork, stampRequestNetwork, browserStreamOriginAllowed,
} = await import("./lib/request-network.ts");
initializeRequestNetwork();
const { default: next } = await import("next");
const { getAuthenticatedUser } = await import("./lib/auth.ts");
const { updateChatOffThread } = await import("./lib/chat-page-loader.ts");
const {
  captureBrowserFrame,
  closeBrowserSession,
  cleanupBrowserSessions,
  performBrowserAction,
  setBrowserViewport,
  browserEvents,
} = await import("./lib/server-browser.ts");
const {
  authenticateClientMessage,
  attachRemoteClient,
} = await import("./lib/remote-client-gateway.ts");
const { logError } = await import("./lib/error-logs.ts");
const { startUpdateScheduler } = await import("./lib/update-schedule.ts");
const { startNotificationObserver } = await import("./lib/notification-observer-thread.ts");

const port = Number(process.env.PORT || 3100);
const host = process.env.AI_CHAT_HOST?.trim() || "127.0.0.1";
const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, hostname: host, port });
const handle = nextApp.getRequestHandler();
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
websocketServer.on("error", (error) => {
  logError({
    level: "error",
    source: "ws",
    message: `Browser WebSocket server error: ${error.message}`,
    stack: error.stack,
  });
});
const remoteClientWebsocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
remoteClientWebsocketServer.on("error", (error) => {
  logError({
    level: "error",
    source: "ws",
    message: `Remote-client WebSocket server error: ${error.message}`,
    stack: error.stack,
  });
});
const browserStreamSubscribers = new Map();
const browserContextSignatures = new Map();
const MAX_BROWSER_CONTEXT_SIGNATURES = 2_000;
let lastBrowserCleanupAt = 0;
let browserCleanupInFlight = null;
// Action-driven stream fanout. This also catches steps inside browser_batch, so
// the sidebar advances while a long form is being completed instead of only
// showing the final page. Background redirects are intentionally ignored.
browserEvents.on("browser-event", (event) => {
  if (!event || (event.type !== "action" && event.type !== "navigation")) return;
  if (event.source !== "agent" && event.source !== "user") return;
  const subscribers = browserStreamSubscribers.get(`${event.ownerId}:${event.chatId}`);
  if (!subscribers?.size) return;
  for (const notify of subscribers) {
    Promise.resolve(notify(event)).catch(() => undefined);
  }
});

function streamUrl(request) {
  const host = request.headers.host || `127.0.0.1:${port}`;
  return new URL(`http://${host}${request.url || "/"}`);
}

async function authenticate(request, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const user = await getAuthenticatedUser(new Request(url, { headers }));
  const chatId = url.searchParams.get("chatId")?.trim();
  return user && chatId ? { userId: user.id || user.username, chatId } : null;
}

function internalEngineAuthorized(request) {
  const configured =
    process.env.AI_CHAT_INTERNAL_TOKEN?.trim() ||
    process.env.MCP_BEARER_TOKEN?.trim();
  if (configured) {
    return request.headers.authorization === `Bearer ${configured}`;
  }
  return false;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function persistBrowserContext(userId, chatId, result) {
  const key = `${userId}:${chatId}`;
  const signature = JSON.stringify({
    activeTabId: result.activeTabId || result.tabId,
    tabs: (result.tabs || []).map((tab) => [tab.id, tab.url]),
  });
  if (browserContextSignatures.get(key) === signature) return;
  browserContextSignatures.delete(key);
  browserContextSignatures.set(key, signature);
  while (browserContextSignatures.size > MAX_BROWSER_CONTEXT_SIGNATURES) {
    const oldest = browserContextSignatures.keys().next().value;
    if (oldest === undefined) break;
    browserContextSignatures.delete(oldest);
  }
  try { await updateChatOffThread(chatId, userId, {
    browserContext: {
      tabs: result.tabs,
      activeTabId: result.activeTabId || result.tabId,
      sessionKey: chatId,
      updatedAt: new Date().toISOString(),
    },
  }); } catch {
    // The browser action already succeeded. Retry its advisory context on the
    // next refresh rather than causing callers to repeat a completed action.
    if(browserContextSignatures.get(key)===signature)browserContextSignatures.delete(key);
    console.warn("[browser] Context persistence deferred");
  }
}

async function performSharedBrowserAction(userId, chatId, action) {
  const now = Date.now();
  if (now - lastBrowserCleanupAt > 60_000) {
    lastBrowserCleanupAt = now;
    await cleanupBrowserSessions();
  }
  if (action.action === "close") {
    await closeBrowserSession(userId, chatId);
    browserContextSignatures.delete(`${userId}:${chatId}`);
    return { closed: true };
  }
  const result = await performBrowserAction(userId, chatId, action);
  await persistBrowserContext(userId, chatId, result);
  return result;
}

async function handleBrowserEngine(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!internalEngineAuthorized(request)) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const userId = String(request.headers["x-ai-chat-user-id"] || "").trim();
  const chatId = String(request.headers["x-ai-chat-id"] || "").trim();
  if (!userId || !chatId) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Chat and user context are required" }));
    return;
  }
  try {
    const action = await readRequestJson(request);
    const result = await performSharedBrowserAction(userId, chatId, action);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : "Browser action failed",
    }));
  }
}

async function sendFrame(socket, context, tabId, quality, streamState, includeMetadata = false) {
  if (socket.readyState !== 1 || socket.bufferedAmount > 2_000_000 || streamState.awaitingAck) return;
  const frame = await captureBrowserFrame(context.userId, context.chatId, tabId, quality, includeMetadata);
  if (socket.readyState !== 1) return;
  if (includeMetadata) {
    const metadataKey = JSON.stringify({
      tabId: frame.tabId,
      activeTabId: frame.activeTabId,
      url: frame.url,
      title: frame.title,
      tabs: frame.tabs,
      viewport: frame.viewport,
    });
    if (metadataKey !== streamState.metadataKey) {
      streamState.metadataKey = metadataKey;
      socket.send(JSON.stringify({
        type: "meta",
        tabId: frame.tabId,
        activeTabId: frame.activeTabId,
        url: frame.url,
        title: frame.title,
        tabs: frame.tabs,
        viewport: frame.viewport,
      }));
    }
  }
  if (socket.readyState !== 1) return;
  if (streamState.frameAck) {
    // TCP delivery does not mean the browser has decoded/painted an image.
    // An opt-in client owns at most this one image until its matching receipt.
    streamState.sequence += 1;
    streamState.awaitingAck = streamState.sequence;
    socket.send(JSON.stringify({ type: "frame", sequence: streamState.sequence }));
  }
  socket.send(frame.data, { binary: true });
  return frame.tabId;
}

websocketServer.on("connection", async (socket, request, context, options) => {
  let tabId = options.tabId;
  let inFlight = false;
  let stopped = false;
  let pendingPush = false;
  let pendingMetadata = false;
  let timer;
  let startupTimer = null;
  let initialRetryTimer = null;
  let acknowledgementTimer = null;
  let initialFrameSent = false;
  let initialCaptureRetries = 0;
  const streamState = { metadataKey: "", frameAck: options.frameAck === true, sequence: 0, awaitingAck: 0 };
  const fps = Math.max(1, Math.min(Number(options.fps) || 5, 30));
  const quality = Math.max(35, Math.min(Number(options.quality) || 70, 90));
  const realtime = options.realtime !== false;
  const scheduleNextFrame = () => {
    if (stopped || timer || streamState.awaitingAck) return;
    timer = setTimeout(async () => {
      timer = null;
      await push();
      // Opt-in streams resume from the client's acknowledgement instead.
      if (realtime && !streamState.frameAck) scheduleNextFrame();
    }, Math.round(1000 / fps));
  };

  const push = async (includeMetadata = false) => {
    if (stopped || socket.readyState !== 1 || initialRetryTimer) return;
    if (inFlight || streamState.awaitingAck) {
      pendingPush = true;
      pendingMetadata ||= includeMetadata;
      return;
    }
    const nextMetadata = includeMetadata || pendingMetadata;
    pendingPush = pendingMetadata = false;
    inFlight = true;
    try {
      const sentTabId = await sendFrame(socket, context, tabId, quality, streamState, nextMetadata);
      if (sentTabId !== undefined && !stopped) {
        tabId = sentTabId;
        initialFrameSent = true;
        if (startupTimer) clearTimeout(startupTimer);
        startupTimer = null;
        if (streamState.awaitingAck) {
          acknowledgementTimer = setTimeout(() => {
            acknowledgementTimer = null;
            failStream(new Error("Browser image acknowledgement timed out"));
          }, 30_000);
        }
      }
    } catch (error) {
      if (stopped || socket.readyState !== 1) return;
      // If a send failed after reserving a sequence, no matching image can
      // settle on the client. Release it before the normal bounded recovery.
      streamState.awaitingAck = 0;
      if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
      acknowledgementTimer = null;
      if (!initialFrameSent && initialCaptureRetries === 0) {
        // One transient first-frame failure should recover without an action or
        // leaving an error banner over the successful retry.
        initialCaptureRetries += 1;
        pendingPush = false;
        pendingMetadata = false;
        initialRetryTimer = setTimeout(() => {
          initialRetryTimer = null;
          void push(true);
        }, 500);
      } else {
        failStream(error);
      }
    } finally {
      inFlight = false;
      if (pendingPush && !stopped && !initialRetryTimer && !streamState.awaitingAck) {
        if (streamState.frameAck) scheduleNextFrame();
        else {
          const nextMetadata = pendingMetadata;
          pendingPush = pendingMetadata = false;
          queueMicrotask(() => void push(nextMetadata));
        }
      }
    }
  };

  const subscriberKey = `${context.userId}:${context.chatId}`;
  const subscribers = browserStreamSubscribers.get(subscriberKey) || new Set();
  let notifyTimer = null;
  const notify = (event) => {
    if (stopped) return;
    if (event?.tabId) tabId = event.tabId;
    streamState.metadataKey = "";
    if (streamState.awaitingAck) {
      pendingPush = pendingMetadata = true;
      return;
    }
    // Small debounce lets the DOM settle after a click/type while preserving a
    // near-live preview. Bursts are coalesced instead of scheduling one image
    // encode per tool event. push() also remembers one update while in flight.
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      void push(true);
    }, 45);
  };
  subscribers.add(notify);
  browserStreamSubscribers.set(subscriberKey, subscribers);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (notifyTimer) clearTimeout(notifyTimer);
    if (startupTimer) clearTimeout(startupTimer);
    if (initialRetryTimer) clearTimeout(initialRetryTimer);
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
    timer = notifyTimer = startupTimer = initialRetryTimer = acknowledgementTimer = null;
    streamState.awaitingAck = 0;
    pendingPush = pendingMetadata = false;
    subscribers.delete(notify);
    if (!subscribers.size) browserStreamSubscribers.delete(subscriberKey);
  };
  const failStream = (error) => {
    if (stopped) return;
    stop();
    if (socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Browser stream failed" }));
    } catch {
      // The image client may disconnect while the capture is in flight.
    }
    try { socket.close(1011, "Browser stream failed"); } catch { /* Already closed. */ }
  };

  socket.on("message", async (raw) => {
    if (stopped || socket.readyState !== 1) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.type === "frame_ack") {
      if (!streamState.frameAck || !Number.isSafeInteger(message.sequence) ||
          !streamState.awaitingAck || message.sequence !== streamState.awaitingAck) return;
      streamState.awaitingAck = 0;
      if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
      acknowledgementTimer = null;
      if (pendingPush || realtime) scheduleNextFrame();
      return;
    }
    if (message.type !== "action" || !message.action) return;
    try {
      const result = await performSharedBrowserAction(context.userId, context.chatId, {
        action: message.action,
        tabId: message.tabId || tabId,
        url: message.url,
        selector: message.selector,
        text: message.text,
        key: message.key,
        x: message.x,
        y: message.y,
        deltaY: message.deltaY,
        width: message.width,
        height: message.height,
      });
      if (stopped || socket.readyState !== 1) return;
      tabId = result.tabId;
      socket.send(JSON.stringify({
        type: "meta",
        tabId: result.tabId,
        activeTabId: result.activeTabId,
        url: result.url === "about:blank" ? "" : result.url,
        title: result.title,
        viewport: result.viewport,
        tabs: result.tabs,
      }));
    } catch (error) {
      if (stopped || socket.readyState !== 1) return;
      try {
        socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Browser action failed" }));
      } catch { stop(); }
    }
  });

  socket.on("close", stop);
  socket.on("error", stop);
  // Capture/session startup can stall before Playwright's screenshot timeout.
  // Close only the image socket so the client can reconnect to the same tabs.
  startupTimer = setTimeout(() => failStream(new Error("Browser image startup timed out")), 30_000);
  try {
    if (options.width && options.height) {
      await setBrowserViewport(context.userId, context.chatId, options.width, options.height);
    }
    await push(true);
  } catch (error) {
    failStream(error);
    return;
  }
  if (!realtime || stopped) return;
  scheduleNextFrame();
});

remoteClientWebsocketServer.on("connection", (socket, request) => {
  let authenticated = false;
  const timer = setTimeout(() => {
    if (!authenticated) socket.close();
  }, 10_000);
  socket.once("message", (raw) => {
    try {
      const auth = authenticateClientMessage(JSON.parse(raw.toString()));
      if (!auth) {
        socket.close();
        return;
      }
      authenticated = true;
      clearTimeout(timer);
      attachRemoteClient(socket, auth.clientId, auth.ownerId, request.socket.remoteAddress);
      socket.send(JSON.stringify({ type: "authenticated", clientId: auth.clientId }));
    } catch {
      socket.close();
    }
  });
  socket.on("error", () => clearTimeout(timer));
});

const { initializeSetupToken } = await import("./lib/setup-token.ts");
const setupAccess = initializeSetupToken();
if (setupAccess.required) {
  console.log(setupAccess.tokenFile
    ? `[setup] First account requires the operator token from ${setupAccess.tokenFile}.`
    : "[setup] First account requires the operator-configured AI_CHAT_SETUP_TOKEN.");
}
await nextApp.prepare();
startUpdateScheduler();

const browserCleanupTimer = setInterval(() => {
  if (browserCleanupInFlight) return;
  browserCleanupInFlight = cleanupBrowserSessions()
    .catch(() => undefined)
    .finally(() => {
      browserCleanupInFlight = null;
    });
}, 60_000);
browserCleanupTimer.unref?.();

const server = http.createServer(async (request, response) => {
  try {
    stampRequestNetwork(request);
    const url = streamUrl(request);
    if (url.pathname === "/__internal/browser-engine") {
      await handleBrowserEngine(request, response);
      return;
    }
    await handle(request, response);
  } catch (error) {
    logError({
      level: "error",
      source: "ws",
      message: `Stream request handler failed: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack : undefined,
      context: { url: request.url },
    });
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Stream request failed" }));
    } else {
      response.destroy();
    }
  }
});
server.on("upgrade", async (request, socket, head) => {
  const url = streamUrl(request);
  if (url.pathname === "/ws/remote-client") {
    remoteClientWebsocketServer.handleUpgrade(request, socket, head, (client) => {
      remoteClientWebsocketServer.emit("connection", client, request);
    });
    return;
  }
  if (url.pathname !== "/api/browser/stream") {
    socket.destroy();
    return;
  }
  try {
    if (!browserStreamOriginAllowed(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    stampRequestNetwork(request);
    const context = await authenticate(request, url);
    if (!context) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request, context, {
        tabId: url.searchParams.get("tabId") || undefined,
        fps: url.searchParams.get("fps"),
        quality: url.searchParams.get("quality"),
        realtime: url.searchParams.get("realtime") !== "0",
        frameAck: url.searchParams.get("frameAck") === "1",
        width: url.searchParams.get("width"),
        height: url.searchParams.get("height"),
      });
    });
  } catch (error) {
    logError({
      level: "error",
      source: "ws",
      message: `WebSocket upgrade failed: ${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack : undefined,
      context: { pathname: url.pathname },
    });
    socket.destroy();
  }
});

const stopNotificationObserver = startNotificationObserver();
server.listen(port, host, () => {
  const publicUrl = process.env.AI_CHAT_PUBLIC_URL?.trim() || `http://${host}:${port}`;
  console.log(`AI Chat listening on ${publicUrl} (bound to ${host}:${port})`);
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopNotificationObserver();
  console.log(`[server] ${signal} received; shutting down`);

  // WebSocket/SSE clients can otherwise keep the process alive until systemd's
  // stop timeout and turn a routine deploy into SIGKILL. Stop accepting new
  // HTTP connections, close live sockets, and retain a short hard deadline.
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  for (const wsServer of [websocketServer, remoteClientWebsocketServer]) {
    for (const client of wsServer.clients) {
      try { client.close(1001, "Server restarting"); } catch {}
    }
    try { wsServer.close(); } catch {}
  }
  server.closeAllConnections?.();

  const deadline = setTimeout(() => process.exit(0), 5_000);
  deadline.unref();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
