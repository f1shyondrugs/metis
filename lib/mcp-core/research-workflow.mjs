import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeTaskList } from "./task-list.mjs";

export const DEFAULT_RESEARCH_SOURCES = 200;
export const DEFAULT_RESEARCH_WORDS = 4000;
const mutationLocks = new Map();
async function mutateResearch(key, action) {
  const previous = mutationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  mutationLocks.set(key, current);
  await previous.catch(() => {});
  try { return await action(); }
  finally { release(); if (mutationLocks.get(key) === current) mutationLocks.delete(key); }
}
const schema = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
export const RESEARCH_WORKFLOW_TOOLS = [
  { name: "research_plan", description: "Before researching, submit plan as a JSON array of individual step strings for user review, not Markdown or a JSON code block. Opens a blocking form with numbered steps that the user can edit, reorder, add or delete and an explicit Approve, Revise or Deny choice. Only a submitted approval unlocks research; use the returned edited plan. Denial/cancellation stops research. Does not create a Plan workspace.",
    inputSchema: { "x-metis-waits-for-user": true, ...schema({ title: { type: "string", minLength: 1, maxLength: 200 }, plan: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 4000 }, description: "Ordered research steps as JSON strings, up to 4000 characters total. Numbering is added by the UI." }, language: { type: "string", description: "Accepted for compatibility. Built-in form controls are always in English; supplied research content keeps its language." }, source_target: { type: "integer", minimum: 1, maximum: 1000, description: "Distinct sources to actually read; default 200. The user can edit this in the review." }, minimum_words: { type: "integer", minimum: 500, maximum: 30000, description: "Minimum report length; default 4000 words. The user can edit this in the review." } }, ["title", "plan"]) },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "research_progress", description: "Update the approved research tracker in place. Mark a 1-based approved step in_progress or completed, and optionally add a brief factual note. Source counters come from real tool evidence.", inputSchema: schema({ step: { type: "integer", minimum: 1, maximum: 20 }, status: { type: "string", enum: ["pending", "in_progress", "completed"] }, note: { type: "string", maxLength: 1000 } }, ["step", "status"]), annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "research_report", description: "Finish approved research by saving the complete report in a real Canvas in the current chat. Include findings, evidence, citations, limitations and sources. Returns the confirmed Canvas link; users read and export it there. No automatic report file or arbitrary workspace file writes.",
    inputSchema: schema({ title: { type: "string", minLength: 1, maxLength: 200 }, content: { type: "string", minLength: 1, maxLength: 500000 } }, ["title", "content"]),
    annotations: { readOnlyHint: false, destructiveHint: false } },
];

