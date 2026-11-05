import { getAuthenticatedUserId } from "@/lib/auth";
import { getJob, requestMemoryOverride } from "@/lib/db-jobs";
import { getChatMetadata } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.jobId !== "string" || !body.jobId.trim()) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }
  const job = getJob(body.jobId);
  if (!job || job.userId !== userId || !getChatMetadata(job.chatId, userId)) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }
  const updated = requestMemoryOverride(job.id, userId);
  if (!updated) {
    return Response.json({ error: "This run is no longer waiting for RAM. Its current state has been preserved." }, { status: 409 });
  }
  return Response.json({ jobId: updated.id, queueMessage: updated.queueMessage });
}
