import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-remote-approval-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;

test("new remote clients default to user access and deny escalation", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, registerRemoteClient } = await import("../lib/remote-clients");
  const owner = createUser("remote-owner", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "test-client" });
  assert.ok(registered?.client);
  assert.equal(registered.client.permissionMode, "user");
  assert.equal(registered.client.policy.mode, "approval_required");
  assert.equal(authorizeRemoteAction(registered.client, "execute_command", "rm -rf /").allowed, false);
  assert.equal(authorizeRemoteAction(registered.client, "write_file").allowed, false);
});

test("admin clients require approval for risky actions", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, getRemoteClient, registerRemoteClient } = await import("../lib/remote-clients");
  const { getDatabase } = await import("../lib/sqlite");
  const owner = createUser("remote-admin", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "admin-client", permissionMode: "admin" });
  assert.ok(registered?.client);
  getDatabase().prepare("UPDATE remote_clients SET policy = ? WHERE id = ?").run(JSON.stringify({ mode: "full_access", allowlist: [] }), registered.client.id);
  const client = getRemoteClient(registered.client.id, owner.id);
  assert.ok(client);
  assert.equal(client.permissionMode, "admin");
  assert.equal(authorizeRemoteAction(client, "delete_file").requiresApproval, true);
  assert.equal(authorizeRemoteAction(client, "delete_file").allowed, true);
});

test("remote MCP schema does not expose model-controlled approval", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(path.join(process.cwd(), "lib/mcp-core/gateway-core.mjs"), "utf8");
  assert.doesNotMatch(source, /args\.approved|approved: true/);
});

test("device hub audit records results, redacts output, and marks disconnects as unclear", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient, updateRemoteClient, listRemoteAudit } = await import("../lib/remote-clients");
  const { attachRemoteClient, requestRemoteClient } = await import("../lib/remote-client-gateway");
  const owner = createUser("remote-hub-owner", "password");
  const registered = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "hub-device" });
  assert.ok(registered?.client);
  updateRemoteClient(registered.client.id, owner.id, { policy: { mode: "approval_required", allowlist: ["echo"] } });

  function mockSocket(onRequest: (socket: EventEmitter, request: Record<string, unknown>) => void) {
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: (data: string) => void; close: () => void };
    socket.readyState = 1;
    socket.send = (data) => {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.type === "request") queueMicrotask(() => onRequest(socket, message));
    };
    socket.close = () => {
      socket.readyState = 3;
      socket.emit("close");
    };
    return socket;
  }

  const socket = mockSocket((connection, request) => {
    connection.emit("message", JSON.stringify({
      type: "response", requestId: request.requestId, ok: false,
      error: "Command exited with code 1",
      result: { stdout: "", stderr: "token=abc", exitCode: 1 },
    }));
  });
  attachRemoteClient(socket, registered.client.id, owner.id);
  await assert.rejects(requestRemoteClient({
    clientId: registered.client.id, ownerId: owner.id, action: "execute_command", params: { command: "echo fail" },
  }), /Command exited/);
  const failed = listRemoteAudit(owner.id)[0];
  assert.equal(failed.status, "error");
  assert.equal(failed.resultData?.stderr, "token=[redacted]");
  assert.equal(failed.resultData?.exitCode, 1);
  assert.ok(failed.durationMs != null);

  const disconnected = mockSocket((connection) => connection.emit("close"));
  attachRemoteClient(disconnected, registered.client.id, owner.id);
  await assert.rejects(requestRemoteClient({
    clientId: registered.client.id, ownerId: owner.id, action: "execute_command", params: { command: "echo maybe" },
  }), /disconnected/);
  assert.equal(listRemoteAudit(owner.id)[0].status, "unknown");
  disconnected.close();
});

test("device hub returns only the authenticated PC and its logs", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient } = await import("../lib/remote-clients");
  const { getDatabase } = await import("../lib/sqlite");
  const { GET } = await import("../app/api/remote-clients/hub/route");
  const owner = createUser("remote-local-hub", "password");
  const first = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "this-pc", permissionMode: "admin" });
  const second = registerRemoteClient(createEnrollmentToken(owner.id).token, { name: "other-pc", permissionMode: "admin" });
  assert.ok(first?.client && second?.client);
  for (const client of [first.client, second.client]) {
    getDatabase().prepare("INSERT INTO remote_audit (id, owner_id, client_id, source, action, request_data, status, created_at) VALUES (?, ?, ?, 'user', 'get_info', '{}', 'completed', ?)")
      .run(randomUUID(), owner.id, client.id, new Date().toISOString());
  }
  const response = await GET(new Request("http://localhost/api/remote-clients/hub", {
    headers: { "x-metis-client-id": first.client.id, Authorization: `Bearer ${first.credential}` },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.client.id, first.client.id);
  assert.equal(body.audit.length, 1);
  assert.equal(body.audit[0].clientId, first.client.id);
  assert.equal(body.clients, undefined);
});
