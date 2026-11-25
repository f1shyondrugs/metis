"use client";

import { WorkspaceSearchResults } from "@/components/workspace-search-results";
import { workspaceSearchResult, workspaceSearchCount } from "@/lib/workspace-search-result";
import { RunStatus } from "@/components/run-status";
import { ArrivalFade } from "@/components/arrival-fade";
import { toolMotionKey } from "@/lib/live-message-motion";
import { ToolInputStatus, ToolPreparationDetails } from "@/components/tool-input-status";
import { latestPreparingTool } from "@/lib/tool-preparation";
import { AnimatedNumber } from "@/components/animated-number";
import { ActivityDisclosureTrigger } from "@/components/activity-disclosure-trigger";

import {
  BookOpen,
  Bot,
  Brain,
  Cable,
  CalendarClock,
  Check,
  Code2,
  FilePenLine,
  FolderOpen,
  Globe2,
  ListTodo,
  ExternalLink,
  Search,
  Shrink,
  StickyNote,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { loadToolPayload, resolveWorkspaceToolOpen, type FullToolPayload } from "@/lib/tool-result-client";
import { cn } from "@/lib/utils";
import { internalLinkNavigation } from "@/lib/internal-link";
import { ToolCallPreview } from "@/components/tool-call-preview";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

import {
  compactFileDiff,
  enrichToolDisplay,
  isToolRunning,
  noteReferencesFromToolPayload,
  planFromToolPayload,
  toolCallHeadline,
  toolSourceLabel,
  activityGroupLabel,
  truncateToolText,
  type ToolActionIcon,
  type ToolKind,
} from "@/lib/tool-call-display";
import { looksLikeTranscriptDump } from "@/lib/agent-transcript";

import { ThinkingBlock } from "@/components/thinking-block";
import { activityActionClass, activityRowClass } from "@/lib/activity-display";

export type ToolCallData = {
  id: string;
  name: string;
  status: string;
  phase?: "preparing" | "executing";
  inputChars?: number;
  detail?: string;
  kind?: ToolKind;
  source?: "mcp" | "native" | "browser";
  path?: string;
  diff?: { before?: string; after?: string; additions?: number; deletions?: number };
  input?: string;
  result?: string;
  resultUrl?: string;
  inputUrl?: string;
  todos?: Array<{ id?: string; content: string; status?: string }>;
  subagent?: {
    agentId?: string;
    chatId?: string;
    title?: string;
    mode?: string;
    model?: string;
    prompt?: string;
    messages?: Array<{ role: string; text: string; timestamp?: string }>;
    tools?: ToolCallData[];
  };
};

type ToolCallProps = ToolCallData & {
  onOpenDiff?: () => void;
  onOpenSubagent?: () => void;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: () => void;
  nested?: boolean;
  hostnames?: Record<string, string>;
  workspaces?: Array<{ id: string; type?: string; name?: string; content?: string }>;
};

const ACTION_ICONS: Record<ToolActionIcon, typeof BookOpen> = {
  folder: FolderOpen,
  search: Search,
  read: BookOpen,
  edit: FilePenLine,
  shell: Terminal,
  mcp: Wrench,
  browser: Globe2,
  subagent: Bot,
  compress: Shrink,
  todo: ListTodo,
  plan: ListTodo,
  canvas: StickyNote,
  memory: Brain,
  automation: CalendarClock,
  other: Wrench,
};

function formatStructuredValue(value: unknown, indent = 0): string {
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);

  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const formatted = formatStructuredValue(item, indent + 2);
        return typeof item === "object" && item !== null
          ? `${padding}${index}:\n${formatted}`
          : `${padding}${index}: ${formatted}`;
      })
      .join("\n");
  }

  return Object.entries(value)
    .map(([key, item]) => {
      const formatted = formatStructuredValue(item, indent + 2);
      return typeof item === "object" && item !== null
        ? `${padding}${key}:\n${formatted}`
        : `${padding}${key}: ${formatted}`;
    })
    .join("\n");
}

function formatToolOutput(value?: string): string {
  if (!value) return "";
  if (looksLikeTranscriptDump(value)) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "status" in parsed &&
      (parsed as { status?: unknown }).status === "success" &&
      "value" in parsed &&
      Object.keys((parsed as { value?: unknown }).value ?? {}).length === 0
    ) {
      return "";
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { plan?: unknown }).plan === "string"
    ) {
      return (parsed as { plan: string }).plan;
    }
    const formatted = typeof parsed === "string" ? parsed : formatStructuredValue(parsed);
    if (looksLikeTranscriptDump(formatted)) return "";
    return truncateToolText(formatted);
  } catch {
    // Tool output is often plain text.
  }
  return truncateToolText(value);
}

