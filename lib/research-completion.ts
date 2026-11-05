import path from "node:path";
import { config } from "@/lib/config";
import { getChat } from "@/lib/db-store";
import type { AgentJob } from "@/lib/jobs";
import { createResearchWorkflow } from "@/lib/mcp-core/research-workflow.mjs";
import { createResearchTools } from "@/lib/mcp-core/research-tools.mjs";
import { researchProgressFromTool } from "@/lib/research-progress";

export async function researchContinuationForJob(job: AgentJob): Promise<{required: boolean; prompt?: string; signature?: string; blockedReason?: string; stopped?: boolean}> {
  const chat = getChat(job.chatId, job.userId);
  if ((job.modeId || chat?.sessionState?.modeId) !== "deep-research" || !job.userId) return { required: false };
  const stateDir = process.env.AI_CHAT_MCP_STATE_DIR || path.join(config.root, "data", "mcp-state");
  const context = { userId: job.userId, chatId: job.chatId, jobId: job.id };
  const snapshots = (chat?.messages || []).flatMap(message => (message.tools || []).flatMap(tool => {
    const snapshot = researchProgressFromTool(tool);
    return snapshot?.runId === job.id ? [snapshot] : [];
  }));
  const snapshot = snapshots.at(-1);
  const workflow = createResearchWorkflow({ stateDir });
  const state = job.incognito ? snapshot : await workflow.state(context);
  const evidence = state && !job.incognito ? await createResearchTools({stateDir})("research_sources", {}, context) : snapshot;
  if (state && ["denied", "cancelled"].includes(state.status)) return {required:false,stopped:true};
  if (state?.status === "revision_requested") return {required:true,signature:JSON.stringify([state.status,state.plan]),prompt:"Revise the user's edited research plan and resubmit research_plan for review. Do not gather evidence before a new submitted approval. Respect denial and cancellation."};
  if (state && ["awaiting_approval", "report_attached"].includes(state.status)) return {required:false};
  const signature = JSON.stringify([state?.status, evidence?.readCount || 0, evidence?.openedCount || 0, evidence?.discoveredCount || 0]);
  return {
    required: true, signature,
    prompt: state
      ? `Continue the already approved Deep Research plan in this same run. The provider ended before saving the complete report in Canvas. Read the approved ${state.sourceTarget || 200} distinct sources fully with research_open (including unread line ranges); audit research_sources, update research_progress, then deliver at least ${state.minimumWords || 4000} words via research_report. Reuse the current evidence cache and tracker; do not ask for the same approval again. Do not claim completion while delivery is missing. Respect cancellation, actual blockers and the original runtime deadline.`
      : "Continue the user's Deep Research request. Submit the editable research_plan for approval; do not end with only an acknowledgement or a proposed plan in chat. Respect user denial, stop requests and runtime limits.",
  };
}
