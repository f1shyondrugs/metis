import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestOriginAllowed } from "@/lib/request-network";
import { acceptanceOverview, createAcceptanceReport, AcceptanceError } from "@/lib/providers/acceptance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401, headers });
  try { return Response.json(acceptanceOverview(ownerId), { headers }); }
  catch (error) { return Response.json({ error: error instanceof AcceptanceError ? error.message : "Could not load provider acceptance." }, { status: error instanceof AcceptanceError ? error.status : 500, headers }); }
}
export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401, headers });
  if (!requestOriginAllowed(req)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers });
  try {
    const text = await req.text();
    if (text.length > 32000) return Response.json({ error: "Selection is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    return Response.json({ report: createAcceptanceReport(ownerId, body) }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof AcceptanceError ? error.message : "Could not create provider acceptance report." }, { status: error instanceof AcceptanceError ? error.status : 500, headers });
  }
}
