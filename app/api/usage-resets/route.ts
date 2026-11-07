import { getAuthenticatedUserId } from "@/lib/auth";
import { consumeUsageReset, getUsageResets, prepareUsageReset, usageResetCatalog, UsageResetError } from "@/lib/usage-resets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof UsageResetError ? error.message : "Provider resets could not be loaded. Reconnect the account or try refreshing." },
    { status: error instanceof UsageResetError ? error.status : 503, headers });
}
export async function GET(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const id = new URL(req.url).searchParams.get("connectionId");
  try { return Response.json(id ? await getUsageResets(ownerId, id) : usageResetCatalog(ownerId), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const origin = req.headers.get("origin");
  try {
    if ((origin && new URL(origin).host !== (req.headers.get("host") || new URL(req.url).host)) ||
        req.headers.get("sec-fetch-site") === "cross-site" ||
        !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json({ error: "A same-origin JSON request is required." }, { status: 403, headers });
    }
    const body = await req.json();
    if (typeof body?.connectionId !== "string" || body.connectionId.length > 200) throw new UsageResetError("Choose an account connection.");
    if (body.action === "prepare") {
      if (!((typeof body.creditId === "string" && body.creditId.length <= 500) || (typeof body.retryId === "string" && body.retryId.length <= 100))) throw new UsageResetError("Choose a reset.");
      return Response.json(await prepareUsageReset(ownerId, body.connectionId, body.creditId, body.retryId), { headers });
    }
    if (body.action !== "consume" || typeof body.id !== "string" || typeof body.token !== "string" || body.id.length > 100 || body.token.length > 200) throw new UsageResetError("Invalid confirmation.");
    return Response.json(await consumeUsageReset(ownerId, body.connectionId, body.id, body.token, body.confirmed), { headers });
  } catch (error) { return failure(error); }
}
