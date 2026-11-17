"use client";
import {AutomationIcon} from "@/components/automation-icon";
import {NoteIconPicker} from "@/components/notes/note-icon-picker";

import { AutomationSplitView } from "@/components/automation-editor-surface";
import { RunStatus } from "@/components/run-status";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  CalendarClock,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FolderKanban,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModelOptionsMenu } from "@/components/model-options-menu";
import { ModelPicker } from "@/components/model-picker";
import type { ModelInfo } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import type { AgentMode } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  defaultParamsForModel,
  modelParametersForModel,
  type ModelParamSelection,
} from "@/lib/model-params";
import { modelAttrSummary } from "@/lib/model-label";
import { modelForSelection } from "@/lib/model-selection";

type AutomationRun = {
  id: string;
  jobId?: string;
  chatId: string;
  trigger?: "scheduled" | "manual";
  status: "queued" | "running" | "completed" | "error" | "cancelled" | string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  resultPreview?: string;
  error?: string;
  manual?: boolean;
};

type Automation = {
  id: string;
  icon?:string|null;
  chatId: string;
  chatTitle?: string;
  projectId?: string;
  name: string;
  prompt: string;
  creator?: "user" | "agent";
  modeId?: string;
  modelId?: string;
  extendedModelId?: string;
  modelParams?: ModelParamSelection[];
  extendedModelParams?: ModelParamSelection[];
  maxRunMinutes?: number;
  schedule:
    | { kind: "once"; at: string }
    | { kind: "interval"; everyMinutes: number }
    | { kind: "days"; everyDays: number }
    | { kind: "monthly"; dayOfMonth: number };
  timezone: string;
  status: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  createdAt?: string;
  runs?: AutomationRun[];
};

type Project = { id: string; name: string; mode?: "chat" | "agents" };
type ContextChat = { id: string; title: string };
type TargetAgent = { id: string; chatId: string; name: string; role: string };
const EDITOR_STEPS = ["Task", "Destination", "Execution", "Review"] as const;

type AutomationsPanelProps = {
  onOpenChat: (chatId: string) => void;
  modes: AgentMode[];
  models?: ModelInfo[];
  favoriteModelKeys?: string[];
  onToggleFavoriteModel?: (modelKey: string) => void;
  highlightId?: string | null;
};

type ScheduleKind = Automation["schedule"]["kind"];

type EditDraft = {
  name: string;
  icon:string|null;
  prompt: string;
  scheduleKind: ScheduleKind;
  onceAt: string;
  everyMinutes: string;
  everyDays: string;
  dayOfMonth: string;
  modeId: string;
  modelId: string;
  extendedModelId: string;
  modelParams: ModelParamSelection[];
  extendedModelParams: ModelParamSelection[];
  maxRunMinutes: string;
  timezone: string;
  projectId: string;
  chatId: string;
};

const SELECTED_AUTOMATION_KEY = "metis:automations:selected";

function formatDate(value?: string, timezone?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Never";
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: timezone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

function formatTime(value?: string, timezone?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
}

function formatRelative(value: string | undefined, now: number) {
  if (!value) return "not scheduled";
  const target = Date.parse(value);
  if (!Number.isFinite(target)) return "not scheduled";
  const delta = target - now;
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "long" });
  if (absolute < 60_000) return delta >= 0 ? "in less than a minute" : "less than a minute ago";
  if (absolute < 3_600_000) return formatter.format(Math.round(delta / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), "hour");
  if (absolute < 2_592_000_000) return formatter.format(Math.round(delta / 86_400_000), "day");
  return formatter.format(Math.round(delta / 2_592_000_000), "month");
}