// Older provider sessions may still send the previous Markdown tool argument.
function inputTasks(plan) {
  if (typeof plan === "string") {
    if (plan.length > 4000) throw new Error("Research steps may contain at most 4000 characters in total.");
    plan = plan.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, "").trim()).filter(Boolean);
  }
  return normalizeTaskList(plan);
}
function researchNumber(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected a number from ${min} to ${max}`);
  return value;
}
export function researchPlanForm({ title, plan, source_target, minimum_words }) {
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw new Error("A research title up to 200 characters is required");
  const tasks = inputTasks(plan);
  return {
    language: "en",
    title: "Review research plan",
    description: title.trim(),
    submitLabel: "Submit decision",
    questions: [
      { key: "plan", type: "task_list", question: "Research steps", default: tasks, description: "Use the pencil to edit, add and reorder steps.", required: true },
      { key: "decision", type: "radio", question: "Decision", required: true, options: [
        { label: "Approve and research", value: "approve" },
        { label: "Revise", value: "revise" },
        { label: "Deny", value: "deny" },
      ] },
      { key: "source_target", type: "number", question: "Sources to actually read", default: researchNumber(source_target, DEFAULT_RESEARCH_SOURCES, 1, 1000), min: 1, max: 1000, step: 1 },
      { key: "minimum_words", type: "number", question: "Report: minimum words", default: researchNumber(minimum_words, DEFAULT_RESEARCH_WORDS, 500, 30000), min: 500, max: 30000, step: 500 },
    ],
  };
}

// Only the authenticated account/chat/run selects storage. Tool arguments cannot supply identity.
export function createResearchWorkflow({ stateDir, ask, attachReport, evidence }) {
  const privateStates = new Map();
  const pending = new Set();
  function identity(context) {
    if (!context.userId || !context.chatId || !context.jobId) throw new Error("Research workflow requires an authenticated chat run");
    return createHash("sha256").update(JSON.stringify([context.userId, context.chatId, context.jobId])).digest("hex");
  }
  const file = key => path.join(stateDir, "research-workflows", key + ".json");
  async function load(context) {
    const key = identity(context);
    if (context.incognito) {
      const state = privateStates.get(key);
      if (state?.expiresAt > Date.now()) return state.value;
      privateStates.delete(key);
      return undefined;
    }
    try { return JSON.parse(await fs.readFile(file(key), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  }
  async function save(context, state) {
    const key = identity(context);
    if (context.incognito) {
      for (const [id, item] of privateStates) if (item.expiresAt <= Date.now()) privateStates.delete(id);
      if (!privateStates.has(key) && privateStates.size >= 128) privateStates.delete(privateStates.keys().next().value);
      privateStates.set(key, { value: state, expiresAt: Date.now() + 86400000 });
      return;
    }
    await fs.mkdir(path.dirname(file(key)), { recursive: true, mode: 0o700 });
    const temp = file(key) + "." + randomUUID() + ".tmp";
    try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temp, file(key)); }
    finally { await fs.rm(temp, { force: true }); }
  }
  async function approved(context) {
    const state = await load(context);
    if (!["approved", "researching", "report_attached"].includes(state?.status)) throw new Error("Research is locked: call research_plan and wait for explicit user approval. A denial, revision, cancellation or missing answer is not approval.");
    return { ...state, sourceTarget: researchNumber(state.sourceTarget, DEFAULT_RESEARCH_SOURCES, 1, 1000), minimumWords: researchNumber(state.minimumWords, DEFAULT_RESEARCH_WORDS, 500, 30000) };
  }
  async function progressSnapshot(state, context) {
    const counts = evidence && state.questionId ? await evidence(context) : undefined;
    return {
      kind: "research-progress", runId: context.jobId, questionId: state.questionId,
      title: state.title, language: state.language || "en", status: state.status,
      plan: state.plan || [], steps: state.steps || (state.plan || []).map((content, index) => ({ id: index + 1, content, status: "pending" })),
      sourceTarget: state.sourceTarget || DEFAULT_RESEARCH_SOURCES, minimumWords: state.minimumWords || DEFAULT_RESEARCH_WORDS,
      discoveredCount: counts?.sources?.length || 0, openedCount: counts?.openedCount || 0, readCount: counts?.readCount || 0,
      blockedCount: counts?.blockedCount || 0, failedCount: counts?.failedCount || 0,
      ...(state.note ? { note: state.note } : {}), ...(state.downloadUrl ? { downloadUrl: state.downloadUrl } : {}),
      ...(state.canvasId || state.artifact?.canvasId ? { canvasId: state.canvasId || state.artifact.canvasId } : {}),
      ...(state.workspaceLink || state.artifact?.workspaceLink ? { workspaceLink: state.workspaceLink || state.artifact.workspaceLink } : {}),
    };
  }
  return {
    state: load,
    async snapshot(context) {
      const state = await load(context);
      return state ? progressSnapshot(state, context) : undefined;
    },
    async progress(args, context) {
      return mutateResearch(file(identity(context)), async () => {
      const state = await approved(context);
      if (state.status === "report_attached") return { research: await progressSnapshot(state, context) };
      const index = researchNumber(args.step, undefined, 1, state.plan.length) - 1;
      if (!Number.isInteger(index) || !["pending", "in_progress", "completed"].includes(args.status)) throw new Error("A valid approved step and status are required");
      const steps = state.steps || state.plan.map((content, i) => ({ id: i + 1, content, status: "pending" }));
      const next = { ...state, status: "researching", note: String(args.note || "").slice(0, 1000),
        steps: steps.map((step, i) => ({ ...step, status: i === index ? args.status : args.status === "in_progress" && step.status === "in_progress" ? "pending" : step.status })) };
      await save(context, next);
      return { research: await progressSnapshot(next, context) };
      });
    },
    async assertAllowed(name, context) {
      if (context.modeId !== "deep-research") return;
      // Setup, skill reads and clarification remain possible; evidence gathering waits.
      if (/^(research_(search|open|find|sources|report|progress)|web_|browser_|context7_)/.test(name) || ["call_mcp_tool", "context_search", "search_notes", "list_notes", "list_memories", "search_chats"].includes(name)) await approved(context);
    },
    async plan(args, context, options = {}) {
      const form = researchPlanForm(args);
      const previous = await load(context);
      if (["denied", "cancelled"].includes(previous?.status)) throw new Error("Research was declined or cancelled in this run. A new user request must start a new run before another plan is proposed.");
      if (["approved", "researching", "report_attached"].includes(previous?.status)) return { ...previous, research: await progressSnapshot(previous, context), next: previous.status === "report_attached" ? "Return the existing report link; do not create a duplicate report." : "Continue the already approved research; do not request approval again." };
      const key = identity(context);
      if (pending.has(key)) throw new Error("A research plan is already awaiting a decision");
      pending.add(key);
      try {
        await save(context, { status: "awaiting_approval", title: args.title, plan: form.questions[0].default });
        const answer = await ask(form, context, options);
        // Typed form values from the user-answer endpoint only. Never accept args or default selections.
        const decision = answer?.questionId && answer.values?.decision;
        let plan = [];
        try { plan = typeof args.plan === "string" ? inputTasks(answer?.values?.plan) : normalizeTaskList(answer?.values?.plan); } catch { /* Invalid submissions never unlock research. */ }
        const status = decision === "approve" && plan.length ? "approved" : decision === "revise" ? "revision_requested" : "denied";
        const state = { version: 2, status, title: args.title, plan, language: form.language,
          sourceTarget: researchNumber(answer?.values?.source_target ?? args.source_target, DEFAULT_RESEARCH_SOURCES, 1, 1000),
          minimumWords: researchNumber(answer?.values?.minimum_words ?? args.minimum_words, DEFAULT_RESEARCH_WORDS, 500, 30000),
          steps: plan.map((content, index) => ({ id: index + 1, content, status: index === 0 && status === "approved" ? "in_progress" : "pending" })),
          questionId: answer?.questionId, decidedAt: new Date().toISOString() };
        await save(context, state);
        return { ...state, research: await progressSnapshot(state, context), next: status === "approved" ? "Research the edited plan. This approved card is the tracker: update research_progress for each step and after reading batches. Read the approved source target fully, then save the long report in Canvas with research_report." : status === "revision_requested" ? "Revise this edited plan and submit it again. Do not research yet." : "Stop research. Do not resubmit unless the user asks." };
      } catch (error) { await save(context, { status: "cancelled" }); throw error; }
      finally { pending.delete(key); }
    },
    async report(args, context) {
      return mutateResearch(file(identity(context)), async () => {
      const state = await approved(context);
      if (state.status === "report_attached" && state.artifact) return { status: "report_attached", approvedPlan: state.plan, research: await progressSnapshot(state, context), ...state.artifact };
      if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 200 || typeof args.content !== "string" || !args.content.trim() || Buffer.byteLength(args.content, "utf8") > 500000) throw new Error("A report title and nonempty content up to 500000 bytes are required");
      if (evidence) {
        const counts = await evidence(context);
        if ((counts.readCount || 0) < state.sourceTarget) throw new Error(`Research incomplete: ${counts.readCount || 0}/${state.sourceTarget} sources fully read. Continue research; opened excerpts and snippets do not count as fully read sources.`);
        const words = args.content.trim().split(/\s+/u).length;
        if (words < state.minimumWords) throw new Error(`Report incomplete: ${words}/${state.minimumWords} words. Complete the detailed report covering every approved step.`);
      }
      const artifact = await attachReport({ title: args.title.trim(), content: args.content }, context);
      if (typeof artifact?.canvasId !== "string" || !/^[^/?#\s]+$/.test(artifact.canvasId) || artifact.workspaceLink !== `workspace://canvas/${artifact.canvasId}`) {
        throw new Error("Report Canvas was not confirmed. Retry research_report; delivery is incomplete.");
      }
      const completed = { ...state, status: "report_attached", canvasId: artifact.canvasId, workspaceLink: artifact.workspaceLink, artifact,
        completedAt: new Date().toISOString(), steps: (state.steps || []).map(step => ({ ...step, status: "completed" })) };
      await save(context, completed);
      // A failed Canvas save remains retryable; completion requires a confirmed workspace.
      return { status: "report_attached", approvedPlan: state.plan, research: await progressSnapshot(completed, context), ...artifact };
      });
    },
  };
}
