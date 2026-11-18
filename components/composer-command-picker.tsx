"use client";

import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Activity, Brain, CalendarDays, ClipboardList, Cpu, FileCode2, Globe2, Link2, Monitor, NotebookPen, Palette,
  PanelRight, Paperclip, Plus, Search, Settings2, SlidersHorizontal, Telescope, Terminal, Users } from "lucide-react";
import { PickerFrame, PickerRow, pickerOptionId } from "./picker-frame";
import { defaultParamsForModel, modelParametersForModel, normalizeParameterValue, sanitizeModelParams,
  type ModelParameter, type ModelParamSelection } from "@/lib/model-params";
import { DEEP_RESEARCH_MODE_ID } from "@/lib/deep-research";
import { referenceMatches, normalizeReferenceText } from "@/lib/reference-search";
import type { ModelInfo } from "./settings-panel";
import type { ModelChain } from "@/lib/model-chain-types";

export const WORKSPACE_COMMAND_TABS = [
  { id: "team", label: "Agent overview", icon: Users },
  { id: "canvas", label: "Canvas", icon: Palette },
  { id: "plan", label: "Plans", icon: ClipboardList },
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "browser", label: "Browser", icon: Globe2 },
  { id: "desktops", label: "Desktops", icon: Monitor },
  { id: "monitor", label: "Monitor", icon: Activity },
] as const;
export type WorkspaceCommandTab = typeof WORKSPACE_COMMAND_TABS[number]["id"];

type CommandBase = { id: string; label: string; detail?: string; keywords?: string; icon?: ReactNode; shortcut?: string;
  current?: boolean; disabled?: boolean; context?: string; parentId?: string };
export type ComposerCommand = CommandBase & (
  | { children: ComposerCommand[]; number?: { parameter: ModelParameter; value: string; apply: (value: string) => void }; empty?: string }
  | { run: () => void; restoreFocus?: boolean }
  | { fill: "goal" }
);
export type CommandScope = Extract<ComposerCommand, { children: ComposerCommand[] }>;

type Choice = { id: string; label: string; detail?: string; current?: boolean; icon?: ReactNode; run: () => void };
type WorkspaceTab = typeof WORKSPACE_COMMAND_TABS[number];
type CatalogInput = {
  modes: Choice[]; access: Choice[]; accessIcon?: ReactNode;
  models: readonly ModelInfo[]; selectedModel: ModelInfo; modelParams: readonly ModelParamSelection[];
  chains: readonly ModelChain[]; chainId?: string; favoriteModelIds: readonly string[]; modelIcon?: (model: ModelInfo) => ReactNode;
  modelId: string; modelLabel: string; modelLock?: string; optionLock?: string;
  onModel: (id: string) => void; onChain: (chain: ModelChain) => void; onModelParams: (params: ModelParamSelection[]) => void;
  workspaceTabs: readonly WorkspaceTab[]; onWorkspace: (tab: WorkspaceCommandTab) => void; canCreate: boolean;
  onCreate: (type: "canvas" | "plan") => void;
  onSettings: () => void; onAgentHub: () => void; onCalendar: () => void; onChatSearch: () => void; onFiles: () => void;
};
const glyph = (Icon: typeof Cpu) => <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
const parameterLabel = (parameter: ModelParameter) => parameter.displayName || parameter.id;
const valueLabel = (parameter: ModelParameter, value: string) =>
  parameter.values.find(option => option.value === value)?.displayName || (value === "true" ? "On" : value === "false" ? "Off" : value);

