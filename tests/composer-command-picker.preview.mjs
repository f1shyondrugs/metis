// Local-only browser fixture: serves the actual production AppShell and real
// authorized skill/mode endpoints, with no real account, provider or job.
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { importWorkerModule } from "../lib/worker-module.mjs";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const base = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "metis-picker-preview-"));
const port = Number(process.env.PICKER_PREVIEW_PORT || 37941);
Object.assign(process.env, {
  NODE_ENV: "production", NEXT_DIST_DIR: ".next-a", NEXT_TELEMETRY_DISABLED: "1",
  AI_CHAT_ROOT: root, AI_CHAT_INSTALL_DIR: base, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, AI_CHAT_MCP_STATE_DIR: path.join(root, "mcp-state"), CHAT_LEGACY_HEADER_AUTH: "false",
});
const [sql, auth, personal] = await Promise.all(["../lib/sqlite.ts", "../lib/auth.ts", "../lib/personal-skills.ts"].map(importWorkerModule));
const userId = randomUUID();
const name = "Picker fixture";
const db = sql.getDatabase();
db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(userId, name, "fixture-only", new Date().toISOString());
const { token } = auth.createUserSession(userId);
personal.addPersonalSkill(userId, "keyboard-fixture", [{
  path: "SKILL.md", encoding: "utf8", content: "---\nname: Keyboard Fixture\ndescription: A synthetic installed skill\n---\n\nNo real account data.",
}]);

const provider = { id: "picker-fixture", providerKey: "codex", label: "Fixture provider", enabled: true, hasSecret: true };
const models = ["Alpha", "Beta"].map(label => ({
  id: "codex:" + provider.id + ":fixture-" + label.toLowerCase(), displayName: "Fixture " + label,
  connectionId: provider.id, connectionLabel: provider.label, providerName: "Codex", providerId: provider.providerKey, source: "discovered",
  parameters: [{ id: "effort", displayName: "Reasoning", values: [{ value: "low", displayName: "Low" }, { value: "high", displayName: "High" }] },
    { id: "context", displayName: "Context target", values: [], customNumber: { min: 1024, max: 8192, step: 256 } }],
  defaultParams: [{ id: "effort", value: "low" }],
}));
let settings = { featureFlags: { browser: false }, browserRealtime: false };
let chatSubmissions = 0;
const json = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
const next = (await import("next")).default;
const app = next({ dev: false, dir: base, hostname: "127.0.0.1", port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:" + port);
  // No application request can escape to a provider or external runtime.
  if (url.pathname === "/api/status") return json(res, {
    authenticated: true, username: name, userId, agentCwd: root, providers: [provider],
    setup: { needed: false, hasUsers: true, setupComplete: true, hasProvider: true },
    worker: { ok: true }, mcp: { ok: true },
  });
  if (url.pathname === "/api/models") return json(res, { models, providers: [provider], defaultModelId: models[0].id });
  if (url.pathname === "/api/preferences") {
    if (req.method === "PATCH") {
      let body = "";
      for await (const part of req) { body += part; if (body.length > 100_000) return json(res, {}, 413); }
      settings = { ...settings, ...JSON.parse(body) };
      writeFileSync(process.env.PICKER_PREVIEW_EVIDENCE || path.resolve("browser-fixture-prefs.json"), JSON.stringify({ settings, chatSubmissions }, null, 2));
    }
    return json(res, { settings });
  }
  if (url.pathname === "/fixture-check") return json(res, { chatSubmissions, selectedModelParams: settings.modelParamsByModel, draft: settings.draftInput || "" });
  if (url.pathname === "/api/chat" || url.pathname === "/api/chat/send") {
    if (req.method === "POST") chatSubmissions++;
    return json(res, { error: "Fixture does not submit runs." }, 409);
  }
  if (url.pathname.startsWith("/api/")) {
    const safe = ["/api/modes", "/api/references", "/api/skills", "/api/chats", "/api/chats/index", "/api/model-chains", "/api/account/profile"].includes(url.pathname);
    if (!safe || req.method !== "GET") return json(res, {}, 404);
    req.headers.cookie = auth.CHAT_COOKIE + "=" + token;
  }
  await handle(req, res);
});
server.listen(port, "127.0.0.1", () => console.log("METIS_PICKER_PREVIEW_READY", port));
process.on("SIGTERM", () => server.close(() => { rmSync(root, { recursive: true, force: true }); process.exit(0); }));
