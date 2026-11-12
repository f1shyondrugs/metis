"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Brain, FileText, Folder, ImagePlus, Layers, Paperclip, Plus, Trash2, Upload, X, type LucideIcon } from "lucide-react";
import { ProjectAvatar } from "@/components/project-avatar";
import { ProjectMembers } from "@/components/project-members";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProjectMemoryManager } from "@/components/project-memory-manager";
import { ProjectSkillsManager } from "@/components/project-skills-manager";
import { ProjectModelSelect } from "@/components/project-model-select";
import type { ProjectModelSettings } from "@/lib/project-model";
import { ProjectAgentsPanel } from "@/components/project-agents-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ProjectColorPicker, ProjectIconPicker } from "@/components/project-appearance-picker";
import { MAX_PROJECT_FILE_BYTES, PROJECT_COLORS } from "@/lib/project-constants";
import { cn } from "@/lib/utils";
import { ProjectNotesPreview } from "@/components/project-notes-preview";

import { fetchProjectHome, type ProjectHomeData } from "@/lib/project-home-client";

type ProjectHomePanel = "instructions" | "memory" | "skills" | "files";

const PROJECT_HOME_PANELS: Record<ProjectHomePanel, { title: string; description: string }> = {
 instructions: {
  title: "Project instructions",
  description: "Override global custom instructions while a chat is in this project.",
 },
 memory: {
  title: "Project memory",
  description: "",
 },
 skills: {
  title: "Skills",
  description: "Drag skills between lists or use the arrow buttons. Click a skill for source, path, and SKILL.md. New skills start enabled for this project.",
 },
 files: {
  title: "Files",
  description: "Upload files for chats in this project.",
 },
};

