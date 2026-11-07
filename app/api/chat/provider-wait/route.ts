import { getAuthenticatedUser } from "@/lib/auth";
import { canAccessChat } from "@/lib/project-access";
import { getActiveParentJob } from "@/lib/db-jobs";
import { providerResetWaitFromJob } from "@/lib/provider-reset-wait";
import { controlProviderResetWait } from "@/lib/provider-reset-wait-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const chatId = new URL(req.url).searchParams.get("chatId")?.trim();
  if (!chatId || !canAccessChat(chatId, user.id)) return Response.json({ error: "Chat not found" }, { status: 404 });
  return Response.json({ wait: providerResetWaitFromJob(getActiveParentJob(chatId, user.id)) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.chatId !== "string" || typeof body.jobId !== "string" ||
      typeof body.detectedAt !== "string" || !["wake", "cancel"].includes(String(body.action))) {
    return Response.json({ error: "Invalid provider-wait action" }, { status: 400 });
  }
  const chatId = body.chatId.trim();
  if (!canAccessChat(chatId, user.id)) return Response.json({ error: "Chat not found" }, { status: 404 });
  const result = controlProviderResetWait({
    chatId, userId: user.id, jobId: body.jobId, detectedAt: body.detectedAt, action: body.action as "wake" | "cancel",
  });
  if (!result) return Response.json({ error: "This run is no longer waiting for this provider reset. Refresh the chat." }, { status: 409 });
  return Response.json({ ok: true, wait: providerResetWaitFromJob(getActiveParentJob(chatId, user.id)) });
}
