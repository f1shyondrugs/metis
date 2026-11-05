import { getSharedNoteAccess, getSharedNoteAsset, noteShareCredential } from "@/lib/note-sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

export async function GET(req: Request, { params }: Context) {
  const { token } = await params;
  const original = new URL(req.url).searchParams.get("url") || "";
  const response = original.length <= 8_192 ? await getSharedNoteAsset(token, original, req) : null;
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  };
  if (!response) {
    const locked = getSharedNoteAccess(token, noteShareCredential(req, token)) === "password_required";
    return Response.json({ error: locked ? "Password required" : "File not found." }, { status: locked ? 401 : 404, headers });
  }
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}
