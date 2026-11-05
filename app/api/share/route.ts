import { getChatByShareId, unlockChatShare } from "@/lib/db-store";
import { chatShareAccessCookie } from "@/lib/chat-share-access";
import { consumeSharePasswordLimit } from "@/lib/share-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestId(req: Request) {
  const url = new URL(req.url);
  return url.searchParams.get("id") || "";
}

export async function GET(req: Request) {
  const result = getChatByShareId(requestId(req));
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Password required", share: result.share }, { status: 401 });
  }
  return Response.json({ chat: result.chat }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  let body: { id?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body.id !== "string" || body.id.length > 128 ||
      (body.password !== undefined && (typeof body.password !== "string" || body.password.length > 4096))) {
    return Response.json({ error: "Invalid share credentials" }, { status: 400 });
  }
  const rateLimit = consumeSharePasswordLimit(req, body.id);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many password attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const result = getChatByShareId(body.id || "", body.password);
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Incorrect password", share: result.share }, { status: 401 });
  }
  rateLimit.reset();
  const response = Response.json({ chat: result.chat }, { headers: { "Cache-Control": "private, no-store" } });
  const credential = unlockChatShare(body.id, body.password || "");
  if (credential) response.headers.set("Set-Cookie", chatShareAccessCookie(req,body.id,credential));
  return response;
}
