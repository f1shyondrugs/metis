import { agentRulesPrompt } from "@/lib/agent-rules";
import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import { projectTeamContextBlock } from "@/lib/project-team";
import { projectContextBlock } from "@/lib/projects";
import {
  globalFactsForScope,
  loadContextScope,
  resolveScopeReferences,
} from "@/lib/context-scope";
import { alwaysOnSkillsPrompt, projectSkillSettings, skillsCatalogPrompt } from "@/lib/skills";
import { autoSkillActivationPrompt } from "@/lib/skill-routing";
import { METIS_SHARED_AGENT_CONTROL, toolContractPrompt } from "@/lib/agent-control";
import { metisAgentIdentity } from "@/lib/agent-identity";
import { formatChatGoal } from "@/lib/chat-goal";
import { chatMetadataPrompt } from "@/lib/chat-metadata-prompt";
import { modeById } from "@/lib/modes";
import { retrieveRelevantFacts, selectChatContinuityFacts } from "@/lib/context-layers";
import { buildAttachmentPrompt } from "@/lib/uploads";
import type { AgentJob } from "@/lib/jobs";

export type ProviderPromptContext = {
  job: AgentJob;
  toolNames?: ReadonlyArray<string>;
  nativeTools?: boolean;
  provider?: string;
};

const EXPLICIT_CONTEXT_CHARS = 80_000;
const PINNED_CONTEXT_CHARS = 32_000;
const CHAT_FACT_CHARS = 10_000;
const GLOBAL_CONTEXT_CHARS = 10_000;

function boundedJoin(blocks: string[], maxChars: number) {
  let used = 0;
  const selected: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const separatorChars = selected.length ? 2 : 0;
    const remaining = maxChars - used - separatorChars;
    if (remaining <= 0) break;
    const marker = "\n[context clipped]";
    const clipped = trimmed.length > remaining;
    const next = clipped
      ? remaining >= marker.length
        ? `${trimmed.slice(0, remaining - marker.length)}${marker}`
        : trimmed.slice(0, remaining)
      : trimmed;
    selected.push(next);
    used += next.length + separatorChars;
    if (clipped) break;
  }
  return selected.join("\n\n");
}

function referenceBlock(reference: NonNullable<AgentJob["references"]>[number]) {
  return [
    `- [${reference.kind}] ${reference.label}`,
    reference.detail ? `  Detail: ${reference.detail}` : "",
    reference.path ? `  Path/URL: ${reference.path}` : "",
    reference.content ? `  Context:\n${reference.content}` : "",
  ].filter(Boolean).join("\n");
}

function factBlock(title: string, facts: ReadonlyArray<{ id: string; content: string }>, maxChars: number) {
  if (!facts.length) return "";
  const body = boundedJoin(
    facts.map((fact) => `- ${fact.id}: ${fact.content}`),
    maxChars,
  );
  return body ? `${title}:\n${body}` : "";
}

/**
 * Provider-neutral scoped instructions/context. This deliberately excludes the
 * persisted conversation transcript. Native runtimes combine it with their own
 * session; the custom harness combines it with Metis-managed messages.
 *
 * Context is layered: stable core + current task references + tool-driven repo map +
 * retrieved durable context + bounded chat working memory. Checkpoints/history are
 * owned by recovery/compaction and provider-native sessions, not replayed here.
 */
