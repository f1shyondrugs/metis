"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  Brain,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Gauge,
  Paperclip,
  Download,
  ExternalLink,
  Globe2,
  KeyRound,
  Link2,
  Mic,
  Monitor,
  MoreHorizontal,
  Palette,
  PlugZap,
  Puzzle,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Apple as AppleLogo, Github as GithubLogo, Microsoft as MicrosoftLogo } from "@lobehub/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RemotePermission } from "@/lib/remote-clients";
import { ModelChainsPanel } from "@/components/model-chains-panel";
import { ModelPicker } from "@/components/model-picker";
import { ModelOptionsMenu } from "@/components/model-options-menu";
import { ProviderLogo } from "@/components/provider-logo";
import { ProviderSettingsLayout, ProviderSettingsRow, providerConnectionStatus } from "@/components/provider-settings-layout";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { newProviderConnectionIdentity } from "@/lib/provider-connection-draft";
import { modelForSelection } from "@/lib/model-selection";
import type { MemoryItem } from "@/components/memories-panel";
import { MicrophoneSettings } from "@/components/microphone-settings";
import { VoiceDictionarySettings } from "@/components/voice-dictionary-settings";
import { ProviderLimitSettings } from "@/components/provider-limit-settings";
import { ProviderRetrySettings } from "@/components/provider-retry-settings";
import { AppearanceSettings } from "@/components/appearance-settings";
import { useAppearance } from "@/components/appearance-provider";
import { NotificationDeliverySettings } from "@/components/notification-delivery-settings";
import { RemoteNotificationSettings, RemoteDeviceNotificationSwitch } from "@/components/remote-notification-settings";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { AgentRuntimeSettings } from "@/components/agent-runtime-settings";
import { AttachmentSettings } from "@/components/attachment-settings";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AdminUsersPanel } from "@/components/admin-users-panel";
import { PlanUsagePanel } from "@/components/quota-gauges";
import { UpdateSettingsPanel, UpdateStatusProbe } from "@/components/update-channel-nav";
import { CliVersionsPanel } from "@/components/cli-versions-panel";
import { BrowserSettingsControls } from "@/components/browser-settings-controls";
import type { UsageSnapshot } from "@/lib/usage-display";
import {SettingsSearch} from "@/components/settings-search";
import {SETTINGS_TABS, settingsOverviewSections, type SettingsSearchEntry} from "@/lib/settings-navigation";

type ProviderDefinition = {
  key: string;
  name: string;
  description: string;
  kind: string;
  authTypes: string[];
  defaultBaseUrl?: string;
  capabilities: Record<string, boolean>;
  models: Array<{ id: string; displayName: string; tags?: string[] }>;
  setupHint: string;
};

type ProviderConnection = {
  id: string;
  providerKey: string;
  slug: string;
  label: string;
  authType: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  hasSecret: boolean;
  lastCheckedAt?: string;
  lastError?: string;
};

function providerConnectionDraft(connection: ProviderConnection) {
  return {
    id: connection.id,
    providerKey: connection.providerKey,
    slug: connection.slug,
    label: connection.label,
    authType: connection.authType,
    baseUrl: connection.baseUrl || "",
    secret: "",
    project: typeof connection.config?.project === "string" ? connection.config.project : "",
    location: typeof connection.config?.location === "string" ? connection.config.location : "",
  };
}

function preferredAuthType(provider: ProviderDefinition) {
  return provider.authTypes[0] || "api_key";
}

type OAuthFlow = {
  id: string;
  connectionId: string;
  providerKey: string;
  status: "starting" | "awaiting_auth" | "awaiting_code" | "completed" | "error" | "cancelled";
  authUrl?: string;
  instructions?: string;
  userCode?: string;
  error?: string;
  manualInputRequired?: boolean;
};

type CustomSelectOption = {
  value: string;
  label: string;
  providerLogo?: string;
};

function CustomSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: string;
  options: CustomSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value) || options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !selected}
          aria-label={ariaLabel}
          className={cn("h-9 min-w-0 justify-between gap-2 text-left font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.providerLogo ? (
              <ProviderLogo providerId={selected.providerLogo} className="size-4 shrink-0" />
            ) : null}
            <span className="min-w-0 truncate">{selected?.label || "Select…"}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-[14rem] overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onValueChange(option.value)}
            className="gap-2"
          >
            <Check className={cn("size-3.5 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
            {option.providerLogo ? (
              <ProviderLogo providerId={option.providerLogo} className="size-4 shrink-0" />
            ) : null}
            <span className="truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type RemoteClient = {
  id: string;
  name: string;
  status: "online" | "offline" | "revoked";
  os?: string;
  version?: string;
  architecture?: string;
  hostname?: string;
  lastSeenAt?: string;
  policy: { mode: "restricted" | "approval_required" | "full_access"; allowlist: string[]; permissions: RemotePermission[] };
  permissionMode: "user" | "admin";
  capabilities?: string[];
};

type DesktopPermissionStatus = {
  available: boolean;
  accessibility?: boolean;
  screenRecording?: boolean;
  monitors?: number;
  backend?: string;
  reason?: string;
};

type ArchivedChat = {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  share?: {
    id: string;
    active: boolean;
    passwordProtected: boolean;
  };
};

const API_KEY_URLS: Record<string, string> = {
  cursor: "https://cursor.com/dashboard/api",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  antigravity: "https://aistudio.google.com/app/apikey",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/keys",
};

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = import("@/lib/model-params").ModelParameter;

export type ModelParamSelection = {
  id: string;
  value: string;
};

export type ModelInfo = {
  id: string;
  legacyIds?: string[];
  displayName: string;
  contextWindow?: number;
  description?: string;
  providerId?: string;
  providerName?: string;
  connectionId?: string;
  connectionLabel?: string;
  source?: "cursor" | "catalog" | "discovered";
  tags?: string[];
  capabilities?: Record<string, boolean>;
  parameters?: ModelParameter[];
  defaultParams?: ModelParamSelection[];
};

export type FinishSound = {
  name: string;
  dataUrl: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobile?: boolean;
  settingsTab: string;
  onSettingsTabChange: (tab: string) => void;
  sectionRequest?: string | null;
  onSectionRequestHandled?: () => void;
  memories: MemoryItem[];
  soundCuesEnabled: boolean;
  onSoundCuesEnabledChange: (enabled: boolean) => void;
  voiceInputEnabled: boolean;
  voiceMaxDurationSeconds: number;
  voiceProvider: "openai" | "local" | "custom" | "browser";
  voiceModelId: string;
  voiceRealtime: boolean;
  voiceEndpoint: string;
  onVoiceApiKeySave: (apiKey: string) => Promise<void>;
  onVoiceInputSettingsChange: (settings: {
    enabled?: boolean;
    maxDurationSeconds?: number;
    provider?: "openai" | "local" | "custom" | "browser";
    modelId?: string;
    realtime?: boolean;
    endpoint?: string;
  }) => void;
  browserEnabled: boolean;
  browserRealtime: boolean;
  browserFps: number;
  browserViewportWidth: number;
  browserViewportHeight: number;
  onBrowserSettingsChange: (settings: {
    browserEnabled?: boolean;
    browserRealtime?: boolean;
    browserFps?: number;
    browserViewportWidth?: number;
    browserViewportHeight?: number;
  }) => void;
  compressionEnabled: boolean;
  compressionMode: "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";
  compressionToolResults: boolean;
  compressionChatHistory: boolean;
  onCompressionSettingsChange: (settings: {
    enabled?: boolean;
    mode?: "lite" | "standard" | "aggressive" | "ultra" | "rtk" | "stacked";
    compressToolResults?: boolean;
    compressChatHistory?: boolean;
  }) => void;
  models: ModelInfo[];
  favoriteModelKeys: string[];
  onToggleFavoriteModel: (modelId: string) => void;
  subagentModelEnabled: boolean;
  onSubagentModelEnabledChange: (enabled: boolean) => void;
  subagentModelId: string;
  onSubagentModelIdChange: (modelId: string) => void;
  subagentModelParams: ModelParamSelection[];
  onSubagentModelParamsChange: (params: ModelParamSelection[]) => void;
  finishSound: FinishSound | null;
  onFinishSoundChange: (sound: FinishSound | null) => void;
  onTestFinishSound: () => void;
  onMemoriesChanged: () => void;
  onMemoryDeleted: (id: string) => void;
  onChatsChanged: () => void;
  usageSnapshot: UsageSnapshot | null;
  onRefreshUsage: () => Promise<void>;
  onModelsChanged?: () => void;
  onModesChanged?: () => void;
  onResetMetis?: () => Promise<void>;
  onUpdateMetis?: () => Promise<void>;
  isHostAdmin?: boolean;
};

function scrollSettingsSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  target.tabIndex = -1;
  target.focus({preventScroll: true});
}

type SettingsPaneId =
  | "tab"
  | "browser-storage"
  | "appearance"
  | "providers"
  | "versions"
  | "model-chains"
  | "memories"
  | "agent-settings"
  | "dictionary"
  | "attachments"
  | "subagent-model"
  | "compression"
  | "notifications"
  | "voice"
  | "browser"
  | "usage"
  | "remote-clients"
  | "users"
  | "archived"
  | "shared"
  | "maintenance"
  | "updates";

const SETTINGS_SECTION_TO_PANE: Partial<Record<string, Exclude<SettingsPaneId, "tab">>> = {
  "settings-appearance": "appearance",
  "settings-browser-storage": "browser-storage",
  "settings-providers": "providers",
  "settings-versions": "versions",
  "settings-model-chains": "model-chains",
  "settings-memories": "memories",
  "settings-agent-runtime": "agent-settings",
  "settings-dictionary": "dictionary",
  "settings-attachments": "attachments",
  "settings-subagent-model": "subagent-model",
  "settings-token-compression": "compression",
  "settings-notifications": "notifications",
  "settings-voice-input": "voice",
  "settings-browser": "browser",
  "settings-usage": "usage",
  "settings-remote-clients": "remote-clients",
  "settings-users": "users",
  "settings-archived": "archived",
  "settings-shared": "shared",
  "settings-maintenance": "maintenance",
};

type SettingsCategory = (typeof SETTINGS_TABS)[number];

function settingsCategoryIcon(value: string): LucideIcon {
  return value === "general" ? Settings2
    : value === "models" ? KeyRound
    : value === "agent" ? Puzzle
    : value === "devices" ? PlugZap
    : value === "updates" ? RefreshCw
    : Users;
}

function settingsCategoryLabel(tab: SettingsCategory, isHostAdmin: boolean, updateAvailable: boolean) {
  return tab.value === "updates" && updateAvailable ? "Update Available"
    : tab.value === "admin" ? (isHostAdmin ? "Admin" : "Chats") : tab.label;
}

const SETTINGS_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  general: "Appearance, input and notifications",
  models: "Providers, usage and CLI versions",
  agent: "Runtime, delegation and memories",
  devices: "Remote clients and permissions",
  admin: "Archived and shared chats",
  updates: "Update channels, schedule and history",
};

function SettingsExternalLinks() {
  return (
    <div id="settings-links" role="group" aria-label="Website and GitHub" className="grid grid-cols-2 gap-2 px-3 py-3">
                  <Button asChild variant="outline" className="h-11 w-full justify-between px-3">
                    <a href="https://metis.f1shy312.com" target="_blank" rel="noopener noreferrer">
                      <span className="flex items-center gap-2">
                        <Globe2 className="size-4" aria-hidden="true" />
                        Website
                      </span>
                      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="h-11 w-full justify-between px-3">
                    <a href="https://github.com/f1shyondrugs/metis-ai" target="_blank" rel="noopener noreferrer">
                      <span className="flex items-center gap-2">
                        <GithubLogo className="size-4" aria-hidden="true" />
                        GitHub
                      </span>
                      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    </a>
                  </Button>
  </div>
  );
}

