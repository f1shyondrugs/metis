import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestOriginAllowed } from "@/lib/request-network";
import { getAcceptanceReport, advanceAcceptanceReport, cancelAcceptanceReport, AcceptanceError } from "@/lib/providers/acceptance-service";
import { renderAcceptanceMarkdown, renderAcceptanceHtml } from "@/lib/providers/acceptance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type Params = { params: Promise<{ id: string }> };
export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401, headers });
  try {
    const { id } = await params;
    const result = getAcceptanceReport(ownerId, id);
    const format = new URL(req.url).searchParams.get("format");
    if (!format) return Response.json(result, { headers });
    if (!["markdown", "html", "json"].includes(format)) return Response.json({ error: "Unsupported report format." }, { status: 400, headers });
    const extension = format === "markdown" ? "md" : format;
    const type = format === "markdown" ? "text/markdown" : format === "html" ? "text/html" : "application/json";
    const content = format === "markdown" ? renderAcceptanceMarkdown(result.report) : format === "html" ? renderAcceptanceHtml(result.report) : JSON.stringify(result.report, null, 2);
    return new Response(content, { headers: { ...headers, "Content-Type": type + "; charset=utf-8",
      "Content-Disposition": 'attachment; filename="provider-acceptance-' + id + '.' + extension + '"',
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  } catch (error) {
    return Response.json({ error: error instanceof AcceptanceError ? error.message : "Could not read provider acceptance report." }, { status: error instanceof AcceptanceError ? error.status : 500, headers });
  }
}
export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401, headers });
  if (!requestOriginAllowed(req)) return Response.json({ error: "Origin not allowed." }, { status: 403, headers });
  try {
    const raw = await req.text();
    if (raw.length > 1000) return Response.json({ error: "Request is too large." }, { status: 413, headers });
    let body: { action?: unknown };
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || !["next", "cancel"].includes(String(body.action))) return Response.json({ error: "Use next or cancel." }, { status: 400, headers });
    const { id } = await params;
    const result = body.action === "cancel" ? cancelAcceptanceReport(ownerId, id) : await advanceAcceptanceReport(ownerId, id, req);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AcceptanceError ? error.message : "Could not advance provider acceptance." }, { status: error instanceof AcceptanceError ? error.status : 500, headers });
  }
}
