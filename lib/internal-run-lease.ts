import { getJob, isJobLeaseActive } from "@/lib/db-jobs";

/** A valid lease authorizes its persisted owner/chat, never caller-chosen IDs. */
export function internalRunContextAuthorized(req: Request, jobId: string) {
  const owner=req.headers.get("x-ai-chat-user-id")?.trim();
  const chat=req.headers.get("x-ai-chat-id")?.trim();
  const job=getJob(jobId);
  return Boolean(owner&&chat&&job&&job.userId===owner&&job.chatId===chat&&internalRunLeaseAuthorized(req,jobId));
}

export function internalRunLeaseAuthorized(req: Request, jobId: string) {
  if (!jobId.trim()) return false;
  // Only explicitly opted-in in-process tests may omit a lease. Never bypass
  // production, even when the test switch was accidentally inherited.
  if (process.env.NODE_ENV !== "production" && process.env.AI_CHAT_TEST_BYPASS_LEASE === "1") return true;
  const workerId = req.headers.get("x-ai-chat-worker-id")?.trim() || "";
  const leaseToken = req.headers.get("x-ai-chat-lease-token")?.trim() || "";
  if (!workerId || !leaseToken) return false;
  return isJobLeaseActive(jobId, workerId, leaseToken);
}