export function composerCommands(input: CatalogInput): ComposerCommand[] {
  const shortcut = (id: string) => "/" + id;
  const research = input.modes.find(mode => mode.id === DEEP_RESEARCH_MODE_ID);
  const defaults = defaultParamsForModel(input.selectedModel);
  const parameters = modelParametersForModel(input.selectedModel);
  const options: ComposerCommand[] = [];
  for (const parameter of parameters) {
    const value = input.modelParams.find(candidate => candidate.id === parameter.id)?.value
      ?? defaults.find(candidate => candidate.id === parameter.id)?.value ?? "";
    const apply = (next: string) => input.onModelParams(sanitizeModelParams(input.selectedModel,
      [...input.modelParams.filter(candidate => candidate.id !== parameter.id), ...(next ? [{ id: parameter.id, value: next }] : [])]));
    const children: ComposerCommand[] = parameter.values.map(option => ({
      id: "value:" + option.value, label: valueLabel(parameter, option.value), keywords: option.value, current: option.value === value,
      icon: glyph(SlidersHorizontal), run: () => apply(option.value),
    }));
    options.push({
      id: "option:" + parameter.id, label: parameterLabel(parameter), keywords: parameter.id,
      detail: value ? "Current: " + valueLabel(parameter, value) : parameter.customNumber ? "Automatic" : undefined,
      icon: glyph(SlidersHorizontal), children,
      ...(parameter.customNumber ? { number: { parameter, value, apply } } : {}),
    });
  }
  if (defaults.length) options.push({ id: "reset-options", label: "Reset defaults", icon: glyph(SlidersHorizontal), run: () => input.onModelParams(defaults) });

  const favorites = new Set(input.favoriteModelIds);
  const modelRows: ComposerCommand[] = [
    ...input.chains.map(chain => ({ id: "chain:" + chain.id, label: chain.name, detail: "Model chain", icon: glyph(Link2), current: chain.id === input.chainId, run: () => input.onChain(chain) })),
    ...[...input.models].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id))).map(model => ({
      id: "model:" + model.id, label: model.displayName || model.id, detail: model.connectionLabel || model.providerName || model.providerId,
      keywords: [model.id, model.description].filter(Boolean).join(" "), icon: input.modelIcon?.(model) || glyph(Cpu),
      current: !input.chainId && model.id === input.modelId, run: () => input.onModel(model.id),
    })),
  ];

  return [
    ...(research ? [{ ...research, shortcut: shortcut(DEEP_RESEARCH_MODE_ID), keywords: "research recherche recherchemodus", icon: glyph(Telescope) }] : []),
    { id: "model", label: "Model", shortcut: "/model", icon: glyph(Cpu), keywords: "models modelle provider chain", detail: input.modelLock || input.modelLabel,
      disabled: Boolean(input.modelLock), children: modelRows, empty: "No available models. Connect a provider in Settings." },
    { id: "model-options", label: "Model options", shortcut: "/model-options", icon: glyph(SlidersHorizontal), keywords: "reasoning thinking effort model settings optionen",
      detail: input.optionLock || undefined, disabled: Boolean(input.optionLock), children: options, empty: "This model has no extra options." },
    { id: "mode", label: "Agent mode", shortcut: "/mode", icon: glyph(SlidersHorizontal), keywords: "agent ask plan modus",
      detail: input.modes.find(mode => mode.current)?.label, children: input.modes.filter(mode => mode !== research).map(mode => ({ ...mode, id: "mode:" + mode.id })) },
    { id: "access", label: "Access", shortcut: "/access", icon: input.accessIcon, keywords: "permissions runtime approvals zugriff berechtigungen",
      detail: input.access.find(choice => choice.current)?.label, children: input.access.map(choice => ({ ...choice, id: "access:" + choice.id })) },
    { id: "workspace", label: "Workspace", shortcut: "/workspace", icon: glyph(PanelRight), keywords: "sidebar arbeitsbereich",
      children: [
        ...input.workspaceTabs.map(tab => ({ id: "tab:" + tab.id, label: tab.label, icon: glyph(tab.icon), keywords: tab.id,
          detail: "Open in workspace", run: () => input.onWorkspace(tab.id), restoreFocus: false })),
        ...(["canvas", "plan"] as const).map(type => ({ id: "new-" + type, label: "Create " + type, keywords: "new", icon: glyph(Plus),
          disabled: !input.canCreate, run: () => input.onCreate(type) })),
      ] },
    { id: "chat", label: "Chat and navigation", shortcut: "/chat", icon: glyph(Search), keywords: "navigation settings chat",
      children: [
        { id: "goal", label: "Chat goal", detail: "Write a goal; use /goal reset to clear it", shortcut: "/goal", icon: glyph(ClipboardList), fill: "goal" },
        { id: "attach", label: "Attach files", icon: glyph(Paperclip), run: input.onFiles, restoreFocus: false },
        { id: "search-chats", label: "Search chats", icon: glyph(Search), run: input.onChatSearch, restoreFocus: false },
        { id: "settings", label: "Settings", icon: glyph(Settings2), run: input.onSettings, restoreFocus: false },
        { id: "agent-hub", label: "Agent Hub", icon: glyph(Brain), keywords: "skills", run: input.onAgentHub, restoreFocus: false },
        { id: "calendar", label: "Calendar", icon: glyph(CalendarDays), run: input.onCalendar, restoreFocus: false },
      ] },
  ];
}

