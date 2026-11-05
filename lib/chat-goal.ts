import { resolveScopeReferences } from "@/lib/context-scope";
import { getChat } from "@/lib/db-store";
import type { ChatSessionState } from "@/lib/store";

/** Keep goal references attached across turns, using the same scope checks as @ mentions. */
export function formatChatGoal(
  state: ChatSessionState | undefined,
  ownerId: string | undefined,
  chatId: string,
  incognito = false,
): string {
  const goal = state?.goal?.trim();
  if (!goal) return "";
  const referenceChatId = state?.goalOriginChatId && getChat(state.goalOriginChatId, ownerId)
    ? state.goalOriginChatId
    : chatId;
  const references = resolveScopeReferences(
    ownerId,
    referenceChatId,
    (state?.goalReferences || []).map((reference) => ({
      ...reference,
      source: "explicit" as const,
    })),
    incognito,
  );
  const context = references.map((reference) => [
    `- [${reference.kind}] ${reference.label}`,
    reference.detail ? `  Detail: ${reference.detail}` : "",
    reference.path ? `  Path/URL: ${reference.path}` : "",
    reference.content ? `  Context:\n${reference.content}` : "",
  ].filter(Boolean).join("\n")).join("\n\n").slice(0, 32_000);
  return [
    `Current chat goal: ${goal}`,
    "Goal execution contract: Treat the goal as an outcome to work toward, not background text. Keep the latest user request, corrections and authorized scope authoritative; a goal does not grant extra permissions or override the selected mode.",
    "Work through the remaining authorized steps until the requested outcome is achieved and verified. An acknowledgement, plan, intention, single tool call or completed subtask is not completion of the goal. Maintain the existing task checklist and continue from the first unfinished step instead of asking the user to request already-authorized work again.",
    "Before ending, compare the actual result with the goal and the latest request. Resolve actionable unfinished tasks and correctable failures. If work is blocked by missing input, approval, access, a stop request or the run budget, preserve the unfinished state and explain the concrete blocker honestly; do not claim completion or silently mark remaining work done. Respect requests for a status-only answer or a narrower step, and do not invent extra work after the requested outcome is complete.",
    context ? `Goal context — selected @ references:\n${context}` : "",
  ].filter(Boolean).join("\n\n");
}
