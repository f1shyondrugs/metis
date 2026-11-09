import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteDesktopEvent } from "../lib/remote-desktop-events";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("passive desktop API, compatible clients and live activity preserve account and permission boundaries", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-desktop-"));
  Object.assign(process.env, { AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: root, CHAT_DATA_DIR: root,
    CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"),
    AI_CHAT_SECRETS_KEY: "desktop-test-only", NODE_ENV: "test", MCP_BEARER_TOKEN: "desktop-test-only",
    AI_CHAT_TEST_BYPASS_LEASE: "1" });
  const auth = await import("../lib/auth"), clients = await import("../lib/remote-clients");
  const gateway = await import("../lib/remote-client-gateway"), store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs"), events = await import("../lib/remote-desktop-events");
  const { createDesktopCapture } = await import("../lib/remote-desktop-capture");
  const api = await import("../app/api/remote-clients/[id]/desktop/route");
  const live = await import("../app/api/remote-clients/live/route");
  const internal = await import("../app/api/internal/remote-client/route");
  const { chooseDesktopClient, desktopUnavailableReason } = await import("../lib/remote-desktop-view");
  const db = (await import("../lib/sqlite")).getDatabase();
  const owner = auth.createUser("desktop-owner", "test-password"), other = auth.createUser("desktop-other", "test-password");
  const session = auth.authenticateUser("desktop-owner", "test-password")!;
  const otherSession = auth.authenticateUser("desktop-other", "test-password")!;
  const client = clients.registerRemoteClient(clients.createEnrollmentToken(owner.id, undefined, "admin").token,
    { name: "Desktop fixture", permissionMode: "admin", os: "windows", capabilities: ["desktop_gui"] })!.client!;
  const image = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#112233" } }).jpeg().toBuffer();
  const sent: Array<{ action: string; params: Record<string, unknown> }> = [];
  const socket = new EventEmitter() as EventEmitter & { readyState: number; send(data: string): void; close(): void };
  socket.readyState = 1;
  socket.close = () => { socket.readyState = 3; socket.emit("close"); };
  socket.send = data => {
    const request = JSON.parse(data); sent.push(request);
    queueMicrotask(() => socket.emit("message", JSON.stringify({ type: "response", requestId: request.requestId, ok: true,
      result: { image_base64: image.toString("base64"), mimeType: "image/jpeg" } })));
  };
  gateway.attachRemoteClient(socket, client.id, owner.id);
  const request = (token?: string) => new Request("http://localhost/api/remote-clients/" + client.id + "/desktop",
    { method: "POST", headers: token ? { cookie: "ai_chat_auth=" + token } : {} });
  const context = { params: Promise.resolve({ id: client.id }) };
  try {
    assert.equal((await api.POST(request(), context)).status, 401);
    assert.equal((await api.POST(request(otherSession.token), context)).status, 404);
    assert.equal(sent.length, 0);
    const response = await api.POST(request(session.token), context);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
    const frame = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(frame.width, 1600); assert.equal(frame.height, 800);
    assert.deepEqual(sent[0].params, { operation: "preview" });
    assert.equal(clients.listRemoteAudit(owner.id).length, 0, "frames must never enter the audit database");

    let captures = 0;
    const capture = createDesktopCapture(async () => { captures++; await new Promise(resolve => setTimeout(resolve, 20));
      return { image_base64: image.toString("base64") }; });
    const frames = await Promise.all([capture(client.id, owner.id), capture(client.id, owner.id)]);
    assert.equal(captures, 1); assert.equal(frames[0], frames[1], "concurrent viewers share one in-flight frame");

    clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "restricted", permissions: ["computer_use"] } });
    const native = createDesktopCapture(async input => { assert.equal(input.action, "computer_use"); return { image_base64: image.toString("base64") }; });
    await native(client.id, owner.id);
    const blockedLegacy = createDesktopCapture(async () => { throw new Error("Unsupported computer use operation"); });
    await assert.rejects(blockedLegacy(client.id, owner.id), /Update this Remote Client/);
    clients.updateRemoteClient(client.id, owner.id, { policy: { mode: "full_access", permissions: ["computer_use", "execute_command"] } });
    const legacy = createDesktopCapture(async input => {
      if (input.action === "computer_use") throw new Error("Unsupported computer use operation");
      assert.equal(input.ephemeralPreview, true);
      assert.match(String(input.params?.command), /^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
      return { stdout: JSON.stringify({ image_base64: image.toString("base64") }) };
    });
    await legacy(client.id, owner.id);
    await assert.rejects(createDesktopCapture(async () => ({ image_base64: "invalid" }))(client.id, owner.id));

    clients.updateRemoteClient(client.id, owner.id, { policy: { permissions: [] } });
    assert.equal((await api.POST(request(session.token), context)).status, 403);
    clients.updateRemoteClient(client.id, owner.id, { policy: { permissions: ["computer_use"] } });
    const chat = store.createChat("Desktop events", undefined, owner.id);
    const job = jobs.enqueueJob({ userId: owner.id, chatId: chat.id, message: "Fixture" });
    jobs.updateJob(job.id, { status: "running" });
    const streamController = new AbortController();
    const streamReq = new Request("http://localhost/api/remote-clients/live?chatId=" + chat.id,
      { headers: { cookie: "ai_chat_auth=" + session.token }, signal: streamController.signal });
    assert.equal((await live.GET(new Request(streamReq.url, { headers: { cookie: "ai_chat_auth=" + otherSession.token } }))).status, 404);
    const listeners = events.remoteDesktopEvents.listenerCount("activity");
    const stream = await live.GET(streamReq), reader = stream.body!.getReader();
    await reader.read(); // retry prelude
    assert.equal(events.remoteDesktopEvents.listenerCount("activity"), listeners + 1);
    const emitted: Array<RemoteDesktopEvent> = [];
    const collect = (event: RemoteDesktopEvent) => emitted.push(event);
    events.remoteDesktopEvents.on("activity", collect);
    const internalReq = new Request("http://localhost/api/internal/remote-client", { method: "POST",
      headers: { authorization: "Bearer desktop-test-only", "x-ai-chat-user-id": owner.id, "x-ai-chat-job-id": job.id },
      body: JSON.stringify({ clientId: client.id, action: "computer_use", source: "agent", params: { operation: "status" }, chatId: "spoofed" }) });
    assert.equal((await internal.POST(internalReq)).status, 200);
    assert.equal(emitted.length, 2); assert.deepEqual(emitted.map(event => event.phase), ["start", "end"]);
    assert.equal(emitted[0].chatId, chat.id, "chat identity comes from the leased job");
    assert.equal(events.matchesDesktopEvent(emitted[0], other.id, chat.id), false);
    assert.equal(events.matchesDesktopEvent(emitted[0], owner.id, "other-chat"), false);
    const text = new TextDecoder().decode((await reader.read()).value);
    assert.match(text, /"phase":"start"/); assert.ok(!text.includes(owner.id)); assert.ok(!text.includes("image_base64"));
    streamController.abort(); await reader.cancel();
    events.remoteDesktopEvents.off("activity", collect);
    assert.equal(events.remoteDesktopEvents.listenerCount("activity"), listeners);
    socket.close();
    assert.equal((await api.POST(request(session.token), context)).status, 409);
    const offline = clients.getRemoteClient(client.id, owner.id)!;
    assert.match(desktopUnavailableReason(offline)!, /offline/);
    assert.equal(chooseDesktopClient([offline], client.id)?.id, client.id, "offline selections remain visible");
    assert.equal(chooseDesktopClient([], null), null);
    const online = { ...offline, status: "online" as const };
    assert.equal(chooseDesktopClient([online, offline], null), null, "opening Desktops must wait for a user choice");
    assert.equal(chooseDesktopClient([online], "removed-device"), null, "a missing choice must not fall back to a different desktop");
    assert.equal(chooseDesktopClient([online], online.id)?.id, online.id, "an explicit online choice opens that desktop");
  } finally { socket.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});