function formatDuration(start?: string, end?: string, now = Date.now()) {
  if (!start) return "";
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "";
  const seconds = Math.max(1, Math.round((to - from) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatRunLimit(minutes = 1_440) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440 * 24}h`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatSchedule(automation: Automation) {
  const time = formatTime(automation.nextRunAt, automation.timezone);
  if (automation.schedule.kind === "once") return `Once · ${formatDate(automation.schedule.at, automation.timezone)}`;
  if (automation.schedule.kind === "days") {
    const cadence = automation.schedule.everyDays === 1 ? "Every day" : `Every ${automation.schedule.everyDays} days`;
    return time ? `${cadence} · ${time}` : cadence;
  }
  if (automation.schedule.kind === "monthly") {
    const cadence = `Monthly day ${automation.schedule.dayOfMonth}`;
    return time ? `${cadence} · ${time}` : cadence;
  }
  const minutes = automation.schedule.everyMinutes;
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440;
    const cadence = days === 1 ? "Every day" : `Every ${days} days`;
    return time ? `${cadence} · ${time}` : cadence;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `Every ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `Every ${minutes} minutes`;
}

function nextHint(automation: Automation, now: number) {
  if (automation.status === "paused") return "resume to schedule";
  return formatRelative(automation.nextRunAt, now);
}

function statusLabel(status: string) {
  return status.toLocaleLowerCase();
}

function toDatetimeLocal(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function modelLabel(id: string | undefined, models: ModelInfo[]) {
  if (!id) return "Not set";
  return modelForSelection(models, id)?.displayName || id;
}

function toModelOption(model: ModelInfo): ModelInfo {
  return model;
}

function paramsForSelectedModel(model: ModelInfo | undefined, stored?: ModelParamSelection[]) {
  if (!model) return stored || [];
  const defaults = defaultParamsForModel(model);
  if (!stored?.length) return defaults;
  const allowed = new Set(modelParametersForModel(model).map((param) => param.id));
  const next = stored.filter((param) => allowed.has(param.id));
  return next.length ? next : defaults;
}

function draftFromAutomation(automation: Automation, fallbackModeId: string, models: ModelInfo[] = []): EditDraft {
  const scheduleKind = automation.schedule.kind;
  const selectedModel = modelForSelection(models, automation.modelId);
  const selectedExtendedModel = modelForSelection(models, automation.extendedModelId);
  return {
    name: automation.name,
    icon:automation.icon??null,
    prompt: automation.prompt,
    scheduleKind,
    onceAt: scheduleKind === "once" ? toDatetimeLocal(automation.schedule.at) : "",
    everyMinutes: scheduleKind === "interval" ? String(automation.schedule.everyMinutes) : "60",
    everyDays: scheduleKind === "days" ? String(automation.schedule.everyDays) : "1",
    dayOfMonth: scheduleKind === "monthly" ? String(automation.schedule.dayOfMonth) : "1",
    modeId: automation.modeId || fallbackModeId,
    modelId: automation.modelId || "",
    extendedModelId: automation.extendedModelId || "",
    modelParams: paramsForSelectedModel(selectedModel, automation.modelParams),
    extendedModelParams: paramsForSelectedModel(selectedExtendedModel, automation.extendedModelParams),
    maxRunMinutes: String(automation.maxRunMinutes || 1_440),
    timezone: automation.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    projectId: automation.projectId || "",
    chatId: automation.chatId,
  };
}

function scheduleFromDraft(draft: EditDraft): Automation["schedule"] {
  if (draft.scheduleKind === "once") return { kind: "once", at: new Date(draft.onceAt).toISOString() };
  if (draft.scheduleKind === "days") return { kind: "days", everyDays: Number(draft.everyDays) };
  if (draft.scheduleKind === "monthly") return { kind: "monthly", dayOfMonth: Number(draft.dayOfMonth) };
  return { kind: "interval", everyMinutes: Number(draft.everyMinutes) };
}

function newAutomationDraft(fallbackModeId: string): EditDraft {
  return {
    name: "",
    icon:null,
    prompt: "",
    scheduleKind: "interval",
    onceAt: toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1_000).toISOString()),
    everyMinutes: "60",
    everyDays: "1",
    dayOfMonth: "1",
    modeId: fallbackModeId,
    modelId: "",
    extendedModelId: "",
    modelParams: [],
    extendedModelParams: [],
    maxRunMinutes: "1440",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    projectId: "",
    chatId: "",
  };
}

type AutomationListRowProps = {
  automation: Automation;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
};

const AutomationListRow = memo(function AutomationListRow({
  automation,
  selected,
  now,
  onSelect,
  onEdit,
  onDelete,
}: AutomationListRowProps) {
  const Icon = automation.creator === "agent" ? Bot : CalendarClock;
  return (
    <div id={`automation-${automation.id}`} className={cn("automation-list-row", selected && "is-active")}>
      <button
        type="button"
        className="automation-list-select"
        aria-pressed={selected}
        onClick={() => onSelect(automation.id)}
      >
        <span className="automation-list-icon">{automation.icon?<AutomationIcon value={automation.icon}/>:<Icon aria-hidden="true" />}</span>
        <span className="automation-list-copy">
          <span className="automation-list-title-line">
            <span className="automation-list-title">{automation.name}</span>
            <span className="automation-status" data-status={automation.status}>{statusLabel(automation.status)}</span>
          </span>
          <span className="automation-list-prompt">{automation.prompt}</span>
          <span className="automation-list-meta">
            <span className="automation-list-schedule"><Clock3 aria-hidden="true" />{formatSchedule(automation)}</span>
            <span className="automation-list-next">{nextHint(automation, now)}</span>
          </span>
        </span>
      </button>
      <span className="automation-list-row-actions">
        <button type="button" title="Edit" aria-label={`Edit ${automation.name}`} onClick={() => onEdit(automation)}>
          <Pencil aria-hidden="true" />
        </button>
        <button type="button" className="is-danger" title="Delete" aria-label={`Delete ${automation.name}`} onClick={() => onDelete(automation)}>
          <Trash2 aria-hidden="true" />
        </button>
      </span>
    </div>
  );
});

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="automation-stat-card">
      <span className="automation-stat-label">{label}</span>
      <span className="automation-stat-value" title={value}>{value}</span>
      {detail ? <span className="automation-stat-detail">{detail}</span> : null}
    </div>
  );
}

