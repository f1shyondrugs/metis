import type { AskUserInput } from "../question-contract";
import type { GatewayTool } from "./gateway-core.mjs";
import type { ResearchProgress } from "../research-progress";
type Context = Record<string, unknown>;
type PlanInput = { title: string; plan: string[] | string; language?: string; source_target?: number; minimum_words?: number };
type ReportInput = { title: string; content: string };
export type ResearchWorkflowState = {
  status: string; title?: string; plan?: string[]; sourceTarget?: number; minimumWords?: number;
  steps?: ResearchProgress["steps"]; note?: string; questionId?: string;
  canvasId?: string; workspaceLink?: string;
};
export const DEFAULT_RESEARCH_SOURCES: number;
export const DEFAULT_RESEARCH_WORDS: number;
export const RESEARCH_WORKFLOW_TOOLS: GatewayTool[];
export function researchPlanForm(args: PlanInput): AskUserInput;
export function createResearchWorkflow(input: {
  stateDir: string;
  ask?: (form: AskUserInput, context: Context, options: { signal?: AbortSignal }) => Promise<unknown>;
  attachReport?: (report: ReportInput, context: Context) => Promise<Record<string, unknown>>;
  evidence?: (context: Context) => Promise<{ sources?: unknown[]; openedCount?: number; readCount?: number; blockedCount?: number; failedCount?: number }>;
}): {
  state(context: Context): Promise<ResearchWorkflowState | undefined>;
  snapshot(context: Context): Promise<ResearchProgress | undefined>;
  progress(args: {step: number; status: string; note?: string}, context: Context): Promise<{research: ResearchProgress}>;
  assertAllowed(name: string, context: Context): Promise<void>;
  plan(args: PlanInput, context: Context, options?: { signal?: AbortSignal }): Promise<{ status: string; plan: string[]; next: string; research: ResearchProgress }>;
  report(args: ReportInput, context: Context): Promise<Record<string, unknown>>;
};
