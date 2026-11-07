import { getAuthenticatedUserId } from "@/lib/auth";
import { createNoteShare, getNoteShare, NoteShareUnavailableError, revokeNoteShare, updateNoteShare } from "@/lib/note-sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

function unavailable(error: unknown): Response {
  if (error instanceof NoteShareUnavailableError) return Response.json({ error: error.message }, { status: 404, headers });
  throw error;
}

export async function GET(req: Request, { params }: Context) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  try { return Response.json({ share: getNoteShare(id, userId) }, { headers }); }
  catch (error) { return unavailable(error); }
}

export async function POST(req: Request, { params }: Context) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let body: unknown;
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      ("rotate" in body && typeof body.rotate !== "boolean")) {
    return Response.json({ error: "rotate must be a boolean" }, { status: 400, headers });
  }
  const { id } = await params;
  try { return Response.json({ share: createNoteShare(id, userId, "rotate" in body && body.rotate === true) }, { headers }); }
  catch (error) { return unavailable(error); }
}

export async function PATCH(req: Request, { params }: Context) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let body: unknown;
  try { body = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      ("active" in body && typeof body.active !== "boolean") ||
      ("password" in body && body.password !== null && (typeof body.password !== "string" || body.password.length > 4096)) ||
      Object.keys(body).some(key => !["active", "password"].includes(key))) {
    return Response.json({ error: "Invalid sharing settings" }, { status: 400, headers });
  }
  const { id } = await params;
  try { return Response.json({ share: updateNoteShare(id, userId, body) }, { headers }); }
  catch (error) { return unavailable(error); }
}

export async function DELETE(req: Request, { params }: Context) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  try {
    revokeNoteShare(id, userId);
    return Response.json({ share: null }, { headers });
  } catch (error) { return unavailable(error); }
}