export function AutomationsPanel({
  onOpenChat,
  modes,
  models = [],
  favoriteModelKeys = [],
  onToggleFavoriteModel,
  highlightId,
}: AutomationsPanelProps) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [projectsRetry, setProjectsRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailAutomation, setDetailAutomation] = useState<Automation | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pendingAction, setPendingAction] = useState<"run" | "pause" | "resume" | "save" | "delete" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editorStep, setEditorStep] = useState(0);
  const [targetChats, setTargetChats] = useState<ContextChat[]>([]);
  const [targetAgents, setTargetAgents] = useState<TargetAgent[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [targetRetry, setTargetRetry] = useState(0);
  const [editorError, setEditorError] = useState("");
  const editorFormRef = useRef<HTMLFormElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>(models);
  const selectedIdRef = useRef<string | null>(null);
  const handledHighlightRef = useRef<string | null>(null);
  const lastExtendedModelRef = useRef<{ id: string; params: ModelParamSelection[] }>({ id: "", params: [] });

  const targetProject = projects.find((project) => project.id === draft?.projectId);
  const isAgentProject = targetProject?.mode === "agents";
  const selectedProjectId = draft?.projectId;

  useEffect(() => {
    if (!editing || selectedProjectId === undefined) return;
    const controller = new AbortController();
    setTargetLoading(true);
    setTargetError("");
    setTargetChats([]);
    setTargetAgents([]);
    void fetch(`/api/automations/targets?projectId=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { chats?: ContextChat[]; agents?: TargetAgent[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load destinations");
        if (controller.signal.aborted) return;
        setTargetChats(data.chats || []);
        setTargetAgents(data.agents || []);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setTargetError(error instanceof Error ? error.message : "Could not load destinations");
      })
      .finally(() => { if (!controller.signal.aborted) setTargetLoading(false); });
    return () => controller.abort();
  }, [editing, selectedProjectId, targetRetry]);

  useEffect(() => {
    if (!creating) return;
    editorFormRef.current?.querySelector<HTMLElement>(`fieldset[data-step="${editorStep}"] legend`)?.focus();
  }, [creating, editorStep]);

  function destinationError() {
    if (targetLoading || projectsLoading) return "Wait for destinations to finish loading.";
    if (projectsError) return "Reload projects before continuing.";
    if (targetError) return "Reload destinations before continuing.";
    if (isAgentProject && !targetAgents.some((agent) => agent.chatId === draft?.chatId)) return "Select an agent for this project.";
    if (!isAgentProject && draft?.chatId && !targetChats.some((chat) => chat.id === draft.chatId)) return "Select an available chat in this project.";
    return "";
  }

  const loadAutomations = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/automations", { cache: "no-store" });
      const data = (await response.json()) as { automations?: Automation[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load automations");
      setAutomations(data.automations || []);
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load automations";
      if (!silent) setLoadError(message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    try {
      const response = await fetch(`/api/automations/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json()) as { automation?: Automation; error?: string };
      if (!response.ok || !data.automation) throw new Error(data.error || "Could not load automation");
      if (selectedIdRef.current === id) setDetailAutomation(data.automation);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Could not load automation");
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) window.sessionStorage.setItem(SELECTED_AUTOMATION_KEY, selectedId);
  }, [selectedId]);

  useEffect(() => {
    setModelOptions((current) => {
      if (!models.length) return current;
      const seen = new Set(models.map((model) => model.id));
      return [...models, ...current.filter((model) => !seen.has(model.id))];
    });
  }, [models]);

  useEffect(() => {
    if (models.length) return;
    void fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { models?: ModelInfo[] };
        if (!response.ok || !Array.isArray(data.models)) return;
        setModelOptions(data.models.map(toModelOption));
      })
      .catch(() => undefined);
  }, [models.length]);

  useEffect(() => {
    const controller = new AbortController();
    setProjectsLoading(true);
    setProjectsError("");
    void fetch("/api/projects", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { projects?: Project[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load projects");
        if (!controller.signal.aborted) setProjects(data.projects || []);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setProjectsError(error instanceof Error ? error.message : "Could not load projects"); })
      .finally(() => { if (!controller.signal.aborted) setProjectsLoading(false); });
    return () => controller.abort();
  }, [projectsRetry]);

  useEffect(() => {
    void loadAutomations();
    const refreshTimer = window.setInterval(() => {
      void loadAutomations(true);
      if (selectedIdRef.current) void loadDetail(selectedIdRef.current, true);
    }, 5_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadAutomations, loadDetail]);

  useEffect(() => {
    if (creating) return;
    if (!automations.length) {
      if (!loading) {
        setSelectedId(null);
        setDetailAutomation(null);
        setEditing(false);
        setDraft(null);
      }
      return;
    }
    setSelectedId((current) => {
      if (current && automations.some((automation) => automation.id === current)) return current;
      const stored = window.sessionStorage.getItem(SELECTED_AUTOMATION_KEY);
      if (stored && automations.some((automation) => automation.id === stored)) return stored;
      return automations[0].id;
    });
  }, [automations, creating, loading]);

  useEffect(() => {
    if (!highlightId || handledHighlightRef.current === highlightId) return;
    if (!automations.some((automation) => automation.id === highlightId)) return;
    handledHighlightRef.current = highlightId;
    setCreating(false);
    setEditing(false);
    setDraft(null);
    setSelectedId(highlightId);
    window.requestAnimationFrame(() => {
      document.getElementById(`automation-${highlightId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [automations, highlightId]);

  useEffect(() => {
    if (!selectedId) return;
    setDetailAutomation((current) => current?.id === selectedId ? current : null);
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const latestCompleted = useMemo(
    () => automations.flatMap((automation) => (automation.runs || []).map((run) => ({ automation, run })))
      .filter(({ run }) => run.status === "completed")
      .sort((a, b) => Date.parse(b.run.completedAt || b.run.createdAt) - Date.parse(a.run.completedAt || a.run.createdAt))[0],
    [automations],
  );

  useEffect(() => {
    if (!latestCompleted?.run.completedAt) return;
    const key = `automation-notified:${latestCompleted.run.id}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    toast.success(`Automation completed: ${latestCompleted.automation.name}`, {
      description: "The run transcript is ready in Automations.",
    });
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Automation completed: ${latestCompleted.automation.name}`, {
        body: "Open Automations to inspect the complete run chat.",
      });
    }
  }, [latestCompleted]);

  const selectAutomation = useCallback((id: string) => {
    setCreating(false);
    setEditing(false);
    setDraft(null);
    setSelectedId(id);
  }, []);

  const selectedSummary = useMemo(
    () => automations.find((automation) => automation.id === selectedId) || null,
    [automations, selectedId],
  );
  const fallbackModeId = modes[0]?.id || "agent";
  const creatingDetail: Automation | null = creating
    ? {
        id: "__new__",
        chatId: "",
        name: "New automation",
        prompt: "",
        creator: "user",
        modeId: fallbackModeId,
        maxRunMinutes: 1_440,
        schedule: { kind: "interval", everyMinutes: 60 },
        timezone: draft?.timezone || "UTC",
        status: "draft",
        runs: [],
      }
    : null;
  const currentDetail = creatingDetail || (detailAutomation?.id === selectedId ? detailAutomation : selectedSummary);
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  const beginCreate = useCallback(() => {
    setSelectedId(null);
    setDetailAutomation(null);
    setDraft(newAutomationDraft(fallbackModeId));
    setEditorStep(0);
    setTargetRetry((value) => value + 1);
    setEditorError("");
    setCreating(true);
    setEditing(true);
  }, [fallbackModeId]);

  const beginEdit = useCallback((automation: Automation) => {
    setCreating(false);
    setSelectedId(automation.id);
    setDraft(draftFromAutomation(automation, fallbackModeId, modelOptions));
    setEditorError("");
    setEditing(true);
    if (!modelOptions.length) {
      void fetch("/api/models", { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as { models?: ModelInfo[] };
          if (response.ok && Array.isArray(data.models)) {
            setModelOptions(data.models.map(toModelOption));
          }
        })
        .catch(() => undefined);
    }
  }, [fallbackModeId, modelOptions]);

  async function mutate(automation: Automation, action: "run" | "pause" | "resume") {
    setPendingAction(action);
    try {
      const response = await fetch(`/api/automations/${encodeURIComponent(automation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Automation action failed");
      await Promise.all([loadAutomations(true), loadDetail(automation.id, true)]);
      toast.success(action === "run" ? `Running “${automation.name}”` : action === "pause" ? "Automation paused" : "Automation resumed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Automation action failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveAutomation(event: FormEvent) {
    event.preventDefault();
    if (!draft || (!creating && !currentDetail)) return;
    if (creating && editorStep < EDITOR_STEPS.length - 1) {
      const error = editorStep === 1 ? destinationError() : "";
      if (error) { setEditorError(error); return; }
      setEditorError("");
      setEditorStep((step) => step + 1);
      return;
    }
    const error = destinationError();
    if (error) { setEditorError(error); if (creating) setEditorStep(1); return; }
    if (!draft.name.trim() || !draft.prompt.trim()) { setEditorError("Name and prompt are required."); if (creating) setEditorStep(0); return; }
    setEditorError("");
    setPendingAction("save");
    try {
      const automationId = creating ? null : currentDetail!.id;
      const response = await fetch(
        creating ? "/api/automations" : `/api/automations/${encodeURIComponent(automationId!)}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            icon:draft.icon,
            prompt: draft.prompt.trim(),
            modeId: draft.modeId,
            modelId: draft.modelId,
            extendedModelId: draft.extendedModelId,
            modelParams: draft.modelParams,
            extendedModelParams: draft.extendedModelParams,
            maxRunMinutes: Number(draft.maxRunMinutes),
            timezone: draft.timezone.trim(),
            projectId: draft.projectId || null,
            chatId: draft.chatId,
            schedule: scheduleFromDraft(draft),
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string; automation?: Automation };
      if (!response.ok || !data.automation) {
        throw new Error(data.error || (creating ? "Could not create automation" : "Could not save automation"));
      }
      setCreating(false);
      setEditing(false);
      setDraft(null);
      setDetailAutomation(data.automation);
      selectedIdRef.current = data.automation.id;
      setSelectedId(data.automation.id);
      await loadAutomations(true);
      if (!creating && automationId) await loadDetail(automationId, true);
      toast.success(creating ? "Automation created" : "Automation updated");
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Could not save automation");
      toast.error(error instanceof Error ? error.message : creating ? "Could not create automation" : "Could not save automation");
    } finally {
      setPendingAction(null);
    }
  }

  function cancelDraft() {
    const wasCreating = creating;
    setCreating(false);
    setEditing(false);
    setDraft(null);
    if (wasCreating) setSelectedId(automations[0]?.id || null);
  }

  async function removeAutomation(automation: Automation) {
    setPendingAction("delete");
    try {
      const response = await fetch(`/api/automations/${encodeURIComponent(automation.id)}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not delete automation");
      if (selectedIdRef.current === automation.id) {
        setSelectedId(null);
        setDetailAutomation(null);
      }
      setEditing(false);
      setDraft(null);
      await loadAutomations(true);
      toast.success(`Deleted “${automation.name}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete automation");
    } finally {
      setPendingAction(null);
    }
  }

  const selectedRuns = currentDetail?.runs || [];
  const latestRun = selectedRuns[0];
  const lastRunAt = currentDetail?.lastRunAt || latestRun?.completedAt || latestRun?.startedAt || latestRun?.createdAt;
  const lastStatus = latestRun?.status || (currentDetail?.lastError ? "error" : "No runs yet");
  const modeName = modes.find((mode) => mode.id === currentDetail?.modeId)?.name || currentDetail?.modeId || "Agent";
  const projectName = currentDetail?.projectId ? projectNameById.get(currentDetail.projectId) || "Project" : "No project";
  const contextChatTitle = currentDetail?.chatTitle || "Context chat";
  const hasActiveRun = selectedRuns.some((run) => run.status === "running" || run.status === "queued");
  const currentModelName = modelLabel(currentDetail?.modelId, modelOptions);
  const extendedModelName = currentDetail?.extendedModelId ? modelLabel(currentDetail.extendedModelId, modelOptions) : "";
  const currentModel = modelForSelection(modelOptions, currentDetail?.modelId);
  const currentModelOptionsLabel = currentModel
    ? modelAttrSummary(currentModel, currentDetail?.modelParams || [])
    : "";
  const currentExtendedModel = modelForSelection(modelOptions, currentDetail?.extendedModelId);
  const extendedModelOptionsLabel = currentExtendedModel
    ? modelAttrSummary(currentExtendedModel, currentDetail?.extendedModelParams || [])
    : "";

  return (
    <AutomationSplitView creating={creating}>
      <aside className="automation-list-pane automation-scroll" aria-label="Automations">
        <header className="automation-list-header">
          <div className="automation-list-title-row">
            <button
              type="button"
              className="automation-create-button"
              aria-label="Create automation"
              title="Create automation"
              disabled={pendingAction !== null}
              onClick={beginCreate}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="automation-inline-state is-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadAutomations()}>Retry</button>
          </div>
        ) : null}

        {loading ? (
          <div className="automation-list-loading" aria-label="Loading automations">
            <span /><span /><span />
          </div>
        ) : null}

        {!loading && !loadError && automations.length === 0 ? (
          <div className="automation-inline-state">
            <strong>No automations yet</strong>
            <span>Use + to create one here, or ask Metis in a chat.</span>
          </div>
        ) : null}

        <div className="automation-list-items">
          {automations.map((automation) => (
            <AutomationListRow
              key={automation.id}
              automation={automation}
              selected={automation.id === selectedId}
              now={now}
              onSelect={selectAutomation}
              onEdit={beginEdit}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      </aside>

      <section className="automation-detail-pane automation-scroll" aria-label="Automation details">
        {!currentDetail && loading ? (
          <div className="automation-detail-loading" aria-label="Loading automation details">
            <span className="automation-detail-loading-title" />
            <span /><span /><span /><span />
          </div>
        ) : null}

        {!currentDetail && !loading ? (
          <div className="automation-detail-empty">
            <CalendarClock aria-hidden="true" />
            <strong>No automation selected</strong>
            <span>Automations appear here with their schedule and run history.</span>
          </div>
        ) : null}

        {currentDetail ? (
          <div key={currentDetail.id} className={`automation-detail-content${creating ? " automation-editor-creating" : ""}`}>
            <header className="automation-detail-header">
              <span className="automation-detail-icon">
                {currentDetail.icon?<AutomationIcon value={currentDetail.icon}/>:creating ? <Plus aria-hidden="true" /> : currentDetail.creator === "agent" ? <Bot aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
              </span>
              <span className="automation-detail-heading">
                <span className="automation-detail-title-line">
                  <h3>{currentDetail.name}</h3>
                  <span className="automation-status" data-status={currentDetail.status}>{statusLabel(currentDetail.status)}</span>
                </span>
                <span>
                  {creating
                    ? `Step ${editorStep + 1} of ${EDITOR_STEPS.length} · ${EDITOR_STEPS[editorStep]}`
                    : `Created by ${currentDetail.creator === "agent" ? "Agent" : "You"} · max run ${formatRunLimit(currentDetail.maxRunMinutes)}`}
                </span>
              </span>
            </header>

            {!creating ? (
              <div className="automation-stats-grid">
                <StatCard label="Schedule" value={formatSchedule(currentDetail)} />
                <StatCard
                  label="Next run"
                  value={currentDetail.status === "paused" ? "Paused" : formatDate(currentDetail.nextRunAt, currentDetail.timezone)}
                  detail={nextHint(currentDetail, now)}
                />
                <StatCard label="Last run" value={formatDate(lastRunAt, currentDetail.timezone)} detail={lastStatus} />
                <StatCard label="Timezone" value={currentDetail.timezone || "UTC"} />
              </div>
            ) : null}

            {editing && draft ? (
              <form ref={editorFormRef} className="automation-edit-form" onSubmit={(event) => void saveAutomation(event)}>
                {creating ? <nav className="automation-editor-steps" aria-label="Creation steps">
                  {EDITOR_STEPS.map((label, index) => <button key={label} type="button" aria-current={editorStep === index ? "step" : undefined} disabled={index > editorStep} onClick={() => { setEditorError(""); setEditorStep(index); }}><span>{index + 1}</span>{label}</button>)}
                </nav> : null}
                <fieldset data-step="0" hidden={creating && editorStep !== 0} disabled={creating && editorStep !== 0}>
                <legend tabIndex={-1}>What should happen?</legend>
                <div className="flex items-center gap-2 text-sm"><span>Icon</span><NoteIconPicker label="Automation" value={draft.icon} disabled={pendingAction==="save"} fallback={<CalendarClock className="size-6" aria-hidden="true"/>} onChange={icon=>setDraft({...draft,icon})}/></div>
                <label>
                  Name
                  <input name="name" maxLength={200} autoComplete="off" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
                </label>
                <label>
                  Prompt
                  <textarea name="prompt" placeholder="Describe the task and the result you expect…" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} required />
                </label>
                </fieldset>
                <fieldset data-step="1" hidden={creating && editorStep !== 1} disabled={creating && editorStep !== 1}>
                  <legend tabIndex={-1}>Where should it run?</legend>
                  <label>Project
                    <select name="projectId" disabled={projectsLoading || Boolean(projectsError)} value={draft.projectId} onChange={(event) => { setDraft({ ...draft, projectId: event.target.value, chatId: "" }); setEditorError(""); }}>
                      <option value="">No project</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.mode === "agents" ? " · Agents" : ""}</option>)}
                    </select>
                  </label>
                  {projectsError ? <div className="automation-editor-error" role="alert">{projectsError}<button type="button" onClick={() => setProjectsRetry((value) => value + 1)}>Retry projects</button></div> : null}
                  {targetLoading || projectsLoading ? <p className="automation-editor-hint" role="status"><Loader2 className="animate-spin" aria-hidden="true" />Loading destinations…</p>
                    : targetError ? <div className="automation-editor-error" role="alert">{targetError}<button type="button" onClick={() => setTargetRetry((value) => value + 1)}>Retry</button></div>
                    : isAgentProject ? <>
                      <label>Agent <span className="sr-only">(required)</span>
                        <select name="chatId" value={draft.chatId} onChange={(event) => { setDraft({ ...draft, chatId: event.target.value }); setEditorError(""); }} required>
                          <option value="">Select an agent</option>
                          {targetAgents.map((agent) => <option key={agent.id} value={agent.chatId}>{agent.name} · {agent.role}</option>)}
                        </select>
                      </label>
                      <p className="automation-editor-hint">{targetAgents.length ? "Runs in this agent’s chat, using its role and project team." : "This project has no active agents. Create an agent in the project first."}</p>
                    </> : <>
                      <label>Context chat
                        <select name="chatId" value={draft.chatId} onChange={(event) => setDraft({ ...draft, chatId: event.target.value })}>
                          <option value="">New automation chat</option>
                          {targetChats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || "Untitled chat"}</option>)}
                        </select>
                      </label>
                      <p className="automation-editor-hint">{draft.chatId ? "Uses this conversation as context. Each run keeps its own transcript." : "Creates a dedicated context chat. Each run keeps its own transcript."}{targetChats.length === 0 ? " No existing chats in this scope." : ""}</p>
                    </>}
                </fieldset>
                <fieldset data-step="2" hidden={creating && editorStep !== 2} disabled={creating && editorStep !== 2}>
                  <legend tabIndex={-1}>When and how?</legend>
                <div className="automation-edit-row">
                  <label>
                    Schedule
                    <select
                      value={draft.scheduleKind}
                      onChange={(event) => setDraft({ ...draft, scheduleKind: event.target.value as ScheduleKind })}
                    >
                      <option value="interval">Every X minutes</option>
                      <option value="days">Every X days</option>
                      <option value="monthly">Monthly day</option>
                      <option value="once">One-time</option>
                    </select>
                  </label>
                  {draft.scheduleKind === "once" ? (
                    <label>
                      Run at
                      <input type="datetime-local" value={draft.onceAt} onChange={(event) => setDraft({ ...draft, onceAt: event.target.value })} required />
                    </label>
                  ) : draft.scheduleKind === "days" ? (
                    <label>
                      Days
                      <input type="number" min={1} step={1} value={draft.everyDays} onChange={(event) => setDraft({ ...draft, everyDays: event.target.value })} required />
                    </label>
                  ) : draft.scheduleKind === "monthly" ? (
                    <label>
                      Day of month
                      <input type="number" min={1} max={31} step={1} value={draft.dayOfMonth} onChange={(event) => setDraft({ ...draft, dayOfMonth: event.target.value })} required />
                    </label>
                  ) : (
                    <label>
                      Minutes
                      <input type="number" min={60} step={1} value={draft.everyMinutes} onChange={(event) => setDraft({ ...draft, everyMinutes: event.target.value })} required />
                    </label>
                  )}
                </div>
                <div className="automation-edit-row">
                  <label>
                    Mode
                    <select value={draft.modeId} onChange={(event) => setDraft({ ...draft, modeId: event.target.value })}>
                      {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Max run (minutes)
                    <input type="number" min={5} max={10_080} step={1} value={draft.maxRunMinutes} onChange={(event) => setDraft({ ...draft, maxRunMinutes: event.target.value })} required />
                  </label>
                </div>
                <div className="automation-model-picker" data-slot="automation-model-options">
                  <span>Model</span>
                  <div className="flex min-w-0 items-center gap-1">
                    <ModelPicker
                      models={modelOptions}
                      value={draft.modelId}
                      onValueChange={(modelId) => {
                        const nextModel = modelForSelection(modelOptions, modelId);
                        setDraft({ ...draft, modelId, modelParams: paramsForSelectedModel(nextModel) });
                      }}
                      favoriteModelKeys={favoriteModelKeys}
                      onToggleFavorite={onToggleFavoriteModel || (() => undefined)}
                      noneLabel="Not set"
                      placeholder="Not set"
                      ariaLabel="Model"
                      className="min-w-0 flex-1"
                    />
                    {modelForSelection(modelOptions, draft.modelId) ? (
                      <ModelOptionsMenu
                        model={modelForSelection(modelOptions, draft.modelId)!}
                        modelParams={draft.modelParams}
                        onModelParamsChange={(modelParams) => setDraft({ ...draft, modelParams })}
                        className="opacity-100"
                      />
                    ) : null}
                  </div>
                </div>
                <details className="automation-subagent-model" open={!creating || Boolean(draft.extendedModelId)}>
                  <summary>Subagent model <span>Optional</span></summary>
                  <div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Optionally use one model for delegated subagents. When disabled, the automation uses the standard subagent model from Settings.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">Use a standard model</p>
                    <Button
                      type="button"
                      variant={draft.extendedModelId ? "default" : "outline"}
                      aria-pressed={Boolean(draft.extendedModelId)}
                      onClick={() => {
                        if (draft.extendedModelId) {
                          lastExtendedModelRef.current = {
                            id: draft.extendedModelId,
                            params: draft.extendedModelParams,
                          };
                          setDraft({ ...draft, extendedModelId: "", extendedModelParams: [] });
                          return;
                        }
                        const nextId = lastExtendedModelRef.current.id || modelOptions[0]?.id || "";
                        const nextModel = modelForSelection(modelOptions, nextId);
                        setDraft({
                          ...draft,
                          extendedModelId: nextId,
                          extendedModelParams: paramsForSelectedModel(nextModel, lastExtendedModelRef.current.params),
                        });
                      }}
                      className="shrink-0"
                    >
                      {draft.extendedModelId ? "On" : "Off"}
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <ModelPicker
                      models={modelOptions}
                      value={draft.extendedModelId}
                      onValueChange={(extendedModelId) => {
                        const nextModel = modelForSelection(modelOptions, extendedModelId);
                        setDraft({
                          ...draft,
                          extendedModelId,
                          extendedModelParams: paramsForSelectedModel(nextModel),
                        });
                      }}
                      favoriteModelKeys={favoriteModelKeys}
                      onToggleFavorite={onToggleFavoriteModel || (() => undefined)}
                      disabled={!draft.extendedModelId}
                      placeholder="Select a model"
                      ariaLabel="Subagent model"
                      className="min-w-0 flex-1"
                    />
                    {modelForSelection(modelOptions, draft.extendedModelId) ? (
                      <ModelOptionsMenu
                        model={modelForSelection(modelOptions, draft.extendedModelId)!}
                        modelParams={draft.extendedModelParams}
                        onModelParamsChange={(extendedModelParams) => setDraft({ ...draft, extendedModelParams })}
                        className="opacity-100"
                      />
                    ) : null}
                  </div>
                </details>
                <label>Timezone
                  <input name="timezone" value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} required />
                </label>
                <p className="automation-editor-hint">{isAgentProject ? "Leave Model unset to use the selected agent’s model." : "Leave Model unset to use the context chat or your default model."}</p>
                </fieldset>
                {creating && editorStep === 3 ? <fieldset data-step="3" className="automation-editor-review">
                  <legend tabIndex={-1}>Ready to schedule</legend>
                  <dl>
                    <div><dt>Task</dt><dd>{draft.name}</dd></div>
                    <div><dt>Project</dt><dd>{targetProject?.name || "No project"}</dd></div>
                    <div><dt>{isAgentProject ? "Agent" : "Context"}</dt><dd>{targetAgents.find((agent) => agent.chatId === draft.chatId)?.name || targetChats.find((chat) => chat.id === draft.chatId)?.title || "New automation chat"}</dd></div>
                    <div><dt>Schedule</dt><dd>{formatSchedule({ ...currentDetail, schedule: scheduleFromDraft(draft), timezone: draft.timezone })}</dd></div>
                    <div><dt>Model</dt><dd>{modelForSelection(modelOptions, draft.modelId)?.displayName || "From destination or Settings"}</dd></div>
                    <div><dt>Timezone</dt><dd>{draft.timezone}</dd></div>
                  </dl>
                  <p className="automation-editor-review-prompt">{draft.prompt}</p>
                </fieldset> : null}
                {editorError ? <p className="automation-editor-error" role="alert">{editorError}</p> : null}
                <div className="automation-actions automation-editor-actions">
                  {creating && editorStep > 0 ? <button type="button" disabled={pendingAction !== null} onClick={() => { setEditorError(""); setEditorStep((step) => step - 1); }}><ChevronLeft aria-hidden="true" />Back</button> : null}
                  <button type="submit" disabled={pendingAction !== null || ((editorStep === 1 || !creating) && (targetLoading || projectsLoading || Boolean(targetError) || Boolean(projectsError))) || (creating && editorStep === 1 && isAgentProject && !targetAgents.length)}>
                    {creating && editorStep < EDITOR_STEPS.length - 1 ? <>Continue<ChevronRight aria-hidden="true" /></> : <>
                    {pendingAction === "save"
                      ? creating ? "Creating…" : "Saving…"
                      : creating ? "Create automation" : "Save changes"}</>}
                  </button>
                  <button type="button" disabled={pendingAction !== null} onClick={cancelDraft}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <dl className="automation-facts">
                <div className="automation-fact is-prompt">
                  <dt>Prompt</dt>
                  <dd className="automation-detail-prompt">{currentDetail.prompt}</dd>
                </div>
                <div className="automation-fact">
                  <dt>Model</dt>
                  <dd>{currentModelName}{currentModelOptionsLabel ? ` · ${currentModelOptionsLabel}` : ""}</dd>
                </div>
                {extendedModelName ? (
                  <div className="automation-fact">
                    <dt>Extended</dt>
                    <dd>{extendedModelName}{extendedModelOptionsLabel ? ` · ${extendedModelOptionsLabel}` : ""}</dd>
                  </div>
                ) : null}
                <div className="automation-fact">
                  <dt>Mode</dt>
                  <dd><Bot aria-hidden="true" />{modeName}</dd>
                </div>
                <div className="automation-fact">
                  <dt>Project</dt>
                  <dd><FolderKanban aria-hidden="true" />{projectName}</dd>
                </div>
                <div className="automation-fact">
                  <dt>Context chat</dt>
                  <dd>
                    <button type="button" className="automation-fact-link" onClick={() => onOpenChat(currentDetail.chatId)} title={contextChatTitle}>
                      <MessageSquare aria-hidden="true" />
                      <span>{contextChatTitle}</span>
                    </button>
                  </dd>
                </div>
              </dl>
            )}

            {!editing ? (
              <div className="automation-actions">
                <button
                  type="button"
                  disabled={pendingAction !== null || hasActiveRun}
                  onClick={() => void mutate(currentDetail, "run")}
                >
                  <Play aria-hidden="true" />
                  {pendingAction === "run" ? "Starting…" : "Run now"}
                </button>
                <button
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => void mutate(currentDetail, currentDetail.status === "active" ? "pause" : "resume")}
                >
                  {currentDetail.status === "active" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {pendingAction === "pause" ? "Pausing…" : pendingAction === "resume" ? "Resuming…" : currentDetail.status === "active" ? "Pause" : "Resume"}
                </button>
                <button type="button" disabled={pendingAction !== null} onClick={() => beginEdit(currentDetail)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </button>
                <button type="button" className="is-danger" disabled={pendingAction !== null} onClick={() => setDeleteTarget(currentDetail)}>
                  <Trash2 aria-hidden="true" />
                  Delete
                </button>
              </div>
            ) : null}

            {!creating && currentDetail.lastError ? <p className="automation-last-error" role="alert">{currentDetail.lastError}</p> : null}

            {!creating ? (
              <section className="automation-run-history" aria-labelledby={`automation-history-${currentDetail.id}`}>
                <div className="automation-run-history-header">
                  <h4 id={`automation-history-${currentDetail.id}`}>Run history</h4>
                  <span>{selectedRuns.length} loaded</span>
                </div>

                {selectedRuns.length === 0 ? (
                  <div className="automation-history-empty">No runs yet. Run it now or wait for the next trigger.</div>
                ) : null}

                <div className="automation-run-list">
                  {selectedRuns.map((run) => {
                    const duration = formatDuration(run.startedAt || run.createdAt, run.completedAt, now);
                    const preview = run.resultPreview || run.error;
                    return (
                      <button key={run.id} type="button" className="automation-run-card" onClick={() => onOpenChat(run.chatId)}>
                        <span className="automation-run-topline">
                          <RunStatus status={run.status} iconOnly decorative className="automation-run-indicator" />
                          <span className="automation-run-when">{formatDate(run.startedAt || run.createdAt, currentDetail.timezone)}</span>
                          <span className="automation-run-trigger">{run.trigger || (run.manual ? "manual" : "scheduled")}</span>
                        </span>
                        <span className="automation-run-summary">{run.status}{duration ? ` · ${duration}` : ""}</span>
                        {preview ? <span className={cn("automation-run-preview", run.error && "is-error")}>{preview}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {detailLoading ? <span className="sr-only" role="status">Refreshing automation details…</span> : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete automation?"
        description={deleteTarget ? `“${deleteTarget.name}” and its run history will be deleted permanently.` : ""}
        confirmLabel="Delete automation"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await removeAutomation(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </AutomationSplitView>
  );
}
