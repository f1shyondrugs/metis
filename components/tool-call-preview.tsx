"use client";

import { Brain, Check, Circle, LoaderCircle } from "lucide-react";
import { PlanWorkspaceCard } from "@/components/plan-workspace-card";
import { CanvasWorkspaceCard } from "@/components/canvas-workspace-card";
import {CalendarEventCard,DeferredCalendarEventCard} from "@/components/calendar/calendar-event-card";
import {calendarEventToolId,calendarEventMutation} from "@/lib/calendar-event-link";
import { AutomationCard } from "@/components/automation-card";
import { planLooksParallelizable } from "@/lib/modes";
import { parseAutomationCard } from "@/lib/tool-kind";
import { canvasFromToolPayload, hydrateCanvasPreview, isToolRunning, memoryCardFromPayload, planFromToolPayload, unwrapToolRecord, workspaceIdFromLink } from "@/lib/tool-call-display";
import type { ToolCallData } from "@/components/tool-call-chip";

type Plan = { title: string; content: string; workspaceLink?: string };
type Props = {
  tool: Pick<ToolCallData, "name" | "kind" | "input" | "result" | "detail" | "status" | "todos" | "resultUrl">;
  workspaces?: Array<{ id: string; type?: string; name?: string; content?: string }>;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: Plan, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onNavigate?: () => void;
  inline?: boolean;
};

/** Reuse the saved artifact cards in chat and in the tool details popover. */
export function ToolCallPreview({ tool, workspaces, onOpenWorkspace, onBuildPlan, buildDisabled, onNavigate, inline = false }: Props) {
  const { name, kind, input, result, detail, status, todos } = tool;
  const calendarId=calendarEventToolId(name,input,result,status);
  const mutation = /(?:^|__|[.:/-])(?:(?:create|edit)_(?:plan|canvas)|(?:add|create|edit)_memory)$/i.test(name);
  const terminal = /^(completed|success|succeeded|done)$/i.test(status);
  const deferredCalendar=terminal&&Boolean(tool.resultUrl)&&calendarEventMutation(name,input);
  const artifactKind = kind === "plan" || kind === "canvas" || kind === "memory";
  if (inline && !calendarId && !deferredCalendar && (!artifactKind || !mutation || !terminal)) return null;
  const running = isToolRunning(status) && result === undefined;
  const payload = unwrapToolRecord(result);
  const structured = unwrapToolRecord(payload?.structuredContent ?? payload?.structured_content);
  const failed = /^(error|failed|declined|canceled|cancelled)$/i.test(status)
    || [payload, structured].some(outcome => Boolean(outcome?.isError || outcome?.error)
      || outcome?.success === false || outcome?.ok === false
      || /^(error|failed|declined|canceled|cancelled)$/i.test(String(outcome?.status || "")));
  if (inline && failed) return null;
  if(calendarId&&!failed)return <CalendarEventCard id={calendarId}/>;
  if(deferredCalendar&&!failed)return <DeferredCalendarEventCard name={name} input={input} resultUrl={tool.resultUrl!} status={status}/>;
  const resultText = result?.trim() || "";
  const hasResult = Boolean(resultText) && (payload
    ? Object.keys(payload).length > 0
    : !/^(?:\{|\[|null$|false$)/.test(resultText));
  const savedWorkspace = (link: string | undefined, type: "plan" | "canvas") => {
    const id = workspaceIdFromLink(link, type);
    return Boolean(id && workspaces?.some(workspace => workspace.id === id && workspace.type === type));
  };
  if (kind === "todo" && todos) {
    const completed = todos.filter(todo => /^(completed|done)$/i.test(todo.status || "")).length;
    return <section aria-label="Task checklist" className="mb-3 border-b border-border pb-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-medium">{failed ? "Requested tasks" : "Tasks"}</h3>
        <span className="tabular-nums text-muted-foreground">{completed}/{todos.length}</span>
      </div>
      <ul className="space-y-2">{todos.map((todo, index) => {
        const done = /^(completed|done)$/i.test(todo.status || "");
        const active = /^(in_progress|running)$/i.test(todo.status || "");
        const Icon = done ? Check : active ? LoaderCircle : Circle;
        return <li key={todo.id || index} className="flex items-start gap-2">
          <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className={done ? "min-w-0 break-words text-muted-foreground line-through" : "min-w-0 break-words"}>{todo.content}<span className="sr-only"> — {todo.status || "pending"}</span></span>
        </li>;
      })}</ul>
      {!todos.length && <p className="text-muted-foreground">No tasks.</p>}
    </section>;
  }
  if (kind === "memory") {
    if (inline && !hasResult) return null;
    const memory = memoryCardFromPayload(name, input || detail, result, failed ? "error" : running ? "running" : status);
    if (inline) return <div aria-label="Memory details" className="my-2 flex w-full items-start gap-2.5 rounded-xl border border-violet-400/15 bg-violet-400/[0.035] px-3 py-2.5 text-xs">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300"><Brain className="size-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground/85">{memory.title}</p>
        <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap break-words leading-5 text-foreground/75">{memory.body}</p>
      </div>
    </div>;
    return <section aria-label="Memory details" className="mb-3 border-b border-border pb-3">
      <h3 className="mb-1 font-medium">{memory.title}</h3>
      <p className="whitespace-pre-wrap break-words">{memory.body}</p>
    </section>;
  }
  if (running || failed) return null;
  if (kind === "plan") {
    const plan = planFromToolPayload(input, inline && !hasResult ? undefined : result, detail);
    if (inline && !hasResult && !savedWorkspace(plan?.workspaceLink, "plan")) return null;
    return plan ? <PlanWorkspaceCard {...plan} onOpen={onOpenWorkspace}
      onBuild={() => onBuildPlan?.(plan)}
      onBuildWithAgents={() => onBuildPlan?.(plan, { multiAgent: true })}
      showMultiAgent={planLooksParallelizable(plan.content)} buildDisabled={buildDisabled} compact /> : null;
  }
  if (kind === "canvas") {
    const canvas = hydrateCanvasPreview(canvasFromToolPayload(input, inline && !hasResult ? undefined : result, detail), workspaces);
    if (inline && !hasResult && !savedWorkspace(canvas?.workspaceLink, "canvas")) return null;
    return canvas ? <CanvasWorkspaceCard {...canvas} onOpen={onOpenWorkspace} /> : null;
  }
  const automation = parseAutomationCard(name, result, input, detail);
  return automation ? <AutomationCard {...automation} onOpen={() => {
    onNavigate?.();
    window.dispatchEvent(new CustomEvent("ai-chat:open-automations", { detail: { id: automation.id } }));
  }} /> : null;
}