export function buildProviderPrompt(input: ProviderPromptContext): string {
  const job = input.job;
  const chat = getChat(job.chatId, job.userId);
  if (!chat) return metisAgentIdentity();
  const ownerId = job.userId ?? chat.ownerId;
  const incognito = Boolean(job.incognito || chat.incognito);

  const rawReferences = (job.references || []).map((reference) => ({
    ...reference,
    source: "explicit" as const,
  }));
  const resolvedReferences = resolveScopeReferences(ownerId, chat.id, rawReferences, incognito);
  const scope = loadContextScope({
    chatId: chat.id,
    ownerId,
    references: resolvedReferences,
    includeGlobal: !incognito,
  });
  const project = !incognito ? scope?.project : undefined;
  const globalSettings = getGlobalModelSettings(ownerId);
  const skillSettings = projectSkillSettings(globalSettings, project);
  const activeMode = modeById(job.modeId || chat.sessionState?.modeId, globalSettings.customModes || []);
  const globalFacts = incognito
    ? []
    : globalFactsForScope({
        chatId: chat.id,
        ownerId,
        includeGlobal: project?.memoryMode !== "project_only",
      });

  const explicit = boundedJoin([
    ...resolvedReferences.map(referenceBlock),
    job.referenceText ? `Referenced context:\n${job.referenceText}` : "",
    buildAttachmentPrompt(job.chatId, job.attachments, ownerId),
  ], EXPLICIT_CONTEXT_CHARS);

  const pinned = boundedJoin([
    ...(incognito ? [] : scope?.pinnedNotes || []).map((note) =>
      `- [note] ${note.title || "Untitled note"}\n  Context:\n${note.content}`,
    ),
  ], PINNED_CONTEXT_CHARS);

  const retrievalQuery = [
    job.message,
    job.referenceText,
    ...resolvedReferences.flatMap((reference) => [reference.label, reference.detail, reference.path]),
    project?.name,
  ].filter((value): value is string => Boolean(value?.trim())).join("\n");

  // Reload bounded chat facts from durable storage on every prompt build,
  // independently of native session history/compaction and current wording.
  const workingFacts = selectChatContinuityFacts(retrievalQuery, incognito ? [] : scope?.learnedFacts || []);
  const retrievedGlobalFacts = retrieveRelevantFacts(retrievalQuery, globalFacts, {
    limit: 8,
    fallback: 0,
  });

  const agentMemory = project?.mode === "agents";
  const workingBlock = factBlock(agentMemory ? "Agent working memory" : "Chat working memory", workingFacts, CHAT_FACT_CHARS);
  const projectBlock = project ? projectContextBlock(project, ownerId) : "";
  const globalBlock = factBlock("Retrieved global durable memory", retrievedGlobalFacts, GLOBAL_CONTEXT_CHARS);

  return [
    // Layer 1 — Core Context: stable identity, policy, mode and tool contract.
    metisAgentIdentity(),
    !incognito ? projectTeamContextBlock(chat.id, ownerId) : "",
    `Current agent mode: ${activeMode.name}\n${activeMode.instructions}`,
    formatChatGoal(chat.sessionState, ownerId, chat.id, incognito),
    chatMetadataPrompt(chat, incognito),
    skillsCatalogPrompt(skillSettings),
    alwaysOnSkillsPrompt(skillSettings),
    autoSkillActivationPrompt(job.message, skillSettings, {
      hasVisualReference: Boolean(job.attachments?.some((attachment) => attachment.kind === "image")),
    }),
    "Working style: precise, technically fluent, proactive. Act with tools instead of narrating steps. Reply in the user's language. On clear orders decide and act; ask only when genuinely ambiguous or destructive.",
    "Execution efficiency: batch related read-only inspection instead of issuing many tiny calls; reuse the known project/repository cwd instead of rediscovering it; run targeted checks while iterating and the expensive full test/build pass only once after the working tree has stopped changing. Parallelize independent lightweight reads when safe, but do not run competing heavyweight builds. Keep progress narration to short milestone updates rather than one message per tool call.",
    !incognito ? agentRulesPrompt(globalSettings) : "",
    METIS_SHARED_AGENT_CONTROL,
    toolContractPrompt({
      modeId: job.modeId || chat.sessionState?.modeId || "agent",
      provider: input.provider || "alternative-provider",
      toolNames: input.toolNames,
      nativeTools: Boolean(input.nativeTools),
    }),
    // Layer 2 — Task State lives in the provider's current user turn. Do not
    // duplicate job.message here. Explicit references are the only addendum.
    explicit ? `Task context — explicit references:\n${explicit}` : "",
    // Layer 3 — Repo Map is metadata/tool-driven, never a repository dump.
    "Repository map: the filesystem/repository is durable external memory. Search/index first, then read only relevant files and symbols; never replay a whole repository into model context.",
    // Layers 4/5 — Retrieved Context + Working Memory.
    job.incognito || chat?.incognito ? "" : `Keep a small ${agentMemory ? "agent" : "chat"} working memory for decisions, constraints and corrections needed to continue this task. Use add_memory/edit_memory with scope chat at milestones; replace obsolete facts instead of accumulating transcripts. These facts belong only to this ${agentMemory ? "agent’s own chat" : "chat"}. Use global memories only when explicitly requested by the user.`,
    pinned ? `Pinned chat context:\n${pinned}` : "",
    projectBlock ? `Project context:\n${projectBlock}` : "",
    workingBlock ? `${workingBlock}\nThis bounded context belongs only to the current ${agentMemory ? "agent’s own chat" : "chat"} and is reloaded from durable storage. Preserve it across compaction/resume; newer user corrections take precedence. Do not automatically create global memories from normal chat prompts.` : "",
    globalBlock,
    // Layer 6 — Checkpoints are injected only by recovery/compaction code.
    // Layer 7 — Raw History stays provider-owned for native sessions; custom
    // harnesses use the bounded compaction pipeline instead of this prompt.
    incognito
      ? "Incognito mode: do not use chat/project/global durable memory or personal context. Explicit references supplied in this request remain allowed."
      : project?.memoryMode === "project_only"
        ? "Include global memory is OFF. Use only project memories; global memory and personal context-hub tools are unavailable for both reading and writing."
        : "Use retrieved profile and preference memories to resolve known references and adapt tools, commands, language, and formatting when relevant. Treat inferred or low-confidence facts as uncertain, prefer newer confirmed facts, and do not mention unrelated personal context. Personal/context-hub data is retrieval-only: request the smallest useful slice; never dump the database into the prompt.",
  ].filter(Boolean).join("\n\n");
}