function displayedDiffStats(diff?: ToolCallData["diff"], input?: string) {
  if (!diff && !input) return null;
  if (diff && (typeof diff.additions === "number" || typeof diff.deletions === "number")) {
    if ((diff.additions ?? 0) !== 0 || (diff.deletions ?? 0) !== 0 || diff.before === diff.after) {
      return { additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 };
    }
  }
  try {
    const parsed = input ? JSON.parse(input) as { edits?: Array<{ oldText?: unknown; newText?: unknown }>; content?: unknown } : null;
    if (Array.isArray(parsed?.edits)) {
      return parsed.edits.reduce(
        (stats, edit) => ({
          additions: stats.additions + (typeof edit.newText === "string" && edit.newText ? edit.newText.split("\n").length : 0),
          deletions: stats.deletions + (typeof edit.oldText === "string" && edit.oldText ? edit.oldText.split("\n").length : 0),
        }),
        { additions: 0, deletions: 0 },
      );
    }
    if (typeof parsed?.content === "string") {
      return { additions: parsed.content ? parsed.content.split("\n").length : 0, deletions: 0 };
    }
  } catch {
    // Input may be streamed plain text.
  }
  const before = (diff?.before ?? "").split("\n");
  const after = (diff?.after ?? "").split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    additions: Math.max(0, afterEnd - start),
    deletions: Math.max(0, beforeEnd - start),
  };
}



function toolReactKey(tool: ToolCallData, index: number): string {
  const id = tool.id?.trim();
  if (id) return `tool-${id}`;
  const fingerprint = [tool.kind, tool.name, tool.path, tool.input, tool.result]
    .filter(Boolean)
    .join(":")
    .slice(0, 160);
  return `tool-${fingerprint || "unknown"}-${index}`;
}