function formatBytes(size: number) {
 if (size < 1024) return `${size} B`;
 if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
 return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ProjectHomeTile({
 id,
 title,
 meta,
 icon: Icon,
 selected,
 onSelect,
}: {
 id: ProjectHomePanel;
 title: string;
 meta: string;
 icon: LucideIcon;
 selected: boolean;
 onSelect: (id: ProjectHomePanel) => void;
}) {
 return (
  <button
   type="button"
   data-project-home-tile={id}
   aria-pressed={selected}
   aria-controls={selected ? `project-home-panel-${id}` : undefined}
   onClick={() => onSelect(id)}
   className={cn(
    "flex min-h-[5.75rem] flex-col items-start justify-between rounded-xl px-3.5 py-3 text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "bg-muted text-foreground" : "bg-muted/35 text-foreground hover:bg-muted/55",
   )}
  >
   <Icon className="size-4 text-muted-foreground" />
   <span className="mt-3 min-w-0">
    <span className="block text-sm font-medium">{title}</span>
    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
   </span>
  </button>
 );
}

function ProjectHomeSkeleton() {
 return (
 <div
 className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col gap-6 overflow-hidden px-4 py-5 sm:gap-8 sm:px-6 sm:py-8"
 aria-busy="true"
 aria-label="Loading project"
 data-slot="project-home-skeleton"
 >
 <header className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-4">
 <div className="size-14 shrink-0 animate-pulse rounded-xl bg-muted" />
 <div className="min-w-0 space-y-2">
 <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
 <p className="text-sm text-muted-foreground">Loading project…</p>
 <div className="h-3 w-40 animate-pulse rounded bg-muted" />
 </div>
 <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:shrink-0">
 <div className="h-9 min-w-0 animate-pulse rounded-md bg-muted sm:w-24" />
 <div className="h-9 min-w-0 animate-pulse rounded-md bg-muted sm:w-20" />
 </div>
 </header>
 <div className="h-28 animate-pulse rounded-xl border border-border/40 bg-muted/40" />
 <div className="h-20 animate-pulse rounded-xl bg-muted/40" />
 <div className="grid grid-cols-2 gap-2">
  <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
  <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
  <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
  <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
 </div>
 <div className="h-16 animate-pulse rounded-xl bg-muted/40" />
 </div>
 );
}

async function fileToBase64(file: File) {
 const buf = await file.arrayBuffer();
 const bytes = new Uint8Array(buf);
 let binary = "";
 for (let i = 0; i < bytes.length; i += 0x8000) {
  binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
 }
 return btoa(binary);
}

export function ProjectHome({
 projectId,
 onOpenChat,
 onNewChat,
 onAttachFile,
 onOpenNotes,
 onDeleted,
}: {
 projectId: string;
 onOpenChat: (chatId: string) => void;
 onNewChat: (projectId: string) => void;
 onAttachFile: (file: { id: string; name: string; mimeType: string; size: number }) => void;
 onOpenNotes: (noteId?: string) => void;
 onDeleted: () => void;
}) {
 const [data, setData] = useState<ProjectHomeData | null>(null);
 const [name, setName] = useState("");
 const [instructions, setInstructions] = useState("");
 const [memoryMode, setMemoryMode] = useState<"default" | "project_only">("default");
 const [color, setColor] = useState(PROJECT_COLORS[0]);
 const [appearanceSaving, setAppearanceSaving] = useState(false);
 const [icon, setIcon] = useState<string>("folder");
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);
 const [deleteOpen, setDeleteOpen] = useState(false);
 const [membersOpen, setMembersOpen] = useState(false);
 const [dragOver, setDragOver] = useState(false);
 const [memorySaving, setMemorySaving] = useState(false);
 const [chatVisibilitySaving, setChatVisibilitySaving] = useState(false);
 const [defaultModelSaving, setDefaultModelSaving] = useState(false);
 const [agentManagementSaving, setAgentManagementSaving] = useState(false);
 const [activePanel, setActivePanel] = useState<ProjectHomePanel | null>(null);
 const togglePanel = (id: ProjectHomePanel) => {
  setActivePanel((current) => (current === id ? null : id));
 };
 const logoInputRef = useRef<HTMLInputElement>(null);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const loadGenerationRef = useRef(0);
 const loadRequestRef = useRef(0);

 const applyBody = (body: ProjectHomeData) => {
 setData(body);
 setName(body.project.name);
 setInstructions(body.project.instructions || "");
 setMemoryMode(body.project.memoryMode);
 setColor(body.project.color);
 setIcon(body.project.icon);
 setError("");
 };

 const load = useCallback(async (signal?: AbortSignal) => {
 const generation = loadGenerationRef.current;
 const request = ++loadRequestRef.current;
 try {
  const body = await fetchProjectHome(projectId, signal);
  if (signal?.aborted || generation !== loadGenerationRef.current || request !== loadRequestRef.current) return;
  applyBody(body);
 } catch (cause) {
  if (signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError") || (cause instanceof Error && cause.name === "AbortError")) return;
  if (generation !== loadGenerationRef.current || request !== loadRequestRef.current) return;
  setError(cause instanceof Error ? cause.message : "Could not load project.");
 }
 }, [projectId]);

 useLayoutEffect(() => {
 const controller = new AbortController();
 loadGenerationRef.current += 1;
 setData(null);
 setName("");
 setInstructions("");
 setActivePanel(null);
 setError("");
 setAppearanceSaving(false);
 load(controller.signal);
 return () => controller.abort();
 }, [load]);

 async function save(patch: Record<string, unknown>) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
   method: "PATCH",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(patch),
  });
  if (response.ok) {
   window.dispatchEvent(new Event("metis:projects-changed"));
   load();
  }
 }

 async function saveAppearance(patch: { color?: string; icon?: string }) {
  if (!data || appearanceSaving) return;
  const previous = data.project;
  const generation = loadGenerationRef.current;
  setAppearanceSaving(true); setError("");
  if (patch.color) setColor(patch.color);
  if (patch.icon) setIcon(patch.icon);
  try {
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
   });
   const body = await response.json() as { project?: ProjectHomeData["project"]; error?: string };
   if (!response.ok || !body.project) throw new Error(body.error || "Could not save project appearance.");
   if (generation !== loadGenerationRef.current) return;
   setData(current => current?.project.id === body.project!.id ? { ...current, project: body.project! } : current);
   setColor(body.project.color); setIcon(body.project.icon);
   window.dispatchEvent(new Event("metis:projects-changed"));
  } catch (cause) {
   if (generation === loadGenerationRef.current) {
    setColor(previous.color); setIcon(previous.icon);
    setError(cause instanceof Error ? cause.message : "Could not save project appearance.");
   }
  } finally { if (generation === loadGenerationRef.current) setAppearanceSaving(false); }
 }

 async function saveChatVisibility(hidden: boolean) {
  if (chatVisibilitySaving) return;
  setChatVisibilitySaving(true);
  setError("");
  const generation = loadGenerationRef.current;
  try {
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hideChatsFromAll: hidden }),
   });
   const body = await response.json().catch(() => ({})) as { project?: ProjectHomeData["project"]; error?: string };
   if (!response.ok || !body.project) throw new Error(body.error || "Could not save chat visibility.");
   if (generation !== loadGenerationRef.current) return;
   setData(current => current?.project.id === body.project!.id ? { ...current, project: body.project! } : current);
   window.dispatchEvent(new Event("metis:projects-changed"));
  } catch (cause) {
   if (generation === loadGenerationRef.current) setError(cause instanceof Error ? cause.message : "Could not save chat visibility.");
  } finally {
   setChatVisibilitySaving(false);
  }
 }

 async function saveDefaultModel(settings: ProjectModelSettings) {
  if (defaultModelSaving) return;
  setDefaultModelSaving(true); setError("");
  const generation = loadGenerationRef.current;
  try {
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
   });
   const body = await response.json() as { project?: ProjectHomeData["project"]; error?: string };
   if (!response.ok || !body.project) throw new Error(body.error || "Could not save the default model.");
   if (generation !== loadGenerationRef.current) return;
   setData(current => current?.project.id === body.project!.id ? { ...current, project: body.project! } : current);
   window.dispatchEvent(new Event("metis:projects-changed"));
  } finally { setDefaultModelSaving(false); }
 }

 async function saveAgentManagement(allowed: boolean) {
  if (agentManagementSaving) return;
  setAgentManagementSaving(true);
  setError("");
  const generation = loadGenerationRef.current;
  try {
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowAgentManagement: allowed }),
   });
   const body = await response.json().catch(() => ({})) as { project?: ProjectHomeData["project"]; error?: string };
   if (!response.ok || !body.project) throw new Error(body.error || "Could not save agent permissions.");
   if (generation !== loadGenerationRef.current) return;
   setData(current => current?.project.id === body.project!.id ? { ...current, project: body.project! } : current);
   window.dispatchEvent(new Event("metis:projects-changed"));
  } catch (cause) {
   if (generation === loadGenerationRef.current) setError(cause instanceof Error ? cause.message : "Could not save agent permissions.");
  } finally {
   setAgentManagementSaving(false);
  }
 }

 async function saveMemoryMode(includeGlobal: boolean) {
  if (memorySaving) return;
  setMemorySaving(true);
  setError("");
  try {
   const nextMode = includeGlobal ? "default" : "project_only";
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memoryMode: nextMode }),
   });
   const body = await response.json().catch(() => ({})) as { error?: string };
   if (!response.ok) throw new Error(body.error || "Could not save memory settings.");
   setMemoryMode(nextMode);
   window.dispatchEvent(new Event("metis:projects-changed"));
   await load();
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : "Could not save memory settings.");
  } finally {
   setMemorySaving(false);
  }
 }

 async function uploadLogo(file: File) {
  setBusy(true);
  try {
   const dataUrl = await fileToBase64(file);
   const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/logo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: file.type || "image/png", data: dataUrl }),
   });
   const body = (await response.json().catch(() => ({}))) as { error?: string };
   if (!response.ok) throw new Error(body.error || "Could not upload logo.");
   window.dispatchEvent(new Event("metis:projects-changed"));
   load();
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : "Could not upload logo.");
  } finally {
   setBusy(false);
  }
 }

 async function uploadFiles(files: FileList | File[]) {
  const list = Array.from(files);
  if (!list.length) return;
  setBusy(true);
  setError("");
  try {
   for (const file of list) {
    if (file.size > MAX_PROJECT_FILE_BYTES) {
     setError(`${file.name} is larger than ${MAX_PROJECT_FILE_BYTES / 1024 / 1024}MB.`);
     continue;
    }
    // Use the same upload contract as the normal chat composer: JSON with
    // browser-side base64 data. This avoids runtime-dependent FormData/Blob
    // handling and makes the Project Hub behave identically across browsers.
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files`, {
     method: "POST",
     credentials: "same-origin",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
      name: file.name,
      mimeType: file.type || undefined,
      data: await fileToBase64(file),
     }),
    });
    if (!response.ok) {
     const body = (await response.json().catch(() => ({}))) as { error?: string };
     throw new Error(body.error || `Could not upload ${file.name}.`);
    }
    }
   await load();
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : "Could not upload files.");
  } finally {
   setBusy(false);
  }
 }

 async function deleteProject() {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
  if (!response.ok) {
   const body = (await response.json().catch(() => ({}))) as { error?: string };
   throw new Error(body.error || "Could not delete project.");
  }
  window.dispatchEvent(new Event("metis:projects-changed"));
  onDeleted();
 }

 if (error && (!data || data.project.id !== projectId)) return <p role="alert" className="p-6 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>;
 if (!data || data.project.id !== projectId) return <ProjectHomeSkeleton />;

 return (
  <div className="project-home-scroll min-h-0 w-full flex-1 overflow-y-auto">
   <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-5 sm:gap-8 sm:px-6 sm:py-8">
   <header className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-4">
    <button
     type="button"
     className="group relative shrink-0"
     onClick={() => logoInputRef.current?.click()}
     aria-label="Upload custom logo"
    >
     <ProjectAvatar
      id={projectId}
      icon={icon}
      color={color}
      hasLogo={Boolean(data.project.logoStoredName)}
      updatedAt={data.project.updatedAt}
      size="lg"
     />
     <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
      <ImagePlus className="size-5" />
     </span>
    </button>
    <input
     ref={logoInputRef}
     type="file"
     accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
     className="hidden"
     onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void uploadLogo(file);
     }}
    />
    <div className="min-w-0 self-center sm:self-start">
     <Input
      className="h-auto min-w-0 border-none px-0 text-[1.35rem] font-semibold tracking-tight shadow-none focus-visible:ring-0 sm:text-2xl"
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
       if (name.trim() && name.trim() !== data.project.name) void save({ name: name.trim() });
      }}
     />
     <p className="mt-1 text-xs text-muted-foreground">
         {data.project.mode === "agents" ? "Agent-oriented project" : `${data.chats.length} chats`} · {data.files.length} files · {data.notes.length} notes
     </p>
    </div>
    <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
     <Button type="button" className="min-w-0" onClick={() => data.project.mode === "agents" ? window.dispatchEvent(new CustomEvent("metis:new-project-agent", { detail: { projectId } })) : onNewChat(projectId)}>
      <Plus className="size-4" />
      {data.project.mode === "agents" ? "New agent" : "New chat"}
     </Button>
     <Button type="button" variant="outline" className="min-w-0" onClick={() => setMembersOpen(true)}>{data.project.membershipRole === "member" ? "Members" : "Invite / Members"}</Button>
     {data.project.membershipRole !== "member" ? <Button type="button" variant="destructive" className="min-w-0" onClick={() => setDeleteOpen(true)}>
      <Trash2 className="size-4" />
      Delete
     </Button> : null}
    </div>
   </header>

   {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
   <section aria-labelledby="chat-visibility-heading" className="grid gap-3">
    <h3 id="chat-visibility-heading" className="text-sm font-medium">Chat visibility</h3>
    <div className="flex items-start justify-between gap-4">
     <div className="min-w-0">
      <label htmlFor="hide-chats-from-all" className="cursor-pointer text-sm font-medium">Display in all chats</label>
      <p id="hide-chats-from-all-description" className="mt-1 text-xs leading-5 text-muted-foreground">
       Show this project’s chats in All Projects. They always remain visible inside the project.
      </p>
     </div>
     <Switch
      id="hide-chats-from-all"
      checked={data.project.hideChatsFromAll !== true}
      disabled={chatVisibilitySaving}
      aria-describedby="hide-chats-from-all-description"
      onCheckedChange={(visible) => { void saveChatVisibility(!visible); }}
      className="mt-0.5 shrink-0"
     />
    </div>
   </section>
   {data.project.mode === "agents" ? (
    <>
     <section aria-label="Agent settings" className="grid gap-3">
      <h3 className="text-sm font-medium">Agent settings</h3>
      <ProjectModelSelect key={data.project.id} id="project-default-model" value={data.project} onChange={saveDefaultModel} disabled={defaultModelSaving} />
     </section>
     <section aria-labelledby="agent-permissions-heading" className="grid gap-3">
      <h3 id="agent-permissions-heading" className="text-sm font-medium">Agent permissions</h3>
      <div className="flex items-start justify-between gap-4">
       <div className="min-w-0">
        <label htmlFor="allow-agent-management" className="cursor-pointer text-sm font-medium">Allow agents to manage the team</label>
        <p id="allow-agent-management-description" className="mt-1 text-xs leading-5 text-muted-foreground">
         Agents can create, edit and archive agents in this project. You can always manage the team yourself.
        </p>
       </div>
       <Switch
        id="allow-agent-management"
        checked={data.project.allowAgentManagement === true}
        disabled={agentManagementSaving}
        aria-describedby="allow-agent-management-description"
        onCheckedChange={(allowed) => { void saveAgentManagement(allowed); }}
        className="mt-0.5 shrink-0"
       />
      </div>
     </section>
     <ProjectAgentsPanel projectId={projectId} onOpenChat={onOpenChat} />
    </>
   ) : null}

   <section className="grid gap-3">
    <div className="flex items-center justify-between">
     <h3 className="text-sm font-medium">Appearance</h3>
     {data.project.logoStoredName ? (
      <Button
       type="button"
       variant="ghost"
       size="sm"
       onClick={() => {
        void fetch(`/api/projects/${encodeURIComponent(projectId)}/logo`, { method: "DELETE" }).then(() => {
         window.dispatchEvent(new Event("metis:projects-changed"));
         load();
        });
       }}
      >
       Remove logo
      </Button>
     ) : null}
    </div>
    <ProjectColorPicker value={color} onChange={value => void saveAppearance({ color: value })} disabled={appearanceSaving}/>
    <ProjectIconPicker value={icon} color={color} onChange={value => void saveAppearance({ icon: value })} disabled={appearanceSaving}/>
    {data.project.logoStoredName ? <p className="text-xs text-muted-foreground">Remove the custom logo to show this icon.</p> : null}

   </section>

   <div className="grid grid-cols-2 gap-2" data-slot="project-home-tiles">
    <ProjectHomeTile
     id="instructions"
     title="Instructions"
     meta={instructions.trim() ? "Custom instructions set" : "None yet"}
     icon={FileText}
     selected={activePanel === "instructions"}
     onSelect={togglePanel}
    />
    <ProjectHomeTile
     id="memory"
     title="Memories"
     meta={data.project.memories.length ? `${data.project.memories.length} ${data.project.memories.length === 1 ? "fact" : "facts"}` : "No facts yet"}
     icon={Brain}
     selected={activePanel === "memory"}
     onSelect={togglePanel}
    />
    <ProjectHomeTile
     id="skills"
     title="Skills"
     meta={data.skills.length ? `${data.skills.filter((skill) => skill.enabled).length} of ${data.skills.length} enabled` : "None installed"}
     icon={Layers}
     selected={activePanel === "skills"}
     onSelect={togglePanel}
    />
    <ProjectHomeTile
     id="files"
     title="Files"
     meta={data.files.length ? `${data.files.length} ${data.files.length === 1 ? "file" : "files"}` : "No files yet"}
     icon={Folder}
     selected={activePanel === "files"}
     onSelect={togglePanel}
    />
   </div>

   {activePanel ? (
    <Dialog open onOpenChange={(open) => { if (!open) setActivePanel(null); }}>
     <DialogContent
      data-slot="project-home-panel-dialog"
      className={cn(
       "max-h-[min(85dvh,42rem)] overflow-y-auto",
       activePanel === "skills" ? "sm:max-w-3xl" : "sm:max-w-lg",
      )}
     >
      <DialogHeader>
       <DialogTitle>{PROJECT_HOME_PANELS[activePanel].title}</DialogTitle>
       {PROJECT_HOME_PANELS[activePanel].description ? (
        <DialogDescription>{PROJECT_HOME_PANELS[activePanel].description}</DialogDescription>
       ) : (
        <DialogDescription className="sr-only">Edit this project section.</DialogDescription>
       )}
      </DialogHeader>

      {activePanel === "instructions" ? (
       <section id="project-home-panel-instructions" data-project-home-panel="instructions" className="grid gap-2">
        <Textarea
         value={instructions}
         onChange={(event) => setInstructions(event.target.value)}
         onBlur={() => void save({ instructions })}
         placeholder="How the agent should work in this project…"
         rows={6}
         className="min-h-32 rounded-xl"
        />
       </section>
      ) : null}

      {activePanel === "memory" ? (
       <section id="project-home-panel-memory" data-project-home-panel="memory" className="grid gap-6">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
     <section aria-labelledby="project-memory-settings" className="grid gap-3">
      <h3 id="project-memory-settings" className="text-sm font-medium">Memory settings</h3>
      <div className="flex items-start justify-between gap-4">
       <div className="min-w-0">
        <label htmlFor="include-global-memory" className="cursor-pointer text-sm font-medium">Include global memory</label>
        <p id="include-global-memory-description" className="mt-1 text-xs leading-5 text-muted-foreground">
         {memoryMode === "default"
          ? "Chats and agents can read and write project or global memories. Project-specific facts stay in this project."
          : "Chats and agents can only read and write this project's memories. Global memory and personal context are blocked."}
        </p>
       </div>
       <Switch id="include-global-memory" checked={memoryMode === "default"} disabled={memorySaving}
        aria-describedby="include-global-memory-description" onCheckedChange={(checked) => void saveMemoryMode(checked)} />
      </div>
     </section>
     <section aria-labelledby="project-memories-title" className="grid gap-3">
      <h3 id="project-memories-title" className="text-sm font-medium">Project memories</h3>
      <ProjectMemoryManager projectId={projectId} memories={data.project.memories} onChanged={load} />
     </section>
       </section>
      ) : null}

      {activePanel === "skills" ? (
       <section id="project-home-panel-skills" data-project-home-panel="skills" className="grid gap-3">
        <ProjectSkillsManager
         skills={data.skills}
         disabledSkillIds={data.project.disabledSkillIds}
         onChange={(disabledSkillIds) => {
          setData((current) => current ? {
           ...current,
           project: { ...current.project, disabledSkillIds },
           skills: current.skills.map((skill) => ({ ...skill, enabled: !disabledSkillIds.includes(skill.id) })),
          } : current);
          void save({ disabledSkillIds });
         }}
        />
       </section>
      ) : null}

      {activePanel === "files" ? (
       <section id="project-home-panel-files" data-project-home-panel="files" className="grid gap-3">
        <div
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors",
            dragOver ? "border-foreground/40 bg-white/[0.04]" : "border-border/70 hover:border-foreground/25 hover:bg-white/[0.02]",
            busy && "pointer-events-none opacity-70",
          )}
          role="button"
          tabIndex={busy ? -1 : 0}
          onClick={() => {
            if (!busy) fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files);
          }}
        >
          <Upload className="size-5 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            {busy ? "Uploading…" : "Drop files here or click to upload"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="Upload project files"
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              event.target.value = "";
              if (files?.length) void uploadFiles(files);
            }}
          />
        </div>
        {data.files.length ? (
         <ul className="grid gap-1">
          {data.files.map((file) => (
           <li key={file.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/40">
            <a
             href={`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}`}
             className="min-w-0 flex-1 truncate text-sm hover:underline"
             target="_blank"
             rel="noreferrer"
            >
             {file.name}
             <span className="ml-2 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
            </a>
            <Button
             type="button"
             variant="ghost"
             size="icon-sm"
             aria-label={`Attach ${file.name} to the next chat`}
             title="Attach to next chat"
             onClick={() => onAttachFile(file)}
            >
             <Paperclip className="size-3.5" />
            </Button>
            <Button
             type="button"
             variant="ghost"
             size="icon-sm"
             aria-label={`Delete ${file.name}`}
             onClick={() => {
              void fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}`, {
               method: "DELETE",
              }).then(() => load());
             }}
            >
             <X className="size-3.5" />
            </Button>
           </li>
          ))}
         </ul>
        ) : null}
       </section>
      ) : null}
     </DialogContent>
    </Dialog>
   ) : null}

   <ProjectNotesPreview notes={data.notes} onOpenNotes={onOpenNotes} />

   <ProjectMembers key={projectId} projectId={projectId} membershipRole={data.project.membershipRole} open={membersOpen} onOpenChange={setMembersOpen} onLeft={onDeleted} />
   <ConfirmDialog
    open={deleteOpen && data.project.membershipRole !== "member"}
    onOpenChange={setDeleteOpen}
    title={`Delete ${data.project.name}?`}
    description="Chats stay, but they leave this project. Pages move to their creators’ private No Project trees; issues move to the owner’s No Project workspace. Files and the custom logo are removed."
    confirmLabel="Delete project"
    onConfirm={deleteProject}
   />
   </div>
  </div>
 );
}