function SettingsTile({
  id,
  title,
  meta,
  icon: Icon,
  onOpen,
}: {
  id: string;
  title: string;
  meta: ReactNode;
  icon: LucideIcon;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-settings-tile={id}
      onClick={onOpen}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
        "text-foreground hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function SettingsOverview({ title, children }: { title: string; children: ReactNode }) {
  return <div className="px-3 py-3 sm:px-6 sm:py-5" data-slot="settings-overview">
    <h2 className="mb-2 px-3 text-sm font-semibold">{title}</h2>
    <div className="divide-y divide-border/60">{children}</div>
  </div>;
}

function SettingsFeaturePane({
  backLabel,
  title,
  description,
  slot,
  onBack,
  children,
}: {
  backLabel: string;
  title?: string;
  description?: string;
  slot: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 sm:px-8 sm:py-6" data-slot={slot}>
      <button
        type="button"
        className="inline-flex min-h-9 w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
        Back to {backLabel}
      </button>
      {title ? (
      <div>
        <h3 tabIndex={-1} data-settings-heading className="text-sm font-medium outline-none">{title}</h3>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

const REMOTE_PERMISSION_OPTIONS: Array<{ value: RemotePermission; label: string }> = [
  { value: "get_info", label: "Device information" },
  { value: "list_directory", label: "List folders" },
  { value: "read_file", label: "Read files" },
  { value: "write_file", label: "Create files" },
  { value: "edit_file", label: "Edit files" },
  { value: "delete_file", label: "Delete files" },
  { value: "execute_command", label: "Run allowlisted commands" },
  { value: "terminal", label: "Interactive terminal" },
];

function RemotePermissionsEditor({
  client,
  onSave,
  desktopStatus,
  desktopBusy,
  onCheckDesktop,
}: {
  client: RemoteClient;
  onSave: (client: RemoteClient, policy: RemoteClient["policy"]) => Promise<void>;
  desktopStatus?: DesktopPermissionStatus;
  desktopBusy?: boolean;
  onCheckDesktop?: (prompt?: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [permissions, setPermissions] = useState<RemotePermission[]>(client.policy.permissions);
  const [fullAccess, setFullAccess] = useState(client.policy.mode === "full_access");
  const [allowlistDraft, setAllowlistDraft] = useState(client.policy.allowlist.join("\n"));
  const [saving, setSaving] = useState(false);
  const supportsComputerUse = client.capabilities?.includes("desktop_gui");
  const fullAccessPermissions: RemotePermission[] = [
    ...REMOTE_PERMISSION_OPTIONS.map(({ value }) => value),
    ...(supportsComputerUse ? ["computer_use" as const] : []),
  ];

  const save = async () => {
    setSaving(true);
    try {
      await onSave(client, {
        ...client.policy,
        mode: fullAccess ? "full_access" : client.policy.mode === "restricted" ? "restricted" : "approval_required",
        permissions: fullAccess ? fullAccessPermissions : permissions,
        allowlist: allowlistDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      });
      setOpen(false);
      toast.success(`Permissions saved for ${client.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) {
        setPermissions(client.policy.permissions);
        setFullAccess(client.policy.mode === "full_access");
        setAllowlistDraft(client.policy.allowlist.join("\n"));
      }
      setOpen(next);
    }}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" aria-label={`Permissions for ${client.name}`}>
          Permissions <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3">
        <div>
          <p className="text-sm font-medium">Device permissions</p>
          <p className="text-xs text-muted-foreground">Choose what Metis can do on this device.</p>
        </div>
        <div className="grid gap-1">
          <label className="flex min-h-9 items-center gap-2 rounded-md px-1 text-xs font-medium hover:bg-accent">
            <input
              type="checkbox"
              checked={fullAccess}
              onChange={(event) => setFullAccess(event.target.checked)}
              className="size-4 accent-primary"
            />
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            <span>Full Access</span>
          </label>
          {REMOTE_PERMISSION_OPTIONS.map(({ value, label }) => (
            <label key={value} className={cn("flex min-h-8 items-center gap-2 rounded-md px-1 text-xs", fullAccess ? "cursor-not-allowed text-muted-foreground opacity-50" : "hover:bg-accent")}>
              <input
                type="checkbox"
                checked={value === "terminal" && client.permissionMode === "user" ? false : fullAccess || permissions.includes(value)}
                disabled={fullAccess || (value === "terminal" && client.permissionMode === "user")}
                onChange={(event) => setPermissions((current) => event.target.checked
                  ? [...current, value]
                  : current.filter((item) => item !== value))}
                className="size-4 accent-primary"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <label className="flex min-h-10 items-center gap-2 border-t pt-2 text-xs">
          <input
            type="checkbox"
            role="switch"
            aria-checked={supportsComputerUse && (fullAccess || permissions.includes("computer_use"))}
            checked={supportsComputerUse && (fullAccess || permissions.includes("computer_use"))}
            disabled={!supportsComputerUse || fullAccess}
            onChange={(event) => setPermissions((current) => event.target.checked
              ? [...current, "computer_use"]
              : current.filter((item) => item !== "computer_use"))}
            className="size-4 accent-primary"
          />
          <span><span className="font-medium">Computer Use</span><span className="block text-muted-foreground">Screen, mouse, and keyboard. Managed here for Windows, macOS and Linux X11 devices with an interactive display.</span></span>
        </label>
        {supportsComputerUse ? (
          <div className="space-y-2 rounded-md border border-border/70 p-2">
            <p className="text-xs font-medium">OS permission check</p>
            {desktopStatus ? (
              <ul className="space-y-1 text-xs">
                {typeof desktopStatus.screenRecording === "boolean" ? <li>Screen Recording: {desktopStatus.screenRecording ? "on" : "off"}</li> : null}
                {typeof desktopStatus.accessibility === "boolean" ? <li>Accessibility: {desktopStatus.accessibility ? "on" : "off"}</li> : null}
                {typeof desktopStatus.monitors === "number" ? <li>Displays: {desktopStatus.monitors}</li> : null}
                {desktopStatus.backend ? <li>Backend: {desktopStatus.backend}</li> : null}
                <li>Desktop control: {desktopStatus.available ? "ready" : "blocked"}</li>
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{client.status === "online" ? "Checking this device…" : "Device must be online to check OS permissions."}</p>
            )}
            {desktopStatus?.reason ? <p className="text-xs text-muted-foreground">{desktopStatus.reason}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={desktopBusy || client.status !== "online"} onClick={() => void onCheckDesktop?.(false)}>Check now</Button>
              {String(client.os || "").toLowerCase().includes("mac") ? (
                <Button type="button" size="sm" variant="outline" disabled={desktopBusy || client.status !== "online"} onClick={() => void onCheckDesktop?.(true)}>Grant on Mac</Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {client.permissionMode === "user" ? <p className="text-xs text-muted-foreground">Interactive terminal requires admin pairing.</p> : null}
        <div className={cn("space-y-1", fullAccess && "opacity-50")}>
          <label htmlFor={`allowlist-${client.id}`} className="text-xs font-medium">Device command allowlist</label>
          <Textarea
            id={`allowlist-${client.id}`}
            value={allowlistDraft}
            onChange={(event) => setAllowlistDraft(event.target.value)}
            disabled={fullAccess}
            placeholder={"One exact command per line\ne.g. whoami"}
            rows={3}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">Global commands also apply. Commands require the permission above.</p>
        </div>
        <Button type="button" size="sm" className="w-full" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save permissions"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function SettingsPanel({
  open,
  onOpenChange,
  mobile = false,
  settingsTab,
  onSettingsTabChange,
  sectionRequest,
  onSectionRequestHandled,
  memories,
  soundCuesEnabled,
  onSoundCuesEnabledChange,
  voiceInputEnabled,
  voiceMaxDurationSeconds,
  voiceProvider,
  voiceModelId,
  voiceRealtime,
  voiceEndpoint,
  onVoiceApiKeySave,
  onVoiceInputSettingsChange,
  browserEnabled,
  browserRealtime,
  browserFps,
  browserViewportWidth,
  browserViewportHeight,
  onBrowserSettingsChange,
  compressionEnabled,
  compressionMode,
  compressionToolResults,
  compressionChatHistory,
  onCompressionSettingsChange,
  models,
  favoriteModelKeys,
  onToggleFavoriteModel,
  subagentModelEnabled,
  onSubagentModelEnabledChange,
  subagentModelId,
  onSubagentModelIdChange,
  subagentModelParams,
  onSubagentModelParamsChange,
  finishSound,
  onFinishSoundChange,
  onTestFinishSound,
  onMemoriesChanged,
  onMemoryDeleted,
  onChatsChanged,
  usageSnapshot,
  onRefreshUsage,
  onModelsChanged,
  onResetMetis,
  onUpdateMetis,
  isHostAdmin = false,
}: Props) {
  const appearance = useAppearance();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingMemoryIds, setDeletingMemoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  type BrowserStorageItem = {
    origin: string;
    storageTypes: string[];
    lastAccess?: string;
    sizeBytes: number;
    cookies: Array<{ name: string; domain: string; path: string; expires: number; size: number }>;
    localStorage: Array<{ key: string; value: string }>;
    sessionStorage: Array<{ key: string; value: string }>;
  };
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageItem[]>([]);
  const [browserStorageLoading, setBrowserStorageLoading] = useState(false);
  const [expandedBrowserOrigin, setExpandedBrowserOrigin] = useState<string | null>(null);
  const [browserStorageDraft, setBrowserStorageDraft] = useState({ type: "cookie" as "cookie" | "localStorage" | "sessionStorage", name: "", value: "" });
  const [browserStorageSaving, setBrowserStorageSaving] = useState(false);
  const [browserStorageError, setBrowserStorageError] = useState("");
  const [browserStorageDeleteTarget, setBrowserStorageDeleteTarget] = useState<string | null>(null);
  const [browserStorageClearAll, setBrowserStorageClearAll] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPaneId>(() => sectionRequest ? SETTINGS_SECTION_TO_PANE[sectionRequest] ?? "tab" : "tab");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(!sectionRequest);
  const [settingsSearchTarget, setSettingsSearchTarget] = useState<string | null>(null);
  const settingsContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !sectionRequest) return;
    const pane = SETTINGS_SECTION_TO_PANE[sectionRequest];
    if (pane) { setMobileMenuOpen(false); setSettingsPane(pane); setSettingsSearchTarget("pane"); }
    onSectionRequestHandled?.();
  }, [open, sectionRequest, onSectionRequestHandled]);

  function openSettingsSearchResult(entry: SettingsSearchEntry) {
    if (mobile && entry.sectionId === "settings-links") {
      setSettingsPane("tab");
      setMobileMenuOpen(true);
      setSettingsSearchTarget("settings-links");
      return;
    }
    setMobileMenuOpen(false);
    const pane = entry.sectionId ? SETTINGS_SECTION_TO_PANE[entry.sectionId] : undefined;
    onSettingsTabChange(entry.tab);
    setSettingsPane(pane ?? "tab");
    setBrowserStorageQuery("");
    setSettingsSearchTarget(pane ? "pane" : entry.sectionId ?? "top");
  }

  function openSettingsCategory(tab: string) {
    setMobileMenuOpen(false);
    setSettingsPane("tab");
    setBrowserStorageQuery("");
    setSettingsSearchTarget("top");
    onSettingsTabChange(tab);
  }

  function backToSettingsMenu() {
    setSettingsPane("tab");
    setMobileMenuOpen(true);
    setSettingsSearchTarget(`settings-category-${settingsTab}`);
  }

  function openSettingsPane(pane: SettingsPaneId, tab = settingsTab) {
    setMobileMenuOpen(false);
    onSettingsTabChange(tab);
    setSettingsPane(pane);
    setSettingsSearchTarget("pane");
  }

  function backToSettings(sectionId: string) {
    setMobileMenuOpen(false);
    setSettingsPane("tab");
    setSettingsSearchTarget(sectionId);
  }

  useEffect(() => {
    if (!open || !settingsSearchTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (settingsSearchTarget === "top" || settingsSearchTarget === "pane") {
        settingsContentRef.current?.scrollTo({top: 0, behavior: "instant"});
        const heading = settingsContentRef.current?.querySelector<HTMLElement>("[data-settings-heading], h2, h3");
        if (heading) { heading.tabIndex = -1; heading.focus({preventScroll: true}); }
      } else scrollSettingsSection(settingsSearchTarget);
      setSettingsSearchTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, settingsTab, settingsPane, settingsSearchTarget, mobileMenuOpen]);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [browserStorageQuery, setBrowserStorageQuery] = useState("");
  const [compressionPreview, setCompressionPreview] = useState("");
  const [compressionPreviewResult, setCompressionPreviewResult] = useState<{
    text: string;
    inputChars: number;
    outputChars: number;
    savingsPercent: number;
  } | null>(null);
  const [compressionPreviewBusy, setCompressionPreviewBusy] = useState(false);
  const notificationSettings = useNotificationSettings(open);
  const [remoteClients, setRemoteClients] = useState<RemoteClient[]>([]);
  const [desktopStatusById, setDesktopStatusById] = useState<Record<string, DesktopPermissionStatus>>({});
  const [desktopStatusBusyId, setDesktopStatusBusyId] = useState("");
  const desktopStatusChecked = useRef<Set<string>>(new Set());
  const [remoteGlobalAllowlistDraft, setRemoteGlobalAllowlistDraft] = useState("");
  const [remoteGlobalAllowlistBusy, setRemoteGlobalAllowlistBusy] = useState(false);
  const [remoteGlobalAllowlistLoaded, setRemoteGlobalAllowlistLoaded] = useState(false);
  const [remoteGlobalAllowlistError, setRemoteGlobalAllowlistError] = useState("");
  const [remoteCommand, setRemoteCommand] = useState("");
  const [remotePairToken, setRemotePairToken] = useState("");
  const [remoteServerUrl, setRemoteServerUrl] = useState("");
  const [remoteInstallerUrls, setRemoteInstallerUrls] = useState<Array<{ label: string; url: string }>>([]);
  const [remoteCommands, setRemoteCommands] = useState<{ linux: string; windows: string; macos: string } | null>(null);
  const [remotePlatform, setRemotePlatform] = useState<"linux" | "windows" | "macos">("linux");
  const [remotePermissionMode, setRemotePermissionMode] = useState<"user" | "admin">("user");
  const [remotePairStep, setRemotePairStep] = useState<"idle" | "os" | "install" | "finish">("idle");
  const [remotePairExistingIds, setRemotePairExistingIds] = useState<string[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteClientDeleteTarget, setRemoteClientDeleteTarget] = useState<RemoteClient | null>(null);
  const [voiceApiKey, setVoiceApiKey] = useState("");
  const [voiceKeyBusy, setVoiceKeyBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { type: "provider"; item: ProviderConnection } | null
  >(null);
  const [providerDefinitions, setProviderDefinitions] = useState<ProviderDefinition[]>([]);
  const [providerConnections, setProviderConnections] = useState<ProviderConnection[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providersError, setProvidersError] = useState("");
  const [providerAdding, setProviderAdding] = useState(false);
  const providerLoadVersionRef = useRef(0);
  const providerConnectionsRef = useRef<ProviderConnection[]>([]);
  const [providerDraft, setProviderDraft] = useState({
    id: "",
    providerKey: "openai",
    slug: "",
    label: "OpenAI",
    authType: "api_key",
    baseUrl: "",
    secret: "",
    project: "",
    location: "",
  });
  const [providerBusy, setProviderBusy] = useState(false);
  const [oauthFlow, setOauthFlow] = useState<OAuthFlow | null>(null);
  const [oauthCode, setOauthCode] = useState("");
  const [archivedChats, setArchivedChats] = useState<ArchivedChat[]>([]);
  const [sharedChats, setSharedChats] = useState<ArchivedChat[]>([]);
  const [archivedChatsLoaded, setArchivedChatsLoaded] = useState(false);
  const [resetMetisOpen, setResetMetisOpen] = useState(false);
  const [updateMetisOpen, setUpdateMetisOpen] = useState(false);
  const loadRemoteClients = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-clients", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load remote clients");
      const data = (await response.json()) as { clients?: RemoteClient[] };
      setRemoteClients(data.clients || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load remote clients");
    }
  }, []);

  const checkDesktopPermissions = useCallback(async (client: RemoteClient, prompt = false) => {
    if (client.status !== "online" || !client.capabilities?.includes("desktop_gui")) return;
    setDesktopStatusBusyId(client.id);
    try {
      const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}/desktop-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await response.json()) as { status?: DesktopPermissionStatus; error?: string };
      if (!response.ok || !data.status) throw new Error(data.error || "Desktop permission check failed");
      setDesktopStatusById((current) => ({ ...current, [client.id]: data.status as DesktopPermissionStatus }));
      desktopStatusChecked.current.add(client.id);
      if (prompt) toast.success(data.status.available ? `Desktop control is ready on ${client.name}` : `Permission prompt sent to ${client.name}`);
    } catch (error) {
      desktopStatusChecked.current.delete(client.id);
      toast.error(error instanceof Error ? error.message : "Desktop permission check failed");
    } finally {
      setDesktopStatusBusyId("");
    }
  }, []);

  const loadGlobalRemoteAllowlist = useCallback(async () => {
    setRemoteGlobalAllowlistLoaded(false);
    setRemoteGlobalAllowlistError("");
    try {
      const response = await fetch("/api/remote-clients/allowlist", { cache: "no-store" });
      const data = (await response.json()) as { allowlist?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load global allowlist");
      setRemoteGlobalAllowlistDraft((data.allowlist || []).join("\n"));
      setRemoteGlobalAllowlistLoaded(true);
    } catch (error) {
      setRemoteGlobalAllowlistError(error instanceof Error ? error.message : "Could not load global allowlist");
    }
  }, []);

  const saveGlobalRemoteAllowlist = useCallback(async () => {
    setRemoteGlobalAllowlistBusy(true);
    setRemoteGlobalAllowlistError("");
    try {
      const response = await fetch("/api/remote-clients/allowlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowlist: remoteGlobalAllowlistDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }),
      });
      const data = (await response.json()) as { allowlist?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save global allowlist");
      setRemoteGlobalAllowlistDraft((data.allowlist || []).join("\n"));
      toast.success("Global command allowlist saved");
    } catch (error) {
      setRemoteGlobalAllowlistError(error instanceof Error ? error.message : "Could not save global allowlist");
    } finally {
      setRemoteGlobalAllowlistBusy(false);
    }
  }, [remoteGlobalAllowlistDraft]);

  const loadBrowserStorage = useCallback(async () => {
    setBrowserStorageLoading(true);
    setBrowserStorageError("");
    try {
      const response = await fetch("/api/browser/storage", { cache: "no-store" });
      const data = (await response.json()) as { origins?: typeof browserStorage; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load browser storage");
      setBrowserStorage(data.origins || []);
    } catch (error) {
      setBrowserStorageError(error instanceof Error ? error.message : "Could not load browser storage");
    } finally {
      setBrowserStorageLoading(false);
    }
  }, []);

  const createBrowserStorage = useCallback(async (origin: string) => {
    if (!browserStorageDraft.name.trim()) return;
    setBrowserStorageSaving(true);
    try {
      const response = await fetch("/api/browser/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, ...browserStorageDraft, name: browserStorageDraft.name.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not create browser storage entry");
      setBrowserStorageDraft((current) => ({ ...current, name: "", value: "" }));
      toast.success("Storage entry created");
      await loadBrowserStorage();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create browser storage entry");
    } finally {
      setBrowserStorageSaving(false);
    }
  }, [browserStorageDraft, loadBrowserStorage]);

  const clearBrowserStorage = useCallback(async (origin?: string) => {
    const response = await fetch("/api/browser/storage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(origin ? { origin } : { all: true }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not clear browser storage");
    toast.success(origin ? `Browser data cleared for ${origin}` : "All browser data cleared");
    await loadBrowserStorage();
  }, [loadBrowserStorage]);

  useEffect(() => {
   if (!open) {
    setSettingsPane("tab");
    setBrowserStorageQuery("");
    return;
   }
   if (settingsTab === "general" || settingsPane === "browser-storage") {
    void loadBrowserStorage();
   }
  }, [loadBrowserStorage, open, settingsPane, settingsTab]);

  const createRemoteEnrollment = useCallback(async (platform = remotePlatform) => {
    setRemoteBusy(true);
    setRemotePlatform(platform);
    setRemotePairExistingIds(remoteClients.map((client) => client.id));
    try {
      const response = await fetch("/api/remote-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ os: platform, permissionMode: remotePermissionMode }),
      });
      const data = (await response.json()) as { command?: string; commands?: { linux?: string; windows?: string; macos?: string }; token?: string; serverUrl?: string; installerUrl?: string; installerUrls?: Array<{ label: string; url: string }>; error?: string };
      if (!response.ok || !data.command) throw new Error(data.error || "Failed to create enrollment command");
      setRemoteCommand(data.command);
      setRemotePairToken(data.token || "");
      setRemoteServerUrl(data.serverUrl || "");
      setRemoteInstallerUrls(data.installerUrls || (platform === "windows" && data.installerUrl ? [{ label: "Windows installer", url: data.installerUrl }] : []));
      setRemoteCommands({
        linux: data.commands?.linux || data.command,
        windows: data.commands?.windows || "",
        macos: data.commands?.macos || "",
      });
      setRemotePairStep("install");
      if (platform !== "windows" && !data.installerUrls?.length) {
        await navigator.clipboard?.writeText(data.command);
        toast.success("Enrollment command copied");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create enrollment command");
    } finally {
      setRemoteBusy(false);
    }
  }, [remoteClients, remotePermissionMode, remotePlatform]);

  const copyRemoteCommand = useCallback(async () => {
    const command = remoteCommands?.[remotePlatform] || remoteCommand;
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Install command copied");
    } catch {
      toast.error("Could not copy install command");
    }
  }, [remoteCommand, remoteCommands, remotePlatform]);

  const testRemoteConnection = useCallback(async (client: RemoteClient) => {
    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}/test`, { method: "POST" });
    const data = (await response.json()) as { info?: { hostname?: string; os?: string; uptime?: number }; error?: string };
    if (!response.ok) {
      toast.error(data.error || "Connection test failed");
      return;
    }
    toast.success(`${data.info?.hostname || client.name} is connected`);
    await loadRemoteClients();
  }, [loadRemoteClients]);

  const updateRemotePolicy = useCallback(async (client: RemoteClient, policy: RemoteClient["policy"]) => {
    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Failed to update policy");
    }
    await loadRemoteClients();
  }, [loadRemoteClients]);

  const renameRemoteClient = useCallback(async (client: RemoteClient, name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === client.name) return;
    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (!response.ok) toast.error("Failed to rename remote client");
    else await loadRemoteClients();
  }, [loadRemoteClients]);

  const revokeRemoteClient = useCallback(async (client: RemoteClient) => {
    const response = await fetch(`/api/remote-clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error || "Failed to revoke client");
      return;
    }
    toast.success("Remote client removed");
    await loadRemoteClients();
  }, [loadRemoteClients]);

  useEffect(() => {
    if (!open || settingsTab !== "devices") return;
    void loadRemoteClients();
    void loadGlobalRemoteAllowlist();
    const timer = window.setInterval(() => void loadRemoteClients(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadRemoteClients, loadGlobalRemoteAllowlist, open, settingsTab]);
  useEffect(() => {
    if (!open || settingsTab !== "devices") return;
    for (const client of remoteClients) {
      if (client.status !== "online" || !client.capabilities?.includes("desktop_gui")) continue;
      if (desktopStatusChecked.current.has(client.id) || desktopStatusBusyId === client.id) continue;
      void checkDesktopPermissions(client);
    }
  }, [checkDesktopPermissions, desktopStatusBusyId, open, remoteClients, settingsTab]);
  useEffect(() => {
    if (remotePairStep !== "install") return;
    let active = true;
    const checkForConnection = async () => {
      try {
        const response = await fetch("/api/remote-clients", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { clients?: RemoteClient[] };
        if (!active) return;
        const clients = data.clients || [];
        setRemoteClients(clients);
        const knownIds = new Set(remotePairExistingIds);
        const connectedClient = clients.find((client) => !knownIds.has(client.id) && client.status === "online");
        if (connectedClient) {
          setRemotePairStep("finish");
          toast.success(`${connectedClient.name} connected`);
        }
      } catch {
        // The normal settings refresh will retry while the modal is open.
      }
    };
    void checkForConnection();
    const timer = window.setInterval(() => void checkForConnection(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [remotePairExistingIds, remotePairStep]);

  const loadArchivedChats = useCallback(async () => {
    setArchivedChatsLoaded(false);
    try {
      const res = await fetch("/api/chats?includeArchived=true", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load archived chats");
      const data = (await res.json()) as { chats?: ArchivedChat[] };
      const chats = data.chats || [];
      setArchivedChats(chats.filter((chat) => chat.archived));
      setSharedChats(chats.filter((chat) => chat.share?.active));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load archived chats");
    } finally {
      setArchivedChatsLoaded(true);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    const loadVersion = ++providerLoadVersionRef.current;
    setProvidersLoaded(false);
    setProvidersError("");
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load providers");
      const data = (await res.json()) as {
        providers?: ProviderDefinition[];
        connections?: ProviderConnection[];
      };
      if (loadVersion !== providerLoadVersionRef.current) return;
      setProviderDefinitions(data.providers || []);
      providerConnectionsRef.current = data.connections || [];
      setProviderConnections(providerConnectionsRef.current);
      const first = data.providers?.[0];
      if (first) {
        setProviderDraft((current) => {
          if (current.id) return current;
          if (data.providers?.some((provider) => provider.key === current.providerKey)) {
            return current.slug ? current : {
              ...current,
              ...newProviderConnectionIdentity(current.providerKey, providerConnectionsRef.current),
            };
          }
          return {
            ...current,
            providerKey: first.key,
            ...newProviderConnectionIdentity(first.key, providerConnectionsRef.current),
            label: first.name,
            authType: preferredAuthType(first),
            baseUrl: first.defaultBaseUrl || "",
          };
        });
      }
    } catch (error) {
      if (loadVersion === providerLoadVersionRef.current) {
        const message = error instanceof Error ? error.message : "Failed to load providers";
        setProvidersError(message);
        toast.error(message);
      }
    } finally {
      if (loadVersion === providerLoadVersionRef.current) setProvidersLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadArchivedChats();
      void loadProviders();
    }
  }, [loadArchivedChats, loadProviders, open]);

  async function updateArchivedChat(id: string, archived: boolean) {
    const res = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (!res.ok) {
      toast.error("Failed to update chat");
      return;
    }
    await loadArchivedChats();
    onChatsChanged();
    toast.success(archived ? "Chat archived" : "Chat restored");
  }

  async function deleteArchivedChat(id: string) {
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete chat");
      return;
    }
    await loadArchivedChats();
    onChatsChanged();
    toast.success("Chat deleted");
  }

  async function deactivateShare(chat: ArchivedChat) {
    const res = await fetch(`/api/chats/${chat.id}/share`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to deactivate share");
      return;
    }
    await loadArchivedChats();
    onChatsChanged();
    toast.success("Share link deactivated");
  }

  async function addMemory() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || "Could not add memory",
        );
      }
      setDraft("");
      onMemoriesChanged();
      toast.success("Memory saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add memory");
    } finally {
      setBusy(false);
    }
  }

  async function removeMemory(id: string) {
    if (deletingMemoryIds.has(id)) return;
    setDeletingMemoryIds((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      onMemoryDeleted(id);
      toast.success("Memory deleted");
    } catch {
      toast.error("Could not delete memory");
    } finally {
      setDeletingMemoryIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function resetProviderDraft() {
    setProviderAdding(true);
    setProviderDraft((current) => {
      const definition = providerDefinitions.find((provider) => provider.key === current.providerKey);
      return {
        ...current,
        ...newProviderConnectionIdentity(current.providerKey, providerConnectionsRef.current),
        label: definition?.name || current.providerKey,
        baseUrl: current.authType === "vertex_adc" ? "" : definition?.defaultBaseUrl || "",
        secret: "",
        project: "",
        location: "",
      };
    });
  }

  function selectProvider(providerKey: string) {
    const definition = providerDefinitions.find((provider) => provider.key === providerKey);
    setProviderDraft((current) => ({
      ...current,
      providerKey,
      authType: definition ? preferredAuthType(definition) : "api_key",
      baseUrl: definition?.defaultBaseUrl || "",
      ...(current.id ? {} : newProviderConnectionIdentity(providerKey, providerConnectionsRef.current)),
      label: current.id ? current.label : definition?.name || providerKey,
      secret: "",
      project: "",
      location: "",
    }));
  }

  function editProviderConnection(connection: ProviderConnection) {
    setProviderAdding(false);
    setProviderDraft(providerConnectionDraft(connection));
    onSettingsTabChange("models");
    setSettingsPane("providers");
  }

  async function saveProviderConnection() {
    if (providerBusy) return;
    setProviderBusy(true);
    try {
      const editableConfig =
        providerDraft.authType === "vertex_adc" ||
        (providerDraft.providerKey === "antigravity" && providerDraft.authType === "oauth")
          ? {
              ...(providerDraft.project.trim() ? { project: providerDraft.project.trim() } : {}),
              ...(providerDraft.authType === "vertex_adc" && providerDraft.location.trim()
                ? { location: providerDraft.location.trim() }
                : {}),
            }
          : undefined;
      const body: Record<string, unknown> = providerDraft.id
        ? {
            label: providerDraft.label.trim(),
            ...(providerDraft.authType !== "oauth" ? { baseUrl: providerDraft.baseUrl.trim() } : {}),
            ...(providerDraft.secret ? { secret: providerDraft.secret } : {}),
            ...(editableConfig ? { config: editableConfig } : {}),
          }
        : {
            providerKey: providerDraft.providerKey,
            slug: providerDraft.slug.trim(),
            label: providerDraft.label.trim(),
            authType: providerDraft.authType,
            ...(providerDraft.baseUrl.trim() ? { baseUrl: providerDraft.baseUrl.trim() } : {}),
            ...(providerDraft.secret ? { secret: providerDraft.secret } : {}),
            ...(editableConfig ? { config: editableConfig } : {}),
          };
      const res = await fetch(
        providerDraft.id ? `/api/providers/${encodeURIComponent(providerDraft.id)}` : "/api/providers",
        {
          method: providerDraft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        connection?: ProviderConnection;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to save provider connection");
      await loadProviders();
      onModelsChanged?.();
      if (data.connection) editProviderConnection(data.connection);
      toast.success("Provider connection saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save provider connection");
    } finally {
      setProviderBusy(false);
    }
  }

  async function connectProviderOAuth() {
    if (providerBusy) return;
    setProviderBusy(true);
    setOauthFlow(null);
    setOauthCode("");
    let openedAuthUrl = false;
    try {
      const res = await fetch("/api/providers/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: providerDraft.id,
          providerKey: providerDraft.providerKey,
          slug: providerDraft.slug.trim(),
          label: providerDraft.label.trim(),
          ...(providerDraft.providerKey === "antigravity" && providerDraft.project.trim()
            ? { config: { project: providerDraft.project.trim() } }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        flow?: OAuthFlow;
        error?: string;
      };
      if (!res.ok || !data.flow) throw new Error(data.error || "Failed to start OAuth login");
      setOauthFlow(data.flow);

      for (let attempt = 0; attempt < 600; attempt += 1) {
        const statusRes = await fetch(
          `/api/providers/oauth/status?flowId=${encodeURIComponent(data.flow.id)}`,
          { cache: "no-store" },
        );
        const statusData = (await statusRes.json().catch(() => ({}))) as {
          flow?: OAuthFlow;
          error?: string;
        };
        if (!statusRes.ok || !statusData.flow) {
          throw new Error(statusData.error || "Failed to read OAuth status");
        }
        const nextFlow = statusData.flow;
        setOauthFlow(nextFlow);
        if (nextFlow.authUrl && !openedAuthUrl) {
          openedAuthUrl = true;
          const popup = window.open(nextFlow.authUrl, "_blank", "noopener,noreferrer");
          if (!popup) toast.info("Open the OAuth link shown below to continue.");
        }
        if (["completed", "error", "cancelled"].includes(nextFlow.status)) {
          await loadProviders();
          onModelsChanged?.();
          if (nextFlow.status === "completed") {
            const connection = providerConnectionsRef.current.find(item => item.id === nextFlow.connectionId);
            if (connection) editProviderConnection(connection);
            toast.success("OAuth connection completed");
          } else if (nextFlow.error) {
            toast.error(nextFlow.error);
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      throw new Error("OAuth login timed out.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OAuth login failed");
    } finally {
      setProviderBusy(false);
    }
  }

  async function submitOAuthCode() {
    if (!oauthFlow || !oauthCode.trim()) return;
    const res = await fetch("/api/providers/oauth/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flowId: oauthFlow.id, code: oauthCode.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(data.error || "Failed to submit OAuth code");
      return;
    }
    setOauthCode("");
    toast.success("OAuth code submitted");
  }

  async function toggleProviderConnection(connection: ProviderConnection) {
    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !connection.enabled }),
    });
    if (!res.ok) {
      toast.error("Failed to update provider connection");
      return;
    }
    await loadProviders();
    onModelsChanged?.();
  }

  async function testProviderConnection(connection: ProviderConnection) {
    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/test`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    if (!res.ok) {
      toast.error(data.error || "Provider connection failed");
      await loadProviders();
      onModelsChanged?.();
      return;
    }
    toast.success(data.detail || "Provider connection is ready");
    await loadProviders();
    onModelsChanged?.();
  }

  async function discoverProviderModels(connection: ProviderConnection) {
    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/discover`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { models?: unknown[]; error?: string };
    if (!res.ok) {
      toast.error(data.error || "Model discovery failed");
      return;
    }
    toast.success(`${data.models?.length || 0} models discovered`);
    await loadProviders();
    onModelsChanged?.();
  }

  async function deleteProviderConnection(connection: ProviderConnection) {
    const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(data.error || "Failed to delete provider connection");
      return;
    }

    // Remove it from the visible settings state immediately. A slower, older
    // providers request must not be able to resurrect a connection that was
    // already deleted.
    providerLoadVersionRef.current += 1;
    providerConnectionsRef.current = providerConnectionsRef.current.filter((item) => item.id !== connection.id);
    setProviderConnections(providerConnectionsRef.current);
    if (providerDraft.id === connection.id) {
      const definition = providerDefinitions.find((provider) => provider.key === connection.providerKey);
      setProviderDraft((current) => ({
        ...current,
        ...newProviderConnectionIdentity(connection.providerKey, providerConnectionsRef.current),
        label: definition?.name || connection.providerKey,
        authType: definition ? preferredAuthType(definition) : current.authType,
        baseUrl: definition?.defaultBaseUrl || "",
        secret: "",
        project: "",
        location: "",
      }));
    }
    onModelsChanged?.();
    void onRefreshUsage();
    await loadProviders();
    toast.success("Provider connection deleted");
  }



  function handleFinishSoundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Custom sounds must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      onFinishSoundChange({ name: file.name, dataUrl: reader.result });
      toast.success("Custom finish sound saved");
    };
    reader.onerror = () => toast.error("Could not read the audio file.");
    reader.readAsDataURL(file);
  }

  const filteredBrowserStorage = browserStorage.filter((item) => {
   const query = String(browserStorageQuery ?? "").trim().toLowerCase();
   if (!query) return true;
   return String(item.origin ?? "").toLowerCase().includes(query) || item.storageTypes.some((type) => String(type ?? "").toLowerCase().includes(query));
  });

  useEffect(() => {
    if (settingsPane !== "providers" || !providersLoaded || providerAdding || providerDraft.id) return;
    const connection = [...providerConnections].sort((a, b) => {
      const aName = providerDefinitions.find(provider => provider.key === a.providerKey)?.name || a.providerKey;
      const bName = providerDefinitions.find(provider => provider.key === b.providerKey)?.name || b.providerKey;
      return `${aName} ${a.label}`.localeCompare(`${bName} ${b.label}`);
    })[0];
    if (connection) setProviderDraft(providerConnectionDraft(connection));
  }, [settingsPane, providersLoaded, providerAdding, providerDraft.id, providerConnections, providerDefinitions]);

  const selectedProviderConnection = providerConnections.find(connection => connection.id === providerDraft.id);
  const selectedProviderDefinition = providerDefinitions.find(provider => provider.key === providerDraft.providerKey);
  const selectableProviders = providerDefinitions;
  const sortedProviderConnections = [...providerConnections].sort((a, b) => {
    const aName = providerDefinitions.find((provider) => provider.key === a.providerKey)?.name || a.providerKey;
    const bName = providerDefinitions.find((provider) => provider.key === b.providerKey)?.name || b.providerKey;
    return `${aName} ${a.label}`.localeCompare(`${bName} ${b.label}`);
  });

  return (
    <>
      <section aria-label="Settings" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-8 sm:py-4 sm:pr-12">
          <SettingsSearch key={String(open)} isHostAdmin={isHostAdmin} mobile={mobile} onSelect={openSettingsSearchResult} />
        </header>

        <UpdateStatusProbe isHostAdmin={Boolean(isHostAdmin)} onUpdateAvailableChange={setUpdateAvailable} />
        {mobile && mobileMenuOpen ? (
          <div ref={settingsContentRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-slot="settings-mobile-menu">
            <div className="flex min-h-full flex-col gap-4 px-3 py-3">
              <nav aria-label="Settings categories" className="divide-y divide-border/60">
                {SETTINGS_TABS.map(tab => (
                  <SettingsTile key={tab.value} id={`settings-category-${tab.value}`}
                    title={settingsCategoryLabel(tab, isHostAdmin, updateAvailable)}
                    meta={tab.value === "admin" && isHostAdmin ? "Users, chats and maintenance" : tab.value === "updates" && !isHostAdmin ? "Managed by your host administrator" : SETTINGS_CATEGORY_DESCRIPTIONS[tab.value]}
                    icon={settingsCategoryIcon(tab.value)}
                    onOpen={() => openSettingsCategory(tab.value)} />
                ))}
              </nav>
              <div className="mt-auto border-t border-border/60 pt-2 pb-[env(safe-area-inset-bottom)]">
                <SettingsExternalLinks />
              </div>
            </div>
          </div>
        ) : (
        <Tabs value={settingsTab} onValueChange={openSettingsCategory} className="min-h-0 flex-1 gap-0 lg:grid lg:items-stretch lg:grid-cols-[13rem_minmax(0,1fr)]">
          {mobile ? settingsPane === "tab" ? (
            <div className="shrink-0 border-b border-border px-4 py-1">
              <button type="button" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={backToSettingsMenu}>
                <ArrowLeft aria-hidden="true" className="size-4" /> Back to Settings
              </button>
            </div>
          ) : null : (
          <div className="border-b border-border px-4 py-2 lg:hidden">
            <CustomSelect
              value={settingsTab}
              onValueChange={openSettingsCategory}
              ariaLabel="Settings section"
              className="h-10 w-full"
              options={[
                { value: "general", label: "General" },
                { value: "models", label: "Models" },
                { value: "agent", label: "Agent" },
 { value: "devices", label: "Devices" },
 { value: "admin", label: isHostAdmin ? "Admin" : "Chats" },
 { value: "updates", label: updateAvailable ? "Update Available" : "Updates" },
              ]}
            />
          </div>
          )}
          <TabsList className="hidden h-auto w-full shrink-0 flex-wrap justify-start gap-1.5 rounded-none border-b border-border bg-muted/20 px-3 py-3 lg:flex lg:h-full lg:min-h-0 lg:flex-nowrap lg:flex-col lg:items-stretch lg:justify-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
           {SETTINGS_TABS.map((tab) => {
           const Icon = settingsCategoryIcon(tab.value);
           const label = settingsCategoryLabel(tab, isHostAdmin, updateAvailable);
           const expanded = settingsTab === tab.value;
           return (
           <Fragment key={tab.value}>
           <TabsTrigger
             value={tab.value}
             onClick={() => openSettingsCategory(tab.value)}
             className={cn(
               "min-h-10 w-full justify-start px-2.5 py-2.5 pl-4 has-data-[icon=inline-start]:pl-4 lg:h-auto lg:flex-none",
               tab.value === "updates" && updateAvailable && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
             )}
           >
           <Icon data-icon="inline-start" />
           {label}
           </TabsTrigger>
           {expanded
           ? settingsOverviewSections(tab.value, isHostAdmin).map((item) => (
           <button
            key={item.id}
            type="button"
            className={cn(
            "ml-2 hidden w-[calc(100%-0.5rem)] truncate rounded-md border-l border-border/40 py-1 pl-4 pr-2.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:block",
            SETTINGS_SECTION_TO_PANE[item.id] === settingsPane && "bg-muted/60 text-foreground",
            )}
            onClick={() => {
            const pane = SETTINGS_SECTION_TO_PANE[item.id];
            if (pane) {
            openSettingsPane(pane);
            return;
            }
            setSettingsPane("tab");
            setSettingsSearchTarget(item.id);
            }}
            >
           {item.label}
           </button>
           ))
           : null}
           </Fragment>
           );
           })}
          </TabsList>

          <div ref={settingsContentRef} className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
 {settingsPane === "browser-storage" ? (
 <div
 className="flex h-full min-h-0 flex-col gap-5 px-6 py-6 sm:px-8 sm:py-8"
 data-slot="browser-storage-manager"
 >
 <button
 type="button"
 className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
 onClick={() => openSettingsPane("browser")}
 >
 <ArrowLeft className="size-3.5" />
 Back to Browser
 </button>
 <div className="flex items-start justify-between gap-3">
 <div>
 <h3 className="text-sm font-medium">Browser storage</h3>
 <p className="mt-1 text-xs text-muted-foreground">
 Persistent website sessions are stored privately for your account. Search the list and clear individual origins without scrolling General.
 </p>
 </div>
 <Button type="button" variant="destructive" size="sm" onClick={() => setBrowserStorageClearAll(true)} disabled={!browserStorage.length}>
 Clear all
 </Button>
 </div>
 <Input
 value={browserStorageQuery}
 onChange={(event) => setBrowserStorageQuery(event.target.value)}
 placeholder="Search websites"
 aria-label="Search stored websites"
 />
 {browserStorageLoading ? <p className="text-xs text-muted-foreground">Loading stored websites…</p> : null}
 {browserStorageError ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{browserStorageError}</p> : null}
 {!browserStorageLoading && !browserStorageError && !browserStorage.length ? (
 <p className="rounded-md border border-border/60 p-4 text-xs text-muted-foreground">No persistent website data stored yet.</p>
 ) : null}
 {!browserStorageLoading && !browserStorageError && browserStorage.length > 0 && filteredBrowserStorage.length === 0 ? (
 <p className="rounded-md border border-border/60 p-4 text-xs text-muted-foreground">No websites match that search.</p>
 ) : null}
 <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
 {filteredBrowserStorage.map((item) => {
   const expanded = expandedBrowserOrigin === item.origin;
   return (
   <div key={item.origin} className="rounded-md border border-border/60">
     <div className="flex items-center gap-3 p-3">
       <button
         type="button"
         className="flex min-w-0 flex-1 items-start gap-2 text-left"
         aria-expanded={expanded}
         onClick={() => setExpandedBrowserOrigin(expanded ? null : item.origin)}
       >
         <ChevronDown className={cn("mt-0.5 size-4 shrink-0 transition-transform", !expanded && "-rotate-90")} />
         <span className="min-w-0">
           <span className="block truncate text-sm">{item.origin}</span>
           <span className="mt-1 block text-[11px] text-muted-foreground">
             {item.storageTypes.join(" · ")} · {item.sizeBytes.toLocaleString("en")} bytes
           </span>
         </span>
       </button>
       <Button type="button" variant="outline" size="sm" onClick={() => setBrowserStorageDeleteTarget(item.origin)}>
         Clear
       </Button>
     </div>
     {expanded ? (
       <div className="space-y-4 border-t border-border/60 bg-muted/10 p-3">
         <div className="space-y-2">
           <p className="text-xs font-medium">Cookies</p>
           {item.cookies.length ? item.cookies.map((cookie) => (
             <div key={`${cookie.domain}:${cookie.path}:${cookie.name}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
               <span className="font-medium">{cookie.name}</span>
               <span className="text-muted-foreground">{cookie.domain}{cookie.path} · {cookie.size} bytes</span>
             </div>
           )) : <p className="text-xs text-muted-foreground">No cookies.</p>}
         </div>
         {(["localStorage", "sessionStorage"] as const).map((storageType) => (
           <div key={storageType} className="space-y-2">
             <p className="text-xs font-medium">{storageType}</p>
             {item[storageType].length ? item[storageType].map((entry) => (
               <div key={entry.key} className="grid gap-1 text-xs sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)]">
                 <span className="font-medium break-all">{entry.key}</span>
                 <span className="break-all text-muted-foreground">{entry.value}</span>
               </div>
             )) : <p className="text-xs text-muted-foreground">No entries available for an open page.</p>}
           </div>
         ))}
         <form className="space-y-2 border-t border-border/60 pt-3" onSubmit={(event) => { event.preventDefault(); void createBrowserStorage(item.origin); }}>
           <p className="text-xs font-medium">Add entry</p>
           <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
             <select
               value={browserStorageDraft.type}
               onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, type: event.target.value as typeof current.type }))}
               className="h-9 rounded-md border border-input bg-background px-3 text-sm"
               aria-label="Storage entry type"
             >
               <option value="cookie">Cookie</option>
               <option value="localStorage">localStorage</option>
               <option value="sessionStorage">sessionStorage</option>
             </select>
             <Input value={browserStorageDraft.name} onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name or key" aria-label="Storage entry name" />
           </div>
           <Input value={browserStorageDraft.value} onChange={(event) => setBrowserStorageDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Value" aria-label="Storage entry value" />
           <Button type="submit" size="sm" disabled={browserStorageSaving || !browserStorageDraft.name.trim()}>
             {browserStorageSaving ? "Adding…" : "Add entry"}
           </Button>
         </form>
       </div>
     ) : null}
   </div>
   );
 })}
 </div>
 </div>
 ) : settingsPane === "model-chains" ? (
 <SettingsFeaturePane backLabel="Models" slot="model-chains-manager" onBack={() => backToSettings("settings-model-chains")}><ModelChainsPanel models={models}/></SettingsFeaturePane>
 ) : settingsPane === "providers" ? (
 <SettingsFeaturePane
 backLabel="Models"
 slot="providers-manager"
 onBack={() => backToSettings("settings-providers")}
 >
<div className="@container/providers min-w-0">
   <ProviderSettingsLayout
     connections={sortedProviderConnections}
     definitions={providerDefinitions}
     selectedId={providerDraft.id}
     adding={providerAdding}
     loaded={providersLoaded}
     error={providersError}
     busy={providerBusy}
     onSelect={id => {
       const connection = providerConnections.find(item => item.id === id);
       if (connection) editProviderConnection(connection);
     }}
     onAdd={resetProviderDraft}
     onRefresh={loadProviders}
     onToggle={async id => {
       const connection = providerConnections.find(item => item.id === id);
       if (connection) await toggleProviderConnection(connection);
     }}
   >
     {!providersLoaded && !providerConnections.length ? (
       <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading provider settings…</p>
     ) : !selectedProviderConnection && !providerAdding ? (
       <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
         <PlugZap aria-hidden="true" className="size-7 text-muted-foreground" />
         <p className="text-sm font-medium">Connect your first provider</p>
         <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">Add an API, account, CLI, or local connection.</p>
         <Button type="button" variant="outline" disabled={!providersLoaded || !providerDefinitions.length} onClick={resetProviderDraft}><Plus aria-hidden="true" className="size-4" /> Add provider</Button>
       </div>
     ) : (
       <div id="provider-connection-form" className="min-w-0">
         <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border/60 pb-4">
           <div className="flex min-w-0 items-start gap-3">
             <ProviderLogo providerId={providerDraft.providerKey} className="mt-0.5 size-5 shrink-0" />
             <div className="min-w-0">
               <h4 className="break-words text-sm font-semibold">{providerAdding ? "Add provider" : selectedProviderConnection?.label}</h4>
               <p className="mt-1 text-xs text-muted-foreground">{selectedProviderDefinition?.name || providerDraft.providerKey}</p>
             </div>
           </div>
           {selectedProviderConnection ? (
             <Button type="button" size="sm" variant="outline" disabled={providerBusy || !providersLoaded} onClick={() => void testProviderConnection(selectedProviderConnection)}>
               <PlugZap aria-hidden="true" className="size-3.5" /> Test
             </Button>
           ) : null}
         </div>
         {selectedProviderConnection ? (
           <div className="border-b border-border/60 py-4">
             <p className="text-sm font-medium">Status</p>
             <p className={cn("mt-1 text-xs", selectedProviderConnection.enabled && selectedProviderConnection.lastError ? "text-destructive" : "text-muted-foreground")}>
               {providerConnectionStatus(selectedProviderConnection)}
               {selectedProviderConnection.lastCheckedAt ? ` · Checked ${new Date(selectedProviderConnection.lastCheckedAt).toLocaleString("en-GB")}` : ""}
             </p>
             {selectedProviderConnection.lastError ? <p className="mt-2 break-words text-xs text-destructive">{selectedProviderConnection.lastError}</p> : null}
           </div>
         ) : null}
         <fieldset disabled={providerBusy || !providersLoaded} className="min-w-0 disabled:opacity-60">
           <legend className="sr-only">Provider connection settings</legend>
           {providerAdding ? (
             <ProviderSettingsRow label="Provider">
               <CustomSelect value={providerDraft.providerKey} onValueChange={selectProvider} ariaLabel="Provider" className="w-full"
                 options={selectableProviders.map(provider => ({ value: provider.key, label: provider.name, providerLogo: provider.key }))} />
             </ProviderSettingsRow>
           ) : null}
           <ProviderSettingsRow label="Display name" htmlFor="provider-display-name" description="The name shown in your model picker.">
             <Input id="provider-display-name" value={providerDraft.label} onChange={event => setProviderDraft(current => ({ ...current, label: event.target.value }))} aria-label="Connection name" />
           </ProviderSettingsRow>
           <ProviderSettingsRow label="Connection ID" htmlFor="provider-connection-id" description="A unique identifier for this connection.">
             <Input id="provider-connection-id" value={providerDraft.slug} onChange={event => setProviderDraft(current => ({ ...current, slug: event.target.value }))} disabled={Boolean(providerDraft.id)} aria-label="Connection ID" />
           </ProviderSettingsRow>
           <h5 className="pt-6 pb-1 text-sm font-semibold">Authentication</h5>
           <ProviderSettingsRow label="Method">
             <CustomSelect value={providerDraft.authType}
               onValueChange={authType => setProviderDraft(current => ({ ...current, authType }))}
               ariaLabel="Authentication method" disabled={Boolean(providerDraft.id)} className="w-full"
               options={(selectedProviderDefinition?.authTypes || []).map(authType => ({
                 value: authType,
                 label: authType === "api_key"
                   ? (providerDraft.providerKey === "antigravity" ? "Gemini API key (SDK)" : "API key")
                   : authType === "oauth"
                     ? (providerDraft.providerKey === "antigravity" ? "OAuth (agy CLI)" : "OAuth")
                     : authType === "vertex_adc" ? "Google Vertex / ADC"
                       : authType === "account" ? "Official account credentials"
                         : authType === "local" ? "CLI on this machine" : "Local endpoint",
               }))} />
           </ProviderSettingsRow>
           {providerDraft.authType !== "local" && providerDraft.authType !== "vertex_adc" && providerDraft.authType !== "oauth" ? (
             <ProviderSettingsRow label={providerDraft.authType === "account" ? "Account credentials" : "API key"} htmlFor="provider-credential"
               description={selectedProviderConnection?.hasSecret ? "Leave blank to keep your saved credentials." : "Stored securely. This value is write-only."}>
               <Input id="provider-credential" type="password" value={providerDraft.secret}
                 onChange={event => setProviderDraft(current => ({ ...current, secret: event.target.value }))}
                 placeholder={providerDraft.authType === "account" ? "Paste auth.json content" : selectedProviderConnection?.hasSecret ? "Credentials saved" : "Enter API key"}
                 aria-label="Provider credential" autoComplete="new-password" />
               {providerDraft.authType === "api_key" && API_KEY_URLS[providerDraft.providerKey] ? (
                 <a href={API_KEY_URLS[providerDraft.providerKey]} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary underline underline-offset-2">
                   Get {selectedProviderDefinition?.name || "provider"} API key
                 </a>
               ) : null}
             </ProviderSettingsRow>
           ) : null}
           {providerDraft.authType === "vertex_adc" || (providerDraft.providerKey === "antigravity" && providerDraft.authType === "oauth") ? (
             <>
               <h5 className="pt-6 pb-1 text-sm font-semibold">Google Cloud</h5>
               <ProviderSettingsRow label="Project" htmlFor="provider-gcp-project" description={providerDraft.authType === "oauth" ? "Optional. Required for workspace accounts." : "Your Google Cloud project."}>
                 <Input id="provider-gcp-project" value={providerDraft.project} onChange={event => setProviderDraft(current => ({ ...current, project: event.target.value }))} aria-label="GCP project" />
               </ProviderSettingsRow>
               {providerDraft.authType === "vertex_adc" ? (
                 <ProviderSettingsRow label="Location" htmlFor="provider-gcp-location">
                   <Input id="provider-gcp-location" value={providerDraft.location} onChange={event => setProviderDraft(current => ({ ...current, location: event.target.value }))} placeholder="us-central1" aria-label="GCP location" />
                 </ProviderSettingsRow>
               ) : null}
             </>
           ) : providerDraft.providerKey !== "cursor" && providerDraft.providerKey !== "grok-build" && providerDraft.providerKey !== "opencode" && providerDraft.authType !== "oauth" && providerDraft.authType !== "local" ? (
             <>
               <h5 className="pt-6 pb-1 text-sm font-semibold">Connection</h5>
               <ProviderSettingsRow label="Base URL" htmlFor="provider-base-url" description="The API endpoint for this connection.">
                 <Input id="provider-base-url" value={providerDraft.baseUrl} onChange={event => setProviderDraft(current => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" aria-label="Provider base URL" />
               </ProviderSettingsRow>
             </>
           ) : null}
           {selectedProviderDefinition?.setupHint ? <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{selectedProviderDefinition.setupHint}</p> : null}
           <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
             {providerDraft.authType === "oauth" ? (
               <>
                 {providerDraft.id ? <Button type="button" onClick={() => void saveProviderConnection()} disabled={providerBusy || !providersLoaded || !providerDraft.label.trim()}>{providerBusy ? "Saving…" : "Save changes"}</Button> : null}
                 <Button type="button" variant={providerDraft.id ? "outline" : "default"} onClick={() => void connectProviderOAuth()} disabled={providerBusy || !providersLoaded || !providerDraft.label.trim()}>
                   {providerBusy ? "Connecting…" : providerDraft.id ? "Reconnect OAuth" : "Connect via OAuth"}
                 </Button>
               </>
             ) : (
               <Button type="button" onClick={() => void saveProviderConnection()} disabled={providerBusy || !providersLoaded || !providerDraft.label.trim()}>
                 {providerBusy ? "Saving…" : providerDraft.id ? "Save changes" : "Save connection"}
               </Button>
             )}
             {providerAdding ? (
               <Button type="button" variant="ghost" onClick={() => { setProviderAdding(false); setProviderDraft(current => ({ ...current, id: "", secret: "" })); }} disabled={providerBusy}>Cancel</Button>
             ) : null}
           </div>
         </fieldset>
                {oauthFlow ? (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div>
                      <p className="text-sm font-medium">
                        OAuth: {oauthFlow.status}
                      </p>
                      {oauthFlow.instructions ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {oauthFlow.instructions}
                        </p>
                      ) : null}
                    </div>
                    {oauthFlow.authUrl ? (
                      <a
                        href={oauthFlow.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-xs text-primary underline underline-offset-2"
                      >
                        Open OAuth authorization link
                      </a>
                    ) : null}
                    {oauthFlow.userCode ? (
                      <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Device code
                        </p>
                        <p className="mt-1 select-all font-mono text-xl font-semibold tracking-[0.18em] text-foreground">
                          {oauthFlow.userCode}
                        </p>
                      </div>
                    ) : null}
                    {oauthFlow.manualInputRequired ? (
                      <div className="flex gap-2">
                        <Input
                          value={oauthCode}
                          onChange={(event) => setOauthCode(event.target.value)}
                          placeholder="Code or complete callback URL"
                          aria-label="OAuth code or callback URL"
                        />
                        <Button type="button" onClick={() => void submitOAuthCode()} disabled={!oauthCode.trim()}>
                          Submit
                        </Button>
                      </div>
                    ) : null}
                    {oauthFlow.providerKey === "claude-code" ? (
                      <p className="text-xs text-amber-400">
                        Claude OAuth is an experimental personal-use flow and may conflict with Anthropic's current third-party usage restrictions.
                      </p>
                    ) : null}
                    {oauthFlow.providerKey === "antigravity" ? (
                      <p className="text-xs text-amber-400">
                        Antigravity OAuth uses the official agy CLI remote-login flow and stores its token profile per connection.
                      </p>
                    ) : null}
                    {oauthFlow.error ? (
                      <p className="text-xs text-red-400">{oauthFlow.error}</p>
                    ) : null}
                  </div>
                ) : null}

         {selectedProviderConnection ? (
           <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
             <Button type="button" size="sm" variant="ghost" disabled={providerBusy || !providersLoaded} onClick={() => void discoverProviderModels(selectedProviderConnection)}>
               <RefreshCw aria-hidden="true" className="size-3.5" /> Refresh models
             </Button>
             <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={providerBusy || !providersLoaded} onClick={() => setDeleteTarget({ type: "provider", item: selectedProviderConnection })}>
               <Trash2 aria-hidden="true" className="size-3.5" /> Delete connection
             </Button>
           </div>
         ) : null}
       </div>
     )}
   </ProviderSettingsLayout>
 </div>
 </SettingsFeaturePane>
 ) : settingsPane === "versions" ? (
 <SettingsFeaturePane
 backLabel="Models"
 title="CLI versions"
 description="Installed agent CLI and SDK versions on this server."
 slot="versions-manager"
 onBack={() => backToSettings("settings-versions")}
 >
 <CliVersionsPanel isHostAdmin={Boolean(isHostAdmin)} />
 </SettingsFeaturePane>
 ) : settingsPane === "memories" ? (
 <SettingsFeaturePane
 backLabel="Agent"
 slot="memories-manager"
 onBack={() => backToSettings("settings-memories")}
 >
<section className="flex flex-col gap-3">
                <div>
                  <h3 id="settings-memories" className="text-sm font-medium">Memories</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Global facts and preferences shared across chats. Projects manage their own memories in the Memories dialog; Include global memory controls whether their agents can read or write this list.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Add a memory…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addMemory();
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    onClick={() => void addMemory()}
                    disabled={busy || !draft.trim()}
                    aria-label="Add memory"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <ul className="flex flex-col gap-2">
                  {memories.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                      No memories yet.
                    </li>
                  ) : (
                    memories.map((m) => (
                      <li
                        key={m.id}
                        className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm whitespace-pre-wrap">
                            {m.content}
                          </p>
                          {m.tags && m.tags.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {m.tags.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-100 sm:opacity-60 sm:group-hover:opacity-100"
                          onClick={() => void removeMemory(m.id)}
                          disabled={deletingMemoryIds.has(m.id)}
                          aria-label="Delete memory"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </section>
 </SettingsFeaturePane>
 ) : settingsPane === "appearance" ? (
   <SettingsFeaturePane backLabel="General" title="Appearance" description="Choose a preset or create, import and export a custom JSON theme." slot="appearance-manager" onBack={() => backToSettings("settings-appearance")}>
     <AppearanceSettings />
   </SettingsFeaturePane>
 ) : settingsPane === "dictionary" ? (
   <SettingsFeaturePane backLabel="Voice & dictionary" title="Dictionary" description="Manage words and phrases for voice transcription." slot="voice-dictionary" onBack={() => openSettingsPane("voice")}>
     <VoiceDictionarySettings />
   </SettingsFeaturePane>
 ) : settingsPane === "agent-settings" ? (
   <SettingsFeaturePane backLabel="Agent" title="Runtime & recovery" description="Choose runtime limits and how agents recover from provider limits." slot="agent-settings" onBack={() => backToSettings("settings-agent-runtime")}>
     <AgentRuntimeSettings />
     <ProviderLimitSettings />
     <ProviderRetrySettings />
   </SettingsFeaturePane>
 ) : settingsPane === "attachments" ? (
 <SettingsFeaturePane backLabel="General" title="Attachments" slot="attachment-settings" onBack={() => backToSettings("settings-attachments")}>
 <AttachmentSettings />
 </SettingsFeaturePane>
 ) : settingsPane === "subagent-model" ? (
 <SettingsFeaturePane backLabel="Agent" slot="subagent-model-settings" onBack={() => backToSettings("settings-subagent-model")}>
 <section className="flex flex-col gap-4">
                  <h3 id="settings-subagent-model" className="text-sm font-medium">Subagent model</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optionally use one model for delegated subagents. When disabled, the agent chooses the model.
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">Use a standard model</p>
                    <Button
                      type="button"
                      variant={subagentModelEnabled ? "default" : "outline"}
                      aria-pressed={subagentModelEnabled}
                      onClick={() => onSubagentModelEnabledChange(!subagentModelEnabled)}
                      className="shrink-0"
                    >
                      {subagentModelEnabled ? "On" : "Off"}
                    </Button>
                  </div>
                  <div className="mt-3 flex min-w-0 items-center gap-1">
                    <ModelPicker
                      models={models}
                      value={subagentModelId}
                      onValueChange={onSubagentModelIdChange}
                      favoriteModelKeys={favoriteModelKeys}
                      onToggleFavorite={onToggleFavoriteModel}
                      disabled={!subagentModelEnabled}
                      className="min-w-0 flex-1"
                    />
                    {modelForSelection(models, subagentModelId) ? (
                      <ModelOptionsMenu
                        model={modelForSelection(models, subagentModelId)!}
                        modelParams={subagentModelParams}
                        onModelParamsChange={onSubagentModelParamsChange}
                        className="opacity-100"
                      />
                    ) : null}
                  </div>
 </section>
 </SettingsFeaturePane>
 ) : settingsPane === "compression" ? (
 <SettingsFeaturePane backLabel="Agent" slot="compression-settings" onBack={() => backToSettings("settings-token-compression")}>
 <section className="flex flex-col gap-5">
                <div>
                  <h3 id="settings-token-compression" className="text-sm font-medium">Token compression</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reduce noisy tool output and redundant context before it reaches the model.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
                  <div>
                    <p className="text-sm font-medium">Enable compression</p>
                    <p className="mt-1 text-xs text-muted-foreground">Disabled by default and isolated per user.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={compressionEnabled ? "default" : "outline"}
                    aria-pressed={compressionEnabled}
                    onClick={() => onCompressionSettingsChange({ enabled: !compressionEnabled })}
                  >
                    {compressionEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <label className="flex flex-col gap-2 text-xs font-medium">
                  Mode
                  <select
                    value={compressionMode}
                    disabled={!compressionEnabled}
                    onChange={(event) => onCompressionSettingsChange({ mode: event.target.value as typeof compressionMode })}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal"
                  >
                    <option value="lite">Lite — low risk cleanup</option>
                    <option value="standard">Standard — prose condensation</option>
                    <option value="aggressive">Aggressive — stronger compression</option>
                    <option value="rtk">RTK — terminal and tool output</option>
                    <option value="stacked">Stacked — RTK + Caveman (recommended)</option>
                    <option value="ultra">Ultra — maximum context recovery</option>
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant={compressionToolResults ? "secondary" : "outline"} disabled={!compressionEnabled} onClick={() => onCompressionSettingsChange({ compressToolResults: !compressionToolResults })}>
                    Tool results: {compressionToolResults ? "On" : "Off"}
                  </Button>
                  <Button type="button" variant={compressionChatHistory ? "secondary" : "outline"} disabled={!compressionEnabled} onClick={() => onCompressionSettingsChange({ compressChatHistory: !compressionChatHistory })}>
                    Chat history: {compressionChatHistory ? "On" : "Off"}
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <div>
                    <p className="text-sm font-medium">Preview</p>
                    <p className="mt-1 text-xs text-muted-foreground">The sample is sent only for this preview and is never stored.</p>
                  </div>
                  <Textarea value={compressionPreview} onChange={(event) => setCompressionPreview(event.target.value)} placeholder="Paste a terminal log or verbose context sample…" rows={6} />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!compressionPreview.trim() || compressionPreviewBusy}
                    onClick={async () => {
                      setCompressionPreviewBusy(true);
                      try {
                        const response = await fetch("/api/compression/preview", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ text: compressionPreview, mode: compressionMode }),
                        });
                        const data = await response.json() as typeof compressionPreviewResult & { error?: string };
                        if (!response.ok) throw new Error(data.error || "Preview failed");
                        setCompressionPreviewResult(data);
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Preview failed");
                      } finally {
                        setCompressionPreviewBusy(false);
                      }
                    }}
                  >
                    {compressionPreviewBusy ? "Analyzing…" : "Analyze preview"}
                  </Button>
                  {compressionPreviewResult ? (
                    <div className="rounded-md bg-muted/40 p-3 text-xs">
                      <p>{compressionPreviewResult.inputChars} → {compressionPreviewResult.outputChars} characters ({compressionPreviewResult.savingsPercent}% reduced)</p>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{compressionPreviewResult.text}</pre>
                    </div>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Aggressive and ultra modes can remove wording. Code blocks, URLs, paths and structured data are protected where possible.
                </p>
              </section>
 </SettingsFeaturePane>
 ) : settingsPane === "notifications" ? (
 <SettingsFeaturePane backLabel="General" slot="notification-settings" onBack={() => backToSettings("settings-notifications")}>
 <section className="flex flex-col gap-4">
                <div>
                  <h3 id="settings-notifications" className="text-sm font-medium">Notifications</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Get notified when the agent needs input or finishes a
                    response.
                  </p>
                </div>
                <RemoteNotificationSettings settings={notificationSettings} showFeedback={false} />
                <NotificationDeliverySettings settings={notificationSettings} onOpenDevices={() => openSettingsPane("remote-clients", "devices")} />
                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Sound cues</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      Play a sound when an agent finishes.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={soundCuesEnabled ? "default" : "outline"}
                    aria-pressed={soundCuesEnabled}
                    onClick={() => onSoundCuesEnabledChange(!soundCuesEnabled)}
                    className="shrink-0"
                  >
                    {soundCuesEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="file"
                    accept="audio/*"
                    onChange={handleFinishSoundUpload}
                    aria-label="Upload custom finish sound"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onTestFinishSound}
                    disabled={!soundCuesEnabled}
                  >
                    Test sound
                  </Button>
                  {finishSound ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onFinishSoundChange(null)}
                    >
                      Remove custom sound
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {finishSound
                    ? `Custom sound: ${finishSound.name}`
                    : "No custom sound uploaded. The default completion sound plays when sound cues are on. Removing a custom file restores that default."}
                </p>
  <section aria-label="Notification devices" className="space-y-3 border-t border-border/60 pt-4">
    <h4 className="text-sm font-medium">Delivery devices</h4>
    {notificationSettings.clients.length ? notificationSettings.clients.map(client => (
      <div key={client.id} className="rounded-lg border border-border/60 p-3">
        <p className="text-sm font-medium">{client.name}</p>
        <p className="text-xs text-muted-foreground">{client.status}</p>
        <RemoteDeviceNotificationSwitch settings={notificationSettings} clientId={client.id} clientName={client.name} />
      </div>
    )) : notificationSettings.prefs ? <p className="text-xs text-muted-foreground">No remote clients enrolled yet. Connect a device to receive native alerts.</p> : null}
  </section>
</section>
 </SettingsFeaturePane>
 ) : settingsPane === "voice" ? (
 <SettingsFeaturePane backLabel="General" slot="voice-settings" onBack={() => backToSettings("settings-voice-input")}>
 <section className="flex flex-col gap-4">
                <div>
                  <h3 id="settings-voice-input" className="text-sm font-medium">Voice &amp; dictionary</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose how speech is transcribed before it is inserted into the composer.
                  </p>
                </div>
                <MicrophoneSettings browserTranscription={voiceProvider === "browser"} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Provider
                    <select
                      value={voiceProvider}
                      onChange={(event) => onVoiceInputSettingsChange({
                        provider: event.target.value as "openai" | "local" | "custom" | "browser",
                        ...(event.target.value === "browser" ? { realtime: true } : {}),
                      })}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="local">Local</option>
                      <option value="browser">Browser transcription</option>
                      <option value="custom">Custom endpoint</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Model ID
                    <Input
                      value={voiceModelId}
                      onChange={(event) => onVoiceInputSettingsChange({ modelId: event.target.value })}
                      placeholder={voiceProvider === "openai" ? "whisper-1" : "model id"}
                    />
                  </label>
                </div>
                {voiceProvider === "openai" ? (
                  <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                    <p className="font-medium text-foreground">OpenAI presets</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="xs" variant={!voiceRealtime ? "secondary" : "outline"} onClick={() => onVoiceInputSettingsChange({ modelId: "whisper-1", realtime: false })}>
                        whisper-1
                      </Button>
                      <Button type="button" size="xs" variant={voiceRealtime ? "secondary" : "outline"} onClick={() => onVoiceInputSettingsChange({ modelId: "gpt-realtime-whisper", realtime: true })}>
                        GPT Realtime Whisper
                      </Button>
                    </div>
                  </div>
                ) : null}
                {voiceProvider === "custom" || voiceProvider === "local" ? (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Transcription endpoint
                    <Input value={voiceEndpoint} onChange={(event) => onVoiceInputSettingsChange({ endpoint: event.target.value })} placeholder="http://127.0.0.1:9000/v1" />
                  </label>
                ) : null}
                {voiceProvider === "openai" || voiceProvider === "custom" ? (
                  <div className="grid gap-2 rounded-lg border border-border/60 p-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      API key
                      <Input
                        type="password"
                        value={voiceApiKey}
                        onChange={(event) => setVoiceApiKey(event.target.value)}
                        placeholder="Stored encrypted on the server"
                        autoComplete="new-password"
                      />
                    </label>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">The key is never returned to the browser.</span>
                      <Button
                        type="button"
                        size="xs"
                        disabled={voiceKeyBusy || !voiceApiKey.trim()}
                        onClick={() => {
                          setVoiceKeyBusy(true);
                          void onVoiceApiKeySave(voiceApiKey).then(() => {
                            setVoiceApiKey("");
                            toast.success("Voice API key saved");
                          }).catch((error) => {
                            toast.error(error instanceof Error ? error.message : "Could not save voice API key.");
                          }).finally(() => setVoiceKeyBusy(false));
                        }}
                      >
                        {voiceKeyBusy ? "Saving…" : "Save key"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {voiceProvider === "custom" ? (
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-xs">
                    <span>
                      <span className="block font-medium text-foreground">Streaming transcription</span>
                      <span className="text-muted-foreground">Show partial speech above the composer.</span>
                    </span>
                    <Button type="button" size="sm" variant={voiceRealtime ? "default" : "outline"} aria-pressed={voiceRealtime} onClick={() => onVoiceInputSettingsChange({ realtime: !voiceRealtime })}>
                      {voiceRealtime ? "On" : "Off"}
                    </Button>
                  </label>
                ) : null}
                <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
                  <div>
                    <p className="text-xs font-medium">Microphone button</p>
                    <p className="text-xs text-muted-foreground">Enable voice input in the composer.</p>
                  </div>
                  <Button type="button" size="sm" variant={voiceInputEnabled ? "default" : "outline"} aria-pressed={voiceInputEnabled} onClick={() => onVoiceInputSettingsChange({ enabled: !voiceInputEnabled })}>
                    {voiceInputEnabled ? "On" : "Off"}
                  </Button>
                </div>
                <label className="grid max-w-xs gap-1 text-xs text-muted-foreground">
                  Maximum recording length (seconds)
                  <Input type="number" min={1} max={3600} value={voiceMaxDurationSeconds} disabled={!voiceInputEnabled} onChange={(event) => onVoiceInputSettingsChange({ maxDurationSeconds: Math.max(1, Math.min(3600, Number(event.target.value) || 300)) })} />
                </label>
                <SettingsTile id="settings-dictionary" title="Dictionary" meta="Add words and preferred spellings" icon={BookOpen} onOpen={() => openSettingsPane("dictionary")} />
              </section>
 </SettingsFeaturePane>
 ) : settingsPane === "browser" ? (
 <SettingsFeaturePane backLabel="General" slot="browser-settings" onBack={() => backToSettings("settings-browser")}>
 <section className="flex flex-col gap-4">
                <div>
                  <h3 id="settings-browser" className="text-sm font-medium">Browser</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Turn the embedded browser on or off, and set realtime preview, FPS, and the default viewport.
                  </p>
                </div>
                <BrowserSettingsControls
                  compact
                  browserEnabled={browserEnabled}
                  browserRealtime={browserRealtime}
                  browserFps={browserFps}
                  browserViewportWidth={browserViewportWidth}
                  browserViewportHeight={browserViewportHeight}
                  onChange={onBrowserSettingsChange}
                />
  <SettingsTile id="settings-browser-storage" title="Browser storage" meta={browserStorageError ? "Unavailable · open to retry" : browserStorageLoading ? "Loading…" : `${browserStorage.length} stored website${browserStorage.length === 1 ? "" : "s"}`} icon={Globe2} onOpen={() => openSettingsPane("browser-storage")} />
</section>
 </SettingsFeaturePane>

 ) : settingsPane === "usage" ? (
 <SettingsFeaturePane backLabel="Models" title="Usage" slot="usage-settings" onBack={() => backToSettings("settings-usage")}>
 <PlanUsagePanel snapshot={usageSnapshot} onRefresh={onRefreshUsage} />
 </SettingsFeaturePane>
 ) : settingsPane === "remote-clients" ? (
 <SettingsFeaturePane backLabel="Devices" slot="remote-client-settings" onBack={() => backToSettings("settings-remote-clients")}>
 <section className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="settings-remote-clients" className="text-sm font-medium">Remote Clients</h3>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                      Clients use an outbound encrypted connection. New clients start in user access; administrative capabilities are never implicit.
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={() => setRemotePairStep("os")} disabled={remoteBusy}>
                    <Plus data-icon="inline-start" />
                    Add client
                  </Button>
                </div>
                <SettingsTile id="settings-device-notifications" title="Notifications" meta="Choose alerts, sounds and delivery devices" icon={Bell} onOpen={() => openSettingsPane("notifications", "general")} />
                <div className="rounded-lg border bg-card/40 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-medium">Global command allowlist</h4>
                      <p className="mt-1 text-xs text-muted-foreground">These exact commands are available to every device that has Run commands enabled.</p>
                    </div>
                    <Button type="button" size="sm" disabled={remoteGlobalAllowlistBusy || !remoteGlobalAllowlistLoaded} onClick={() => void saveGlobalRemoteAllowlist()}>
                      {remoteGlobalAllowlistBusy ? "Saving…" : "Save global list"}
                    </Button>
                  </div>
                  <Textarea
                    value={remoteGlobalAllowlistDraft}
                    disabled={!remoteGlobalAllowlistLoaded}
                    onChange={(event) => setRemoteGlobalAllowlistDraft(event.target.value)}
                    placeholder={"One exact command per line\ne.g. whoami"}
                    rows={3}
                    aria-label="Global command allowlist"
                    className="mt-3 font-mono text-xs"
                  />
                  {!remoteGlobalAllowlistLoaded && !remoteGlobalAllowlistError ? <p className="mt-2 text-xs text-muted-foreground">Loading global allowlist…</p> : null}
                  {remoteGlobalAllowlistError ? (
                    <div className="mt-2 flex items-center gap-2">
                      <p role="alert" className="text-xs text-destructive">{remoteGlobalAllowlistError}</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => void loadGlobalRemoteAllowlist()}>Retry</Button>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  {remoteClients.length ? remoteClients.map((client) => (
                    <div key={client.id} className="rounded-lg border bg-card/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          {String(client.os ?? "").toLowerCase().includes("win") ? <MicrosoftLogo className="mt-1 size-4 shrink-0 text-muted-foreground" /> : String(client.os ?? "").toLowerCase().includes("mac") ? <AppleLogo className="mt-1 size-4 shrink-0 text-muted-foreground" /> : <Server className="mt-1 size-4 shrink-0 text-muted-foreground" />}
                          <div className="min-w-0">
                          <Input
                           key={`${client.id}:${client.name}`}
                            defaultValue={client.name}
                            aria-label={`Custom name for ${client.name}`}
                            className="h-7 max-w-[16rem] border-transparent px-0 text-sm font-medium shadow-none focus-visible:border-input focus-visible:px-2"
                            onBlur={(event) => void renameRemoteClient(client, event.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            {client.hostname || "Unknown host"} · {client.os || "Unknown OS"} · {client.architecture || "unknown arch"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Badge variant={client.permissionMode === "admin" ? "default" : "outline"}>
                              {client.permissionMode === "admin" ? "Admin / system access" : "User access · no administrator rights"}
                            </Badge>
                            <Badge variant="outline">{client.policy.mode === "full_access" ? "Full Access" : `${client.policy.permissions.length} permissions enabled`}</Badge>
                            {client.capabilities?.includes("desktop_gui") ? <Badge variant="outline">Computer Use {client.policy.permissions.includes("computer_use") ? "on" : "off"}</Badge> : null}
                            {desktopStatusById[client.id] ? <Badge variant={desktopStatusById[client.id].available ? "outline" : "secondary"}>{desktopStatusById[client.id].available ? "Desktop ready" : "Needs OS permissions"}</Badge> : null}
                          </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`size-2 rounded-full ${client.status === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} title={client.status} />
                          <RemotePermissionsEditor client={client} onSave={updateRemotePolicy} desktopStatus={desktopStatusById[client.id]} desktopBusy={desktopStatusBusyId === client.id} onCheckDesktop={(prompt) => checkDesktopPermissions(client, prompt)} />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button type="button" size="icon-xs" variant="ghost" className="max-md:min-h-11 max-md:min-w-11" aria-label={`Manage ${client.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => void testRemoteConnection(client)}>Test connection</DropdownMenuItem>
                              {client.capabilities?.includes("desktop_gui") ? <DropdownMenuItem onClick={() => void checkDesktopPermissions(client)}>Check desktop permissions</DropdownMenuItem> : null}
                              <DropdownMenuItem className="text-destructive" onClick={() => setRemoteClientDeleteTarget(client)}>Remove client</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>{client.status}</span>
                        {client.version ? <span>v{client.version}</span> : null}
                        {client.lastSeenAt ? <span>seen {new Date(client.lastSeenAt).toLocaleString("en")}</span> : null}
                      </div>

                    </div>
                  )) : (
                    <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No remote clients enrolled yet.</p>
                  )}
                </div>
              </section>
 </SettingsFeaturePane>
 ) : isHostAdmin && settingsPane === "users" ? (
 <SettingsFeaturePane backLabel="Admin" title="Users" slot="users-settings" onBack={() => backToSettings("settings-users")}>
 <AdminUsersPanel />
 </SettingsFeaturePane>
 ) : settingsPane === "archived" ? (
 <SettingsFeaturePane backLabel={isHostAdmin ? "Admin" : "Chats"} slot="archived-chat-settings" onBack={() => backToSettings("settings-archived")}>
 <section className="flex flex-col gap-4">
                <div>
                  <h3 id="settings-archived" className="flex items-center gap-2 text-sm font-medium">
                    <Archive className="size-4 text-muted-foreground" />
                    Archived chats
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Archived chats disappear from the sidebar but remain available in chat search.
                  </p>
                </div>
                {!archivedChatsLoaded ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                    Loading archived chats…
                  </div>
                ) : archivedChats.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                    No archived chats.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {archivedChats.map((chat) => (
                      <li
                        key={chat.id}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{chat.title || "Untitled"}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Archived chat
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void updateArchivedChat(chat.id, false)}
                        >
                          <ArchiveRestore className="size-3.5" />
                          Restore
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${chat.title || "archived chat"}`}
                          onClick={() => void deleteArchivedChat(chat.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                </section>
 </SettingsFeaturePane>
 ) : settingsPane === "shared" ? (
 <SettingsFeaturePane backLabel={isHostAdmin ? "Admin" : "Chats"} slot="shared-chat-settings" onBack={() => backToSettings("settings-shared")}>
 <section className="flex flex-col gap-4"><div>
                  <div>
                    <h3 id="settings-shared" className="flex items-center gap-2 text-sm font-medium">
                      <Link2 className="size-4 text-muted-foreground" />
                      Shared chats
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Manage active read-only links for your chats.
                    </p>
                  </div>
                  {sharedChats.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      No active shared chats.
                    </div>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {sharedChats.map((chat) => (
                        <li key={chat.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{chat.title || "Untitled"}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {chat.share?.passwordProtected ? "Password protected" : "Public link"}
                            </p>
                          </div>
                          {chat.share ? (
                            <a
                              href={`/share?id=${encodeURIComponent(chat.share.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-accent"
                            >
                              <Link2 className="size-3.5" />
                              Open link
                            </a>
                          ) : null}
                          <Button type="button" size="sm" variant="outline" onClick={() => void deactivateShare(chat)}>
                            Deactivate
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
 </SettingsFeaturePane>
 ) : isHostAdmin && settingsPane === "maintenance" ? (
 <SettingsFeaturePane backLabel="Admin" slot="maintenance-settings" onBack={() => backToSettings("settings-maintenance")}>
 <div className="mt-3 border-t border-destructive/30 pt-4">
                    <h3 id="settings-maintenance" className="text-sm font-medium">Metis maintenance</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prepare a production update or reset Metis to its clean initial state.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button type="button" variant="outline" onClick={() => setUpdateMetisOpen(true)}>
                        <RefreshCw data-icon="inline-start" />
                        Update Metis
                      </Button>
                      <Button type="button" variant="destructive" onClick={() => setResetMetisOpen(true)}>
                        <RotateCcw data-icon="inline-start" />
                        Reset account
                      </Button>
                    </div>
                  </div>
 </SettingsFeaturePane>
 ) : settingsPane === "updates" ? (
 <SettingsFeaturePane backLabel="Updates" slot="update-settings" onBack={() => backToSettings("settings-update-preferences")}>
 <UpdateSettingsPanel
    isHostAdmin={Boolean(isHostAdmin)}
    onUpdateAvailableChange={setUpdateAvailable}
  />
 </SettingsFeaturePane>
 ) : (
 <>

<TabsContent value="general" className="mt-0">
 <SettingsOverview title="General">
  <SettingsTile id="settings-appearance" title="Appearance" meta={appearance.ready ? appearance.theme.name : "Loading…"} icon={Palette} onOpen={() => openSettingsPane("appearance")} />
  <SettingsTile id="settings-attachments" title="Attachments" meta={<AttachmentSettings summary />} icon={Paperclip} onOpen={() => openSettingsPane("attachments")} />
  <SettingsTile id="settings-notifications" title="Notifications" meta={notificationSettings.error ? "Unavailable · open to retry" : !notificationSettings.prefs ? "Loading…" : `Sounds ${soundCuesEnabled ? "on" : "off"} · ${notificationSettings.prefs.remoteClientIds.length} delivery devices`} icon={Bell} onOpen={() => openSettingsPane("notifications")} />
  <SettingsTile id="settings-voice-input" title="Voice & dictionary" meta={voiceInputEnabled ? `On · ${voiceModelId || "Transcription settings"}` : "Voice input off"} icon={Mic} onOpen={() => openSettingsPane("voice")} />
  <SettingsTile id="settings-browser" title="Browser" meta={browserEnabled ? `On · ${browserViewportWidth} × ${browserViewportHeight}` : "Browser workspace off"} icon={Globe2} onOpen={() => openSettingsPane("browser")} />
  {!mobile ? <SettingsExternalLinks /> : null}
 </SettingsOverview>
</TabsContent>
<TabsContent value="models" className="mt-0">
 <SettingsOverview title="Models">
  <SettingsTile id="settings-usage" title="Usage" meta={usageSnapshot?.providers.length ? `${usageSnapshot.providers.length} providers · quotas and reset times` : "Provider quotas and reset times"} icon={Gauge} onOpen={() => openSettingsPane("usage")} />
  <SettingsTile id="settings-providers" title="AI providers and connections" meta={providersLoaded ? `${providerConnections.length} connection${providerConnections.length === 1 ? "" : "s"}` : "Loading…"} icon={KeyRound} onOpen={() => openSettingsPane("providers")} />
  <SettingsTile id="settings-model-chains" title="Model Chains" meta="Ordered models with usage and availability fallback" icon={Link2} onOpen={() => openSettingsPane("model-chains")} />
  <SettingsTile id="settings-versions" title="CLI versions" meta="Installed agent CLI and SDK versions" icon={Download} onOpen={() => openSettingsPane("versions")} />
 </SettingsOverview>
</TabsContent>
<TabsContent value="agent" className="mt-0">
 <SettingsOverview title="Agent">
  <SettingsTile id="settings-agent-runtime" title="Runtime & recovery" meta="Runtime limits, provider waits and retries" icon={Settings2} onOpen={() => openSettingsPane("agent-settings")} />
  <SettingsTile id="settings-subagent-model" title="Subagent model" meta={subagentModelEnabled ? modelForSelection(models, subagentModelId)?.displayName || "Selected model unavailable" : "Agent chooses the model"} icon={Puzzle} onOpen={() => openSettingsPane("subagent-model")} />
  <SettingsTile id="settings-token-compression" title="Token compression" meta={compressionEnabled ? `On · ${compressionMode}` : "Off"} icon={Gauge} onOpen={() => openSettingsPane("compression")} />
  <SettingsTile id="settings-memories" title="Memories" meta={memories.length ? `${memories.length} ${memories.length === 1 ? "memory" : "memories"}` : "No memories yet"} icon={Brain} onOpen={() => openSettingsPane("memories")} />
 </SettingsOverview>
</TabsContent>
<TabsContent value="devices" className="mt-0">
 <SettingsOverview title="Devices">
  <SettingsTile id="settings-remote-clients" title="Remote clients" meta="Connected devices, permissions and pairing" icon={Monitor} onOpen={() => openSettingsPane("remote-clients")} />
  <SettingsTile id="settings-device-notifications-link" title="Notifications" meta="Alerts, sounds and delivery devices" icon={Bell} onOpen={() => openSettingsPane("notifications", "general")} />
 </SettingsOverview>
</TabsContent>
<TabsContent value="admin" className="mt-0">
 <SettingsOverview title={isHostAdmin ? "Admin" : "Chats"}>
  {isHostAdmin ? <SettingsTile id="settings-users" title="Users" meta="Accounts and access" icon={Users} onOpen={() => openSettingsPane("users")} /> : null}
  <SettingsTile id="settings-archived" title="Archived chats" meta={archivedChatsLoaded ? `${archivedChats.length} archived chats` : "Restore or remove archived chats"} icon={Archive} onOpen={() => openSettingsPane("archived")} />
  <SettingsTile id="settings-shared" title="Shared chats" meta="Manage read-only chat links" icon={Link2} onOpen={() => openSettingsPane("shared")} />
  {isHostAdmin ? <SettingsTile id="settings-maintenance" title="Maintenance" meta="Update preparation and data reset" icon={Settings2} onOpen={() => openSettingsPane("maintenance")} /> : null}
 </SettingsOverview>
</TabsContent>
<TabsContent value="updates" className="mt-0">
 <SettingsOverview title="Updates">
  <SettingsTile id="settings-update-preferences" title="Updates" meta={isHostAdmin ? updateAvailable ? "Update available" : "Update channels, schedule and history" : "Available to host administrators"} icon={RefreshCw} onOpen={() => openSettingsPane("updates")} />
 </SettingsOverview>
</TabsContent>
 </>
 )}
          </div>
        </Tabs>
        )}
      </section>
      <Dialog open={remotePairStep !== "idle"} onOpenChange={(value) => !value && setRemotePairStep("idle")}>
        <DialogContent className="box-border w-[calc(100vw_-_2rem)] max-w-[calc(100vw_-_2rem)] gap-0 overflow-x-hidden overflow-y-auto rounded-2xl p-0 sm:w-[min(56rem,calc(100vw_-_2rem))] sm:max-w-[min(56rem,calc(100vw_-_2rem))]">
          <div className="min-w-0 w-full max-w-full space-y-5 p-6">
          <DialogHeader>
            <DialogTitle>Connect a remote client</DialogTitle>
            <DialogDescription>
              Pair a device with this account and keep it available for terminal sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" aria-label="Remote client setup progress">
            {["Choose OS", "Install", "Connected"].map((label, index) => {
              const activeIndex = remotePairStep === "os" ? 0 : remotePairStep === "install" ? 1 : 2;
              const complete = index < activeIndex;
              return (
                <div key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium", index <= activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {complete ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className={cn("truncate", index <= activeIndex && "text-foreground")}>{label}</span>
                  {index < 2 ? <span className="mx-1 h-px flex-1 bg-border" /> : null}
                </div>
              );
            })}
          </div>
          {remotePairStep === "os" ? (
            <div className="space-y-4 pt-1">
              <div className="space-y-2" role="radiogroup" aria-label="Permission mode">
                <p className="text-sm font-medium">Permission mode</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([["user", "User access", "User files, processes, and allowed directories only. No UAC prompt."], ["admin", "Admin / system access", "For all users. UAC required; system actions stay capability-gated and confirmation-gated."]] as const).map(([value, label, description]) => (
                    <button key={value} type="button" role="radio" aria-checked={remotePermissionMode === value} onClick={() => setRemotePermissionMode(value)} className={cn("rounded-xl border p-3 text-left transition-colors", remotePermissionMode === value ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/50")}>
                      <span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                ["linux", "Linux", Server],
                ["windows", "Windows", MicrosoftLogo],
                ["macos", "macOS", AppleLogo],
              ] as const).map(([value, label, Icon]) => (
                <Button key={value} type="button" variant="outline" className="h-24 flex-col gap-2 rounded-xl" onClick={() => void createRemoteEnrollment(value)} disabled={remoteBusy}>
                  <Icon className="size-8" />
                  <span>{label}</span>
                </Button>
              ))}
              </div>
            </div>
          ) : remotePairStep === "install" ? (
            <div className="min-w-0 space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
              {remoteInstallerUrls.length > 0 ? (
                <>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4 text-primary" /> Install the {remotePlatform === "macos" ? "macOS" : remotePlatform === "linux" ? "Linux" : "Windows"} app</p>
                    <p className="mt-1 text-xs text-muted-foreground">Install the app, open it, then enter this server URL and pairing code. The code expires after 15 minutes. {remotePlatform === "windows" && remotePermissionMode === "admin" ? "For admin access, start the app as administrator and confirm UAC." : remotePlatform === "macos" ? "Drag the app into Applications. Desktop control needs Screen Recording and Accessibility permissions." : remotePlatform === "linux" ? "Make the AppImage executable and open it. Desktop control needs an X11 session, xdotool, wmctrl and ImageMagick." : "User access runs without administrator rights."}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {remoteInstallerUrls.map((installer) => <a key={installer.url} href={installer.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2">Download {installer.label}</a>)}
                  </div>
                  {remotePlatform === "macos" ? (
                    <div className="space-y-2 rounded-lg border border-border/70 bg-background p-3">
                      <p className="text-sm font-medium">Is it saying “damaged”?</p>
                      <p className="text-xs text-muted-foreground">macOS marks unsigned browser downloads as damaged. The file is fine. Run this in Terminal, then open the app:</p>
                      <div className="flex gap-2">
                        <Input readOnly value={'xattr -cr "/Applications/Metis AI Remote Client.app"'} aria-label="Fix damaged macOS app command" className="font-mono text-xs" />
                        <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText('xattr -cr "/Applications/Metis AI Remote Client.app"')}>Copy</Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Server URL</p>
                    <div className="flex gap-2"><Input readOnly value={remoteServerUrl} aria-label="Server URL" /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(remoteServerUrl)}>Copy</Button></div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Pairing code</p>
                    <div className="flex gap-2"><Input readOnly value={remotePairToken} aria-label="Pairing code" className="font-mono" /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(remotePairToken)}>Copy</Button></div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4 text-primary" /> Install the client</p>
                    <p className="mt-1 text-xs text-muted-foreground">Run this command on the device you want to connect. The installer includes Node.js and verifies the connection.</p>
                  </div>
                  <div className="w-full min-w-0 max-w-full overflow-hidden">
                    <Textarea readOnly value={remoteCommands?.[remotePlatform] || remoteCommand} className="block min-h-32 w-full min-w-0 max-w-full resize-y overflow-auto [field-sizing:fixed] bg-background font-mono text-xs" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => void copyRemoteCommand()}>Copy install command</Button>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                <RefreshCw className="size-3.5 animate-spin" />
                Waiting for the device to connect…
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6 text-center">
              <div className="relative flex size-16 items-center justify-center">
                <span className="absolute inset-0 rounded-full border border-emerald-500/20 animate-in fade-in zoom-in-75 duration-500" />
                <span className="relative flex size-12 items-center justify-center rounded-full border-2 border-emerald-500 text-emerald-500 animate-in zoom-in-50 duration-500">
                  <Check className="size-6 animate-in zoom-in-50 delay-150 duration-500" strokeWidth={3} />
                </span>
              </div>
              <div><p className="text-sm font-medium">Connected</p><p className="mt-1 text-xs text-muted-foreground">The remote client is ready to use. You can close this window.</p></div>
              <Button type="button" onClick={() => setRemotePairStep("idle")}>Done</Button>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(remoteClientDeleteTarget)}
        onOpenChange={(open) => !open && setRemoteClientDeleteTarget(null)}
        title="Remove remote client?"
        description={remoteClientDeleteTarget ? `Remove “${remoteClientDeleteTarget.name}” from this dashboard? The local client must still be uninstalled separately.` : ""}
        confirmLabel="Remove client"
        onConfirm={() => remoteClientDeleteTarget ? revokeRemoteClient(remoteClientDeleteTarget) : undefined}
      />
      <ConfirmDialog
      open={Boolean(deleteTarget)}
      onOpenChange={(open) => !open && setDeleteTarget(null)}
      title="Delete provider connection?"
      description={`Delete “${deleteTarget?.item.label || "this connection"}”? This action cannot be undone.`}
      confirmLabel="Delete"
      onConfirm={() => {
        if (!deleteTarget) return;
        return deleteProviderConnection(deleteTarget.item);
      }}
      />
      <ConfirmDialog
        open={Boolean(browserStorageDeleteTarget)}
        onOpenChange={(open) => !open && setBrowserStorageDeleteTarget(null)}
        title="Clear website data?"
        description={browserStorageDeleteTarget ? `All persistent browser data for “${browserStorageDeleteTarget}” will be removed.` : ""}
        confirmLabel="Clear data"
        onConfirm={async () => {
          if (!browserStorageDeleteTarget) return;
          await clearBrowserStorage(browserStorageDeleteTarget);
          setBrowserStorageDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={browserStorageClearAll}
        onOpenChange={setBrowserStorageClearAll}
        title="Clear all browser data?"
        description="This logs you out of every website in the embedded browser and cannot be undone."
        confirmLabel="Clear everything"
        onConfirm={async () => {
          await clearBrowserStorage();
          setBrowserStorageClearAll(false);
        }}
      />
      <ConfirmDialog
        open={updateMetisOpen}
        onOpenChange={setUpdateMetisOpen}
        title="Update Metis?"
        description="Metis will install the locked dependencies and build the inactive production slot. The active service will not be restarted automatically."
        confirmLabel="Prepare update"
        destructive={false}
        onConfirm={async () => {
          if (onUpdateMetis) await onUpdateMetis();
        }}
      />
      <ConfirmDialog
        open={resetMetisOpen}
        onOpenChange={setResetMetisOpen}
        title="Reset all Metis data?"
        description="This permanently removes chats, notes, memories, provider credentials, MCP servers, workflows, browser data, automations, remote clients, jobs and usage history. User accounts and the base installation remain. You will be signed out and must set up Metis again."
        confirmLabel="Reset everything"
        onConfirm={async () => {
          if (onResetMetis) await onResetMetis();
        }}
      />
    </>
  );
}