export const ToolCallChip = memo(function ToolCallChip({
  name,
  status,
  phase,
  inputChars,
  detail,
  kind,
  path,
  diff,
  input: previewInput,
  result: previewResult,
  resultUrl,
  inputUrl,
  subagent,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  nested = false,
  todos,
  hostnames,
  source,
  workspaces,
}: ToolCallProps) {
  const [userOpen, setUserOpen] = useState(false);
  const [loadedOutput, setLoadedOutput] = useState<{ url: string; payload: FullToolPayload } | null>(null);
  const [outputError, setOutputError] = useState("");
  const [outputRetry, setOutputRetry] = useState(0);
  const payloadUrl = inputUrl || resultUrl;
  const fullPayload = loadedOutput?.url === payloadUrl ? loadedOutput?.payload : undefined;
  const input = inputUrl ? fullPayload?.input ?? previewInput : previewInput;
  const result = resultUrl ? fullPayload?.result ?? previewResult : previewResult;
  // A few adapters deliver the result while leaving the lifecycle status at
  // "running". The result is terminal evidence, so never keep the spinner in
  // that case (including an intentionally empty response).
  const running = isToolRunning(status) && result === undefined;
  const failed = /^(error|failed|declined|canceled|cancelled)$/i.test(status);
  const display = useMemo(() => enrichToolDisplay({ name, input, result, kind }), [name, input, result, kind]);
  const todoItems = display.kind === "note" ? undefined : todos ?? display.todos;
  const resolvedKind = display.kind;
  const noteReferences = useMemo(() => resolvedKind === "note" ? noteReferencesFromToolPayload(result, status) : [], [resolvedKind, result, status]);
  const openNote = (id: string) => {
    const navigation = internalLinkNavigation({kind:"note",id});
    setUserOpen(false);
    window.dispatchEvent(new CustomEvent(navigation.event,{detail:navigation.detail}));
  };
  const isCommand = resolvedKind === "shell";
  const expanded = userOpen;
  useEffect(() => {
    if (!expanded) { setLoadedOutput(null); setOutputError(""); return; }
    if (!payloadUrl || loadedOutput?.url === payloadUrl) return;
    const controller = new AbortController();
    setOutputError("");
    void loadToolPayload(payloadUrl, controller.signal).then(full => {
      if (!controller.signal.aborted) setLoadedOutput({ url: payloadUrl, payload: full });
    }).catch(() => {
      if (!controller.signal.aborted) setOutputError("Could not load full tool details");
    });
    return () => controller.abort();
  }, [expanded, resolvedKind, payloadUrl, loadedOutput, outputRetry]);
  const outputStatus = payloadUrl && loadedOutput?.url !== payloadUrl ? (
    <p role="status" className="text-muted-foreground">
      {outputError ? <button type="button" onClick={() => setOutputRetry(value => value + 1)}>{outputError} · Retry</button> : "Loading tool details…"}
    </p>
  ) : null;
  const resolvedName = display.name || name;
  const searchResult = useMemo(() => /(?:^|__|[.:])(?:grep_search|file_search)$/.test(resolvedName) ? workspaceSearchResult(result) : undefined, [resolvedName, result]);
  const deleteTool = /(^|[._:/-])(delete|remove|unlink)(?=[._:/-]|$)/i.test(resolvedName);
  const headline = useMemo(() => toolCallHeadline({ name: resolvedName, kind: resolvedKind, input, detail, path, hostnames }), [resolvedName, resolvedKind, input, detail, path, hostnames]);
  const sourceLabel = toolSourceLabel({ name, input, kind: resolvedKind, source });
  const Icon = deleteTool && (resolvedKind === "edit" || headline.icon === "edit")
    ? Trash2
    : resolvedKind === "note" ? StickyNote : ACTION_ICONS[headline.icon];
  const clickable = resolvedKind === "edit" && Boolean(diff || path);
  const subagentClickable = resolvedKind === "subagent";
  const workspaceClickable = resolvedKind === "plan" || resolvedKind === "canvas" || resolvedKind === "browser";
  if (running && phase === "preparing") return <div data-tool-call-row data-tool-kind={resolvedKind} className={cn(nested ? "my-0" : "my-0.5", "flex w-full min-w-0")}><ToolInputStatus name={resolvedName} kind={resolvedKind} source={source} characters={inputChars}/></div>;
  const previewText = resolvedKind === "todo" && todoItems ? `${todoItems.filter(todo => /^(completed|done)$/i.test(todo.status || "")).length}/${todoItems.length} completed` : noteReferences.length === 1 ? noteReferences[0].title : headline.preview;
  const diffStats = displayedDiffStats(diff, input);
  return (
    <Popover open={expanded} onOpenChange={setUserOpen}>
      <div className={cn(nested ? "my-0" : "my-0.5", "w-full min-w-0")} style={{ overflowAnchor: "none" }}>
      <div data-tool-call-row data-tool-kind={resolvedKind} className="group flex w-full min-w-0 items-center gap-1">
        <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(activityRowClass, "min-w-0 flex-1", "rounded-sm focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {running ? (
            <RunStatus status={status} iconOnly decorative className="shrink-0 text-xs" />
          ) : null}
          <Icon className={cn("size-3 shrink-0 opacity-70", failed && "text-destructive")} />
          {failed ? <span className="shrink-0 text-destructive">{/cancel/i.test(status) ? "Canceled" : "Failed"}</span> : null}
          <span className={cn("truncate", deleteTool && "text-rose-400/80")}>{headline.title}{sourceLabel ? <span className="ml-1 text-[10px] uppercase tracking-wide opacity-50" title={sourceLabel}>{sourceLabel}</span> : null}</span>
          {searchResult ? <span className="shrink-0 text-[10px] text-muted-foreground">{workspaceSearchCount(searchResult)}</span> : null}
          {previewText ? (
            <span className="hidden truncate text-muted-foreground/45 sm:inline">· {previewText}</span>
          ) : null}
          {kind === "subagent" && subagent?.model ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">{subagent.model}</span>
          ) : null}
          {kind === "edit" && diffStats ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">
              +{diffStats.additions} -{diffStats.deletions}
            </span>
          ) : null}
        </button>
        </PopoverTrigger>
        {clickable ? (
          <button
            type="button"
            className={cn(activityActionClass, "text-muted-foreground/40 opacity-0 group-hover:opacity-100")}
            aria-label="Open file diff"
            title="Open file diff"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDiff?.();
            }}
          >
            <FilePenLine className="size-3" />
          </button>
        ) : null}
        {subagentClickable ? (
          <button
            type="button"
            className={cn(activityActionClass, "text-violet-300/80 opacity-100")}
            aria-label="Open subagent"
            title="Open subagent"
            onClick={(event) => {
              event.stopPropagation();
              onOpenSubagent?.();
            }}
          >
            <ExternalLink className="size-3" />
          </button>
        ) : null}
        {noteReferences.length === 1 ? <a href={noteReferences[0].noteLink}
          className={cn(activityActionClass, "text-muted-foreground/70")}
          aria-label={"Open note " + noteReferences[0].title} title={"Open " + noteReferences[0].title}
          onClick={event => {event.preventDefault();openNote(noteReferences[0].id);}}>
          <ExternalLink className="size-3" />
        </a> : null}
        {workspaceClickable ? (
          <button
            type="button"
            className={cn(activityActionClass, "text-muted-foreground/40 opacity-0 group-hover:opacity-100")}
            aria-label={`Open ${resolvedKind === "canvas" ? "canvas" : resolvedKind === "plan" ? "plan" : "browser"} in side panel`}
            title={`Open ${resolvedKind === "canvas" ? "canvas" : resolvedKind === "plan" ? "plan" : "browser"}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspace?.();
            }}
          >
            <ExternalLink className="size-3" />
          </button>
        ) : null}
        {onOpenRaw ? (
          <button
            type="button"
            className={cn(activityActionClass, "text-muted-foreground/40 opacity-0 group-hover:opacity-100")}
            aria-label="Show raw tool information"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRaw();
            }}
          >
            <Code2 className="size-3" />
          </button>
        ) : null}
      </div>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          aria-label={isCommand ? "Command details" : "Tool details"}
          className="max-h-[min(70dvh,36rem,var(--radix-popover-content-available-height,70dvh))] w-[min(42rem,calc(100vw-1.5rem))] overflow-y-auto p-3 text-xs leading-5 [&>*]:shrink-0"
        >
          <ToolCallPreview tool={{name:resolvedName,kind:resolvedKind,input,result,detail,status,todos:todoItems}} workspaces={workspaces}
            onOpenWorkspace={() => { setUserOpen(false); onOpenWorkspace?.(); }}
            onBuildPlan={(plan, options) => { setUserOpen(false); onBuildPlan?.(plan, options); }}
            onNavigate={() => setUserOpen(false)} buildDisabled={buildDisabled} />
          {noteReferences.length > 0 ? <section aria-label="Referenced notes" className="mb-3 space-y-1 border-b border-border pb-3">
            {noteReferences.map(note => <a key={note.id} href={note.noteLink}
              className="flex min-h-8 items-center gap-2 rounded px-1.5 text-foreground hover:bg-muted"
              onClick={event => {event.preventDefault();openNote(note.id);}}>
              <StickyNote className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{note.title}</span><ExternalLink className="size-3 shrink-0" />
            </a>)}
          </section> : null}
          {input ? (
            <section className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{isCommand ? "Command" : "Request"}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground">{formatToolOutput(input)}</pre>
            </section>
          ) : null}
          {kind === "edit" && diff && (diff.before !== undefined || diff.after !== undefined) ? (
            <section className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">File diff</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground/85">{compactFileDiff(diff.before, diff.after)}</pre>
            </section>
          ) : null}
          {result || detail ? (
            <section className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{isCommand ? "Output" : "Response"}</p>
              {searchResult ? <WorkspaceSearchResults result={searchResult}/> : <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground/85">{formatToolOutput(result || detail)}</pre>}
            </section>
          ) : null}
          {outputStatus}
          {!input && !(kind === "edit" && diff) && !result && !detail ? <p className="text-muted-foreground">No output available yet.</p> : null}
        </PopoverContent>
      </div>
    </Popover>
  );
});



export type ActivityThinking = {
  text: string;
  done?: boolean;
  durationMs?: number;
};

export type ActivityEntry =
  | { type: "thinking"; thinking: ActivityThinking }
  | { type: "tool"; tool: ToolCallData };

export const ToolCallGroup = memo(function ToolCallGroup({
  tools = [],
  thinking = [],
  activity,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  autoExpand = false,
  live = false,
  hostnames,
  workspaces,
  messageId,
  toolBirths,
}: {
  tools: ToolCallData[];
  thinking?: ActivityThinking[];
  activity?: ActivityEntry[];
  onOpenDiff?: (tool: ToolCallData) => void;
  onOpenSubagent?: (tool: ToolCallData) => void;
  onOpenWorkspace?: (tool: ToolCallData, workspaceId?: string) => void;
  onBuildPlan?: (tool: ToolCallData, plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: (tool: ToolCallData) => void;
  autoExpand?: boolean;
  live?: boolean;
  messageId?: string;
  toolBirths?: ReadonlyMap<string, number>;
  hostnames?: Record<string, string>;
  workspaces?: Array<{ id: string; type?: string; name?: string; content?: string }>;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const entriesId = useId();
  const toolBornAt = (tool: ToolCallData) => messageId ? toolBirths?.get(toolMotionKey(messageId, tool.id)) : undefined;
  const entries = useMemo(() => tools.map(tool => ({ ...tool, ...enrichToolDisplay(tool) })), [tools]);
  const thinkingFromActivity = (activity || [])
 .filter((entry): entry is Extract<ActivityEntry, { type: "thinking" }> => entry.type === "thinking")
 .map((entry) => entry.thinking);
 const thinkingList = [...thinking, ...thinkingFromActivity];
 const combinedThinking = thinkingList.length
 ? {
 text: thinkingList.map((item) => item.text).filter(Boolean).join("\n\n"),
 done: thinkingList.every((item) => item.done !== false),
 durationMs: thinkingList.reduce((sum, item) => sum + (item.durationMs || 0), 0) || thinkingList.at(-1)?.durationMs,
 }
 : undefined;
 const preparingTool = latestPreparingTool(entries);
 const groupTitle = activityGroupLabel(entries, combinedThinking);
  const groupOpen = userOpen ?? Boolean(live || autoExpand);
  const openWorkspace = (tool: ToolCallData) => {
    void resolveWorkspaceToolOpen(tool)
      .then(open => onOpenWorkspace?.(open.tool, open.workspaceId))
      .catch(() => toast.error("Could not load workspace details"));
  };
  const buildToolPlan = (tool: ToolCallData, plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => {
    const url = tool.inputUrl || tool.resultUrl;
    if (!url) { onBuildPlan?.(tool, plan, options); return; }
    void loadToolPayload(url).then(payload => onBuildPlan?.({ ...tool, ...payload },
      planFromToolPayload(payload.input, payload.result, tool.detail) || plan, options))
      .catch(() => toast.error("Could not load full plan"));
  };
  const renderTool = (tool: ToolCallData, nested = false) => (
    <ToolCallChip
      {...tool}
      hostnames={hostnames}
      workspaces={workspaces}
      nested={nested}
      onOpenDiff={() => {
        const url=tool.inputUrl || tool.resultUrl;
        if(!url){onOpenDiff?.(tool);return;}
        void loadToolPayload(url).then(payload=>onOpenDiff?.({...tool,...payload})).catch(()=>toast.error("Could not load file details"));
      }}
      onOpenSubagent={() => onOpenSubagent?.(tool)}
      onOpenWorkspace={() => openWorkspace(tool)}
      onBuildPlan={(plan, options) => buildToolPlan(tool, plan, options)}
      buildDisabled={buildDisabled}
      onOpenRaw={() => {
        const url = tool.inputUrl || tool.resultUrl;
        if (!url) { onOpenRaw?.(tool); return; }
        void loadToolPayload(url).then(payload => onOpenRaw?.({ ...tool, ...payload, inputUrl: undefined, resultUrl: undefined }))
          .catch(() => toast.error("Could not load full tool details"));
      }}
    />
  );
  if (!entries.length && !combinedThinking) return null;
  const activityRunning = entries.some(tool => isToolRunning(tool.status) && tool.result === undefined);
  return (
  <div className="w-full min-w-0" style={{ overflowAnchor: "none" }}>
 <div className="my-0.5 flex w-full flex-col" data-tool-call-group>
 <ActivityDisclosureTrigger
   expanded={groupOpen}
   controls={entriesId}
   onClick={() => setUserOpen((open) => open === null ? !groupOpen : !open)}
   leading={activityRunning || combinedThinking?.done === false
     ? <RunStatus status="running" iconOnly decorative className="shrink-0 text-xs" />
     : undefined}
 >
   {preparingTool ? <ToolPreparationDetails name={preparingTool.name} kind={preparingTool.kind} source={preparingTool.source} characters={!groupOpen ? preparingTool.inputChars : undefined}/> : <span className="truncate">{groupTitle}</span>}
 </ActivityDisclosureTrigger>
 <div key="entries" id={entriesId} className="flex flex-col">
 {groupOpen && (combinedThinking?.text || combinedThinking?.done === false) ? (
 <div className="mt-1 pl-4">
 <ThinkingBlock
 key="thinking"
 text={combinedThinking.text || "…"}
 done={combinedThinking.done !== false}
 durationMs={combinedThinking.durationMs}
 embedded
 />
 </div>
 ) : null}
 {entries.map((tool, index) => (
 <ArrivalFade key={toolReactKey(tool, index)} bornAt={toolBornAt(tool)}>
   {groupOpen ? <div className="mt-1 pl-4">{renderTool(tool, true)}</div> : null}
   <ToolCallPreview inline tool={tool} workspaces={workspaces}
     onOpenWorkspace={() => openWorkspace(tool)}
     onBuildPlan={(plan, options) => buildToolPlan(tool, plan, options)}
     buildDisabled={buildDisabled} />
 </ArrivalFade>
 ))}
 </div>
 </div>
 </div>
 );

});
