import { gatewayToolForRequest as gatewayTool } from "@/lib/gateway-request";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import { sanitizeMcpServer as sanitizeServer } from "@/lib/mcp-env-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function stringRecord(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key.trim() || typeof item !== "string") throw new Error(`${field} must contain strings`);
    result[key.trim()] = item;
  }
  return result;
}

function parseServer(body: Record<string, unknown>) {
  const id = requiredString(body.id, "id");
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) {
    throw new Error("id must use 2-64 lowercase letters, numbers, dots, underscores, or hyphens");
  }
  const name = requiredString(body.name, "name");
  const kind = body.kind === "remote" || body.kind === "stdio" ? body.kind : undefined;
  if (!kind) throw new Error("kind must be remote or stdio");

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (kind === "remote") {
    if (!url) throw new Error("url is required for remote servers");
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url must use http or https");
  } else if (!command) {
    throw new Error("command is required for stdio servers");
  }

  const args = body.args === undefined
    ? undefined
    : Array.isArray(body.args) && body.args.every((item) => typeof item === "string")
      ? body.args
      : (() => { throw new Error("args must be an array of strings"); })();
  const env = stringRecord(body.env, "env");
  const headers = stringRecord(body.headers, "headers");
  return {
    id,
    name,
    kind,
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(headers ? { headers } : {}),
    enabled: body.enabled !== false,
    ...(Array.isArray(body.tags) ? { tags: body.tags.filter((item): item is string => typeof item === "string") } : {}),
    ...(typeof body.note === "string" ? { note: body.note.trim() } : {}),
  };
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const userId = await getAuthenticatedUserId(req);
    const servers = await gatewayTool(req, "list_mcp_servers", { include_disabled: true });
    return Response.json({
      servers: Array.isArray(servers) ? servers.map(server => ({ ...sanitizeServer(server), can_edit_environment: server.ownerId === userId && server.kind === "stdio" })) : [],
    });
  } catch (error) {
    return Response.json({ error: "Failed to list MCP servers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) {
    return Response.json({ error: "Only host administrators can change MCP servers." }, { status: 403 });
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const server = await gatewayTool(req, "upsert_mcp_server", parseServer(body));
    return Response.json({ server: sanitizeServer((server as { server?: unknown }).server) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: "Failed to save MCP server" }, { status: 400 });
  }
}
