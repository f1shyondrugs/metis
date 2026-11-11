import { getAuthenticatedUserId } from "@/lib/auth";
import { gatewayToolForRequest } from "@/lib/gateway-request";
import {browserLoginSameOrigin} from "@/lib/browser-login-client";
import { McpEnvironmentInputError, ownedMcpServer, parseMcpEnvironmentPatch } from "@/lib/mcp-env-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function owned(req: Request, id: string, userId: string) {
  const server = ownedMcpServer(await gatewayToolForRequest(req, "list_mcp_servers", { include_disabled: true }), id, userId);
  return server?.kind === "stdio" ? server : undefined;
}
async function manager() {
  // @ts-expect-error Shared runtime ESM module has no generated declarations.
  return await import("@/packages/mcp-gateway/index.mjs") as {
    getMcpEnvironment: (id: string, context: { userId: string }) => Promise<{ keys: string[]; revision: string }>;
    updateMcpEnvironment: (id: string, patch: { set: Record<string, string>; remove: string[]; revision: string }, context: { userId: string }) => Promise<{ keys: string[]; revision: string }>;
  };
}
export async function GET(req: Request, { params }: Params) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId || !req.headers.get("cookie") || req.headers.has("x-chat-password")) return json({ error: "Unauthorized" }, 401);
  try {
    const id = (await params).id;
    if (!await owned(req, id, userId)) return json({ error: "Connection not found" }, 404);
    const result = await (await manager()).getMcpEnvironment(id, { userId });
    return json({ keys: result.keys.map(key => ({ key, configured: true })), revision: result.revision });
  } catch { return json({ error: "Could not load environment settings." }, 503); }
}
export async function PATCH(req: Request, { params }: Params) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId || !req.headers.get("cookie") || req.headers.has("x-chat-password")) return json({ error: "Unauthorized" }, 401);
  if (!browserLoginSameOrigin(req)) return json({ error: "Forbidden" }, 403);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Expected JSON" }, 415);
  try {
    const id = (await params).id;
    if (!await owned(req, id, userId)) return json({ error: "Connection not found" }, 404);
    const text = await req.text();
    if (text.length > 262144) return json({ error: "Environment changes are too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new McpEnvironmentInputError(); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new McpEnvironmentInputError();
    const { revision, ...changes } = body as Record<string, unknown>;
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new McpEnvironmentInputError();
    const patch = parseMcpEnvironmentPatch(changes);
    const runtime = await manager();
    const current = await runtime.getMcpEnvironment(id, { userId });
    if (current.revision !== revision) return json({ error: "The connection changed. Reload its settings before saving." }, 409);
    const result = await runtime.updateMcpEnvironment(id, { ...patch, revision }, { userId });
    // Return an allowlist, never runtime objects or raw errors.
    return json({ ok: true, revision: result.revision });
  } catch (error) {
    if (error instanceof McpEnvironmentInputError) return json({ error: error.message }, 400);
    return json({ error: "Could not save environment settings. Reload and try again." }, 503);
  }
}
