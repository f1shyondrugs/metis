import { getSharedNote, getSharedNoteAccess, noteShareCookieName, noteShareCredential, unlockSharedNote } from "@/lib/note-sharing";
import { consumeSharePasswordLimit } from "@/lib/share-rate-limit";
import { requestIsSecure } from "@/lib/request-network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
const unavailable = () => Response.json({ error: "This share link is unavailable or has been revoked." }, { status: 404, headers });
const locked = (error = "Password required") => Response.json({ error, passwordRequired: true }, { status: 401, headers });

export async function GET(req: Request, { params }: Context) {
  const { token } = await params;
  const credential = noteShareCredential(req, token);
  const access = getSharedNoteAccess(token, credential);
  if (access === "not_found") return unavailable();
  if (access === "password_required") return locked();
  const share = getSharedNote(token, credential);
  return share ? Response.json(share, { headers }) : unavailable();
}

export async function POST(req: Request, { params }: Context) {
  const { token } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("password" in body) ||
      typeof body.password !== "string" || body.password.length > 4096) {
    return Response.json({ error: "Invalid share credentials" }, { status: 400, headers });
  }
  const limit = consumeSharePasswordLimit(req, "notes:" + token);
  if (!limit.allowed) return Response.json({ error: "Too many password attempts. Please try again later." },
    { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  if (getSharedNoteAccess(token) === "not_found") return unavailable();
  const credential = unlockSharedNote(token, body.password);
  if (!credential) return locked("Incorrect password");
  const share = getSharedNote(token, credential);
  if (!share) return unavailable();
  limit.reset();
  const secure = requestIsSecure(req);
  const cookie = noteShareCookieName(token) + "=" + credential + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200" + (secure ? "; Secure" : "");
  return Response.json(share, { headers: { ...headers, "Set-Cookie": cookie } });
}
