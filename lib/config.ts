import { productName } from "@/lib/product-name";
import os from "node:os";
import path from "node:path";
import { isDockerEnv, rewriteDockerServiceUrl } from "@/lib/docker-urls.mjs";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function numberEnv(name: string, fallback: number) {
  const value = Number.parseInt(env(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name: string, fallback = false) {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

const root = env("AI_CHAT_ROOT") || process.cwd();
const dataDir = env("CHAT_DATA_DIR") || path.join(root, "data");
const port = numberEnv("PORT", 3100);
const host = env("AI_CHAT_HOST") || "127.0.0.1";
const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const publicUrl = env("AI_CHAT_PUBLIC_URL") || `http://${publicHost}:${port}`;
const docker = isDockerEnv();
const internalOrigin = docker
  ? rewriteDockerServiceUrl(env("AI_CHAT_INTERNAL_ORIGIN") || "http://app:3100", "app", 3100)
  : env("AI_CHAT_INTERNAL_ORIGIN") || publicUrl;
const agentCwd = env("AGENT_CWD") || env("HOME") || os.homedir() || process.cwd();

function internalUrl(name: string, route: string) {
  const resolved = env(name) || `${internalOrigin.replace(/\/+$/, "")}${route}`;
  return rewriteDockerServiceUrl(resolved, "app", 3100);
}

export const config = {
  appName: productName(env("APP_NAME")),
  appDescription: env("APP_DESCRIPTION") || "A private, configurable AI agent workspace.",
  chatUsername: env("CHAT_USERNAME") || "admin",
  agentCwd,
  root,
  installDir: env("AI_CHAT_INSTALL_DIR") || root,
  dataDir,
  databasePath: env("CHAT_DB_PATH") || path.join(dataDir, "chat.sqlite"),
  host,
  mcpStateDir: env("AI_CHAT_MCP_STATE_DIR") || path.join(dataDir, "mcp-state"),
  internalOrigin,
  internalUrl: internalUrl("AI_CHAT_INTERNAL_URL", "/api/internal/mcp-question"),
  workspaceUrl: internalUrl("AI_CHAT_WORKSPACE_URL", "/api/internal/mcp-workspace"),
  chatUrl: internalUrl("AI_CHAT_CHAT_URL", "/api/internal/mcp-chat"),
  notesUrl: internalUrl("AI_CHAT_NOTES_URL", "/api/internal/mcp-notes"),
  memoryUrl: internalUrl("AI_CHAT_MEMORY_URL", "/api/internal/mcp-memory"),
  browserUrl: internalUrl("AI_CHAT_BROWSER_URL", "/api/internal/browser"),
  agentStateUrl: internalUrl("AI_CHAT_AGENT_STATE_URL", "/api/internal/mcp-agent-state"),
  subagentUrl: internalUrl("AI_CHAT_SUBAGENT_URL", "/api/internal/mcp-subagent"),
  automationUrl: internalUrl("AI_CHAT_AUTOMATION_URL", "/api/internal/mcp-automation"),
  fileUrl: internalUrl("AI_CHAT_FILE_URL", "/api/internal/mcp-file"),
  publicUrl,
  serviceName: env("AI_CHAT_SERVICE_NAME") || "metis-ai",
  port,
  mcpPort: numberEnv("MCP_PORT", 8787),
  mcpPublicUrl: rewriteDockerServiceUrl(
    env("MCP_PUBLIC_URL") || `http://127.0.0.1:${numberEnv("MCP_PORT", 8787)}`,
    "mcp",
    8787,
  ),
  mcpBearerToken: env("MCP_BEARER_TOKEN"),
  mcpAllowRemoteAdmin: booleanEnv("MCP_ALLOW_REMOTE_ADMIN"),
  docker,
  dockerWorkspace: "/workspace",
  allowRootAgents: booleanEnv("AI_CHAT_ALLOW_ROOT_AGENTS", true),
  enableOptionalMcp: booleanEnv("MCP_ENABLE_OPTIONAL_SERVERS"),
  enableRemoteMcp: booleanEnv("MCP_ENABLE_REMOTE_SERVERS"),
} as const;
