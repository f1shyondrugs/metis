import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { UpdateSchedule } from "../lib/update-schedule";

const endpoint = "http://localhost/api/admin/system/update-schedule";
const admin = "fixture-host-admin";
const member = "fixture-member";
const lastRunKey = "2026-11-15 02:15";
type ScheduleResponse = { schedule: UpdateSchedule; nextRunAt: string | null };

function get(session = admin) {
  return new Request(endpoint, { headers: session ? { cookie: `ai_chat_auth=${session}` } : {} });
}

function put(body: unknown, session = admin, raw = false) {
  return new Request(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { cookie: `ai_chat_auth=${session}` } : {}),
    },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function assertNextRun({ schedule, nextRunAt }: ScheduleResponse) {
  assert.ok(nextRunAt);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: schedule.timezone,
  }).format(new Date(nextRunAt));
  assert.equal(formatted, schedule.time);
}

test("server update schedule keeps time edits and enable/disable independent", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-update-schedule-"));
  Object.assign(process.env, {
    AI_CHAT_ROOT: root,
    AI_CHAT_INSTALL_DIR: root,
    CHAT_DATA_DIR: root,
    CHAT_DB_PATH: path.join(root, "chat.sqlite"),
    AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"),
    CHAT_PASSWORD: "",
    METIS_AI_BOOTSTRAP_PASSWORD: "",
    METIS_AI_ADMIN_USERNAMES: "",
    CHAT_LEGACY_HEADER_AUTH: "false",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { getDatabase } = await import("../lib/sqlite");
  const db = getDatabase();
  try {
    for (const [id, isAdmin] of [[admin, 1], [member, 0]] as const) {
      db.prepare("INSERT INTO users(id, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)")
        .run(id, id, "test-only", new Date().toISOString(), isAdmin);
      db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .run(createHash("sha256").update(id).digest("hex"), id, new Date(Date.now() + 60_000).toISOString());
    }
    const api = await import("../app/api/admin/system/update-schedule/route");
    const { saveUpdateSchedule } = await import("../lib/update-schedule");
    const read = async (): Promise<ScheduleResponse> => {
      const response = await api.GET(get());
      assert.equal(response.status, 200);
      return response.json();
    };
    const write = async (body: unknown): Promise<ScheduleResponse> => {
      const response = await api.PUT(put(body));
      assert.equal(response.status, 200);
      return response.json();
    };

    await t.test("active time and timezone changes round-trip and recompute next check", async () => {
      saveUpdateSchedule({ enabled: true, time: "02:15", timezone: "UTC", lastRunKey });
      const saved = await write({ time: "04:37", timezone: "Europe/Berlin" });
      assert.deepEqual(saved.schedule, { enabled: true, time: "04:37", timezone: "Europe/Berlin", lastRunKey });
      assertNextRun(saved);
      const persisted = await read();
      assert.deepEqual(persisted.schedule, saved.schedule);
      assertNextRun(persisted);
    });

    await t.test("enable-only updates preserve saved fields; disabled drafts and legacy combined requests still work", async () => {
      saveUpdateSchedule({ enabled: true, time: "04:37", timezone: "Europe/Berlin", lastRunKey });
      const disabled = await write({ enabled: false });
      assert.deepEqual(disabled, {
        schedule: { enabled: false, time: "04:37", timezone: "Europe/Berlin", lastRunKey },
        nextRunAt: null,
      });
      const savedWhileDisabled = await write({ time: "23:58", timezone: "America/New_York" });
      assert.equal(savedWhileDisabled.schedule.enabled, false);
      assert.equal(savedWhileDisabled.nextRunAt, null);
      const reenabled = await write({ enabled: true });
      assert.deepEqual(reenabled.schedule, { ...savedWhileDisabled.schedule, enabled: true });
      assertNextRun(reenabled);
      const legacy = await write({ enabled: false, time: "07:21", timezone: "Asia/Tokyo" });
      assert.deepEqual(legacy, {
        schedule: { enabled: false, time: "07:21", timezone: "Asia/Tokyo", lastRunKey },
        nextRunAt: null,
      });
      assert.deepEqual(await read(), legacy);
    });

    await t.test("rejected requests cannot change the stored state", async () => {
      saveUpdateSchedule({ enabled: false, time: "07:21", timezone: "Asia/Tokyo", lastRunKey });
      const before = await read();
      assert.equal((await api.GET(get(""))).status, 401);
      assert.equal((await api.GET(get(member))).status, 403);
      assert.equal((await api.PUT(put({ enabled: true }, ""))).status, 401);
      assert.equal((await api.PUT(put({ enabled: true }, member))).status, 403);
      for (const body of [
        null,
        [],
        {},
        { enabled: "false" },
        { enabled: true, time: "" },
        { time: "24:00" },
        { time: "03:60" },
        { time: 3 },
        { time: "00:23", timezone: "Invalid/Timezone" },
        { timezone: "" },
      ]) {
        const response = await api.PUT(put(body));
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      assert.equal((await api.PUT(put("{", admin, true))).status, 400);
      assert.deepEqual(await read(), before);
    });
  } finally {
    db.close();
  }
});
