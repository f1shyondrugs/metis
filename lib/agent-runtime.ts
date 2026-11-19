import { cancelAgentJob, getJob, updateJob } from "@/lib/db-jobs";
import { agentRuntimeDeadline, normalizeAgentRuntimeMs, scheduleRuntimeDeadline } from "@/lib/agent-runtime-policy.mjs";
import type { AgentJob } from "@/lib/jobs";

/** Runs in each fresh job process, so the scheduler can stay alive during deploys. */
export function armAgentRuntime(job: AgentJob) {
 // Acceptance deadlines also cover private top-level test chats, including when
 // the browser or test-console process disconnects. Existing chat limits are unchanged.
 if (job.providerAcceptance) {
  const deadline = Date.parse(job.providerAcceptance.deadlineAt);
  if (!Number.isFinite(deadline)) {
   cancelAgentJob(job.id, job.userId, "Invalid provider acceptance deadline.");
   return () => {};
  }
  if (deadline <= Date.now()) {
   cancelAgentJob(job.id, job.userId, "Provider acceptance deadline reached.");
   return () => {};
  }
  return scheduleRuntimeDeadline(deadline, () => {
   cancelAgentJob(job.id, job.userId, "Provider acceptance deadline reached.");
  });
 }
 if (!job.parentJobId && !job.projectTeamId) return () => {};
 const maxRuntimeMs = normalizeAgentRuntimeMs(job.maxRuntimeMs);
 if (maxRuntimeMs === 0) return () => {};
 const persisted = Date.parse(job.agentRuntimeDeadlineAt || "");
 const claimed = Date.parse(job.claimedAt || "");
 const start = Number.isFinite(claimed) ? claimed : Date.now();
 const deadline = Number.isFinite(persisted) ? Math.min(persisted, agentRuntimeDeadline(start, maxRuntimeMs)) : agentRuntimeDeadline(start, maxRuntimeMs);
 const updated = updateJob(job.id, { maxRuntimeMs, agentRuntimeDeadlineAt: new Date(deadline).toISOString() });
 if (!updated) return () => {};
 return scheduleRuntimeDeadline(deadline, () => {
  const current = getJob(job.id);
  if (current && ["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(current.status)) {
   cancelAgentJob(job.id, job.userId, "Agent runtime limit reached.", "runtime_limit");
  }
 });
}