export function commandScope(commands: readonly ComposerCommand[], path: readonly string[]): CommandScope | undefined {
  let items = commands;
  let scope: CommandScope | undefined;
  for (const id of path) {
    const item = items.find(entry => entry.id === id);
    if (!item || !("children" in item) || item.disabled) return undefined;
    scope = item;
    items = item.children;
  }
  return scope;
}

export function commandResults(commands: readonly ComposerCommand[], path: readonly string[], rawQuery: string): ComposerCommand[] {
  const scope = commandScope(commands, path);
  if (path.length && !scope) return [];
  const query = rawQuery.trim().replace(/^\//, "");
  if (scope?.number) {
    const { parameter, value, apply } = scope.number;
    const result = query ? normalizeParameterValue(parameter, query) : "";
    const presets = scope.children.filter(item => !query || referenceMatches(query, item.label, item.keywords));
    if (result !== undefined && result !== value && !presets.some(item => item.keywords === result)) {
      return [{ id: "apply-number", label: result ? "Apply " + result : "Use automatic value", icon: glyph(SlidersHorizontal), run: () => apply(result) }, ...presets];
    }
    return presets;
  }
  const items = scope?.children || commands;
  if (!query) return [...items];
  const matches = (item: ComposerCommand) => referenceMatches(query, item.label, item.shortcut, item.keywords, item.detail);
  const visible = items.filter(matches);
  if (!scope) {
    for (const group of commands) {
      if (!("children" in group) || group.disabled) continue;
      for (const item of group.children) {
        if (matches(item)) visible.push({ ...item, context: group.label, parentId: group.id });
      }
    }
  }
  // Prefer an exact command name over a category whose help text mentions it.
  const exact = normalizeReferenceText(query);
  const score = (item: ComposerCommand) => Number(item.shortcut?.slice(1) === exact || normalizeReferenceText(item.label) === exact || item.id.split(":").at(-1) === exact);
  return visible.sort((a, b) => score(b) - score(a));
}

export const COMMAND_LIST_ID = "composer-command-list";
export const COMMAND_OPTION_PREFIX = "composer-command";

export function ComposerCommandPicker({ scope, query, rows, index, inputRef, onQuery, onBack, onIndex, onSelect, onKeyDown }: {
  scope?: CommandScope; query: string; rows: readonly ComposerCommand[]; index: number; inputRef?: Ref<HTMLInputElement>;
  onQuery: (value: string) => void; onBack?: () => void; onIndex: (index: number) => void;
  onSelect: (item: ComposerCommand) => void; onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const number = scope?.number?.parameter.customNumber;
  const numericHelp = number ? "Enter a whole number from " + number.min.toLocaleString("en-US") + " to " + number.max.toLocaleString("en-US") : undefined;
  return <PickerFrame id={COMMAND_LIST_ID} optionIdPrefix={COMMAND_OPTION_PREFIX} inputRef={inputRef}
    index={index} count={rows.length} query={query} scope={scope?.label} label="Slash commands"
    title={number ? "Enter " + (scope?.label || "value").toLowerCase() : scope ? "Search " + scope.label.toLowerCase() : "Search commands"}
    numeric={Boolean(number)} onQuery={onQuery} onKeyDown={onKeyDown} onBack={onBack} backLabel="Back"
    footer={numericHelp ? <p className="px-2.5 py-2 text-xs text-muted-foreground">{numericHelp}</p> : undefined}>
    {rows.map((item, position) => {
      const detail = [item.context, item.detail].filter(Boolean).join(" · ");
      return <PickerRow key={item.id} id={pickerOptionId(COMMAND_OPTION_PREFIX, position)} highlighted={position === index}
        label={item.label} icon={item.icon} shortcut={item.shortcut} checked={item.current} disabled={item.disabled}
        detail={detail ? <span className="block truncate text-[11px] text-muted-foreground" title={detail}>{detail}</span> : undefined}
        onHighlight={() => onIndex(position)} onSelect={() => onSelect(item)} />;
    })}
    {!rows.length ? <p role="status" className="px-2.5 py-4 text-center text-xs text-muted-foreground">
      {number ? (query ? "Enter a supported value." : "Type a value to change this option.") : query ? "No matching commands." : scope?.empty || "No commands available."}
    </p> : null}
  </PickerFrame>;
}
