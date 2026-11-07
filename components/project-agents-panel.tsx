"use client";

import { RunStatus } from "@/components/run-status";
import { fetchProjectTeam, mergeProjectChatAgents } from "@/lib/project-team-client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Archive, ArrowRight, CircleStop, Edit3, FileClock, MoreHorizontal, Pin, PinOff, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TeamPresetDialog } from "@/components/team-preset-dialog";
import { TeamAgentAvatar } from "@/components/team-agent-avatar";
import type { ProjectAgent, ProjectHandoff } from "@/lib/project-team-types";
import { cn } from "@/lib/utils";

const COLORS = ["#1767ed", "#ec1746", "#f87916", "#7324d6", "#079e6c", "#e60b91"];
const labels: Record<string, string> = { idle: "Ready", queued: "Queued", running: "Working", waiting_input: "Waiting for you", completed: "Ready", error: "Needs attention", cancelled: "Cancelled", archived: "Archived" };

export function useProjectTeam(projectId: string) {
 const [agents, setAgents] = useState<ProjectAgent[]>([]);
 const [handoffs, setHandoffs] = useState<ProjectHandoff[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState("");
 const generation = useRef(0);
 const pending = useRef<{ generation: number; controller: AbortController; promise: Promise<void> } | null>(null);
 const load = useCallback(() => {
  const current = generation.current;
  if (pending.current?.generation === current) return pending.current.promise;
  const controller = new AbortController();
  const promise = (async () => {
   try {
    const body = await fetchProjectTeam(projectId, controller.signal);
    if (current !== generation.current || controller.signal.aborted) return;
    setAgents(body.agents); setHandoffs(body.handoffs); setError("");
   } catch (cause) {
    if (current === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load team.");
   } finally {
    if (pending.current?.controller === controller) pending.current = null;
    if (current === generation.current && !controller.signal.aborted) setLoading(false);
   }
  })();
  pending.current = { generation: current, controller, promise };
  return promise;
 }, [projectId]);
 useEffect(() => {
  generation.current += 1; setLoading(true); setAgents([]); setHandoffs([]); setError("");
  void load();
  const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4000);
  const changed = () => void load();
  window.addEventListener("metis:team-changed", changed);
  return () => { generation.current += 1; pending.current?.controller.abort(); pending.current = null; window.clearInterval(timer); window.removeEventListener("metis:team-changed", changed); };
 }, [load]);
 return { agents, handoffs, loading, error, load };
}
function changed() { window.dispatchEvent(new Event("metis:team-changed")); window.dispatchEvent(new Event("metis:chats-changed")); }

/** Load identities once per project, shared by every chat row in the sidebar. */
export function useProjectChatAgents(projectIds: string[]) {
 const projectKey = [...new Set(projectIds)].sort().join(",");
 const [agents, setAgents] = useState<Record<string, ProjectAgent>>({});
 useEffect(() => {
  const controller = new AbortController();
  let version = 0;
  const load = async () => {
   const current = ++version;
   const projectIds = projectKey.split(",").filter(Boolean);
   const teams = await Promise.all(projectIds.map(async projectId => {
    try { return { projectId, agents: (await fetchProjectTeam(projectId, controller.signal)).agents }; }
    catch { return { projectId }; }
   }));
   if (!controller.signal.aborted && current === version) setAgents(previous => mergeProjectChatAgents(previous, projectIds, teams));
  };
  void load();
  window.addEventListener("metis:team-changed", load);
  return () => { controller.abort(); window.removeEventListener("metis:team-changed", load); };
 }, [projectKey]);
 return agents;
}


export function ProjectAgentNav({ projectId, activeChatId, onOpenChat, pinnedChatIds = [], renderIndicator, renderActions }: { projectId: string; activeChatId?: string | null; onOpenChat: (chatId: string) => void; pinnedChatIds?: string[]; renderIndicator?: (chatId: string) => ReactNode; renderActions?: (agent: ProjectAgent, agents: ProjectAgent[]) => ReactNode }) {
 const team = useProjectTeam(projectId);
 const [open, setOpen] = useState(false);
 useEffect(() => { const create = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.projectId === projectId && detail?.target === "nav") setOpen(true); }; window.addEventListener("metis:new-project-agent", create); return () => window.removeEventListener("metis:new-project-agent", create); }, [projectId]);
 return <section aria-label="Project agents" className="space-y-1">
  <div className="flex items-center justify-between px-2.5 pt-2"><span className="text-xs font-medium text-muted-foreground">Agents</span><Button variant="ghost" size="icon-sm" aria-label="New agent" onClick={() => setOpen(true)}><Plus className="size-4"/></Button></div>
  {team.loading ? <p role="status" className="px-2.5 py-3 text-xs text-muted-foreground">Loading agents…</p> : team.error ? <button className="px-2.5 py-3 text-left text-xs text-destructive" onClick={() => void team.load()}>{team.error} Retry</button> : null}
  {team.agents.filter(a => !a.archivedAt).sort((a, b) => Number(pinnedChatIds.includes(b.chatId)) - Number(pinnedChatIds.includes(a.chatId))).map(agent => <div key={agent.id} className={cn("group flex w-full min-w-0 items-center rounded-lg hover:bg-muted", activeChatId === agent.chatId && "bg-muted text-foreground")}>
   <button type="button" onClick={() => onOpenChat(agent.chatId)} aria-current={activeChatId === agent.chatId ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <TeamAgentAvatar color={agent.color} name={agent.name} animated={activeChatId === agent.chatId || agent.status === "running"} className="size-8"/>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[13px] font-medium"><span className="truncate">{agent.name}</span>{activeChatId !== agent.chatId ? renderIndicator?.(agent.chatId) : null}{pinnedChatIds.includes(agent.chatId) ? <Pin className="size-3 shrink-0 fill-current" aria-label="Pinned chat"/> : null}</span><span className="block truncate text-[11px] text-muted-foreground">{agent.role}</span><span className={cn("block text-[11px]", agent.status === "error" ? "text-destructive" : "text-muted-foreground")}><RunStatus status={agent.status} label={labels[agent.status] || agent.status}/></span></span>
   </button>
   {renderActions?.(agent, team.agents)}
  </div>)}
  {!team.loading && !team.error && !team.agents.some(a => !a.archivedAt) ? <p className="px-2.5 py-3 text-xs text-muted-foreground">No agents yet. Add your first teammate.</p> : null}
  <AgentEditor projectId={projectId} open={open} agent={null} agents={team.agents} onOpenChange={setOpen}/>
 </section>;
}

/** Same sidebar mechanics as ordinary chats; identity edits use the agent API. */
export function ProjectAgentActions({ agent, agents, pinned, onTogglePin, onViewLogs, onArchived }: {
 agent: ProjectAgent; agents: ProjectAgent[]; pinned?: boolean; onTogglePin: () => void; onViewLogs: () => void; onArchived: () => void;
}) {
 const [editing, setEditing] = useState<ProjectAgent | null>(null);
 const [renameOpen, setRenameOpen] = useState(false);
 const [renameValue, setRenameValue] = useState("");
 const [archiveOpen, setArchiveOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 async function save(action: "rename" | "archive") {
  setBusy(true); setError("");
  try {
   const response = await fetch(`/api/projects/${agent.projectId}/agents/${agent.id}`, { method: action === "archive" ? "DELETE" : "PATCH", ...(action === "rename" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: renameValue.trim() }) } : {}) });
   const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update agent.");
   setRenameOpen(false); setArchiveOpen(false); changed();
   if (action === "archive") onArchived();
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update agent."); }
  finally { setBusy(false); }
 }
 return <>
  <DropdownMenu>
   <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="mr-0.5 size-7 shrink-0 opacity-100 transition-[width,opacity] duration-150 motion-reduce:transition-none md:w-0 md:overflow-hidden md:px-0 md:opacity-0 md:group-hover:w-7 md:group-hover:opacity-100 md:group-focus-within:w-7 md:group-focus-within:opacity-100 data-[state=open]:w-7 data-[state=open]:opacity-100" aria-label={`Actions for ${agent.name}`} title="Chat actions"><MoreHorizontal className="size-3.5"/></Button></DropdownMenuTrigger>
   <DropdownMenuContent align="end" className="z-[1200]">
    <DropdownMenuItem onSelect={onTogglePin}>{pinned ? <PinOff className="size-3.5"/> : <Pin className="size-3.5"/>}{pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => { setRenameValue(agent.name); setError(""); setRenameOpen(true); }}><Edit3 className="size-3.5"/>Rename</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => setEditing(agent)}><Users className="size-3.5"/>Edit agent</DropdownMenuItem>
    <DropdownMenuItem onSelect={onViewLogs}><FileClock className="size-3.5"/>View logs</DropdownMenuItem>
    <DropdownMenuSeparator/>
    <DropdownMenuItem onSelect={() => { setError(""); setArchiveOpen(true); }}><Archive className="size-3.5"/>Archive</DropdownMenuItem>
   </DropdownMenuContent>
  </DropdownMenu>
  <AgentEditor projectId={agent.projectId} open={!!editing} agent={editing} agents={agents} onOpenChange={value => { if (!value) setEditing(null); }}/>
  <Dialog open={renameOpen} onOpenChange={value => { if (!busy) setRenameOpen(value); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Rename agent</DialogTitle><DialogDescription>The name updates across its chat and team. Its history stays intact.</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (renameValue.trim() && !busy) void save("rename"); }}><label className="grid gap-1.5 text-sm">Name<Input value={renameValue} onChange={event => setRenameValue(event.target.value)} maxLength={120} autoFocus/></label>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setRenameOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !renameValue.trim()}>{busy ? "Saving…" : "Save"}</Button></DialogFooter></form></DialogContent></Dialog>
  <Dialog open={archiveOpen} onOpenChange={value => { if (!busy) setArchiveOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Archive {agent.name}?</DialogTitle><DialogDescription>Its history and past handoffs remain available. Running tasks and dependent handoffs will be cancelled. Team members reporting to this agent become independent.</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setArchiveOpen(false)}>Keep agent</Button><Button variant="destructive" disabled={busy} onClick={() => void save("archive")}>{busy ? "Archiving…" : "Archive agent"}</Button></DialogFooter></DialogContent></Dialog>
 </>;
}

export function ProjectAgentsPanel({ projectId, onOpenChat }: { projectId: string; onOpenChat: (chatId: string) => void }) {
 const team = useProjectTeam(projectId);
 const [editing, setEditing] = useState<ProjectAgent | null>(null);
 const [open, setOpen] = useState(false);
 const [removing, setRemoving] = useState<ProjectAgent | null>(null);
 const [busy, setBusy] = useState(false);
 const [actionError, setActionError] = useState("");
 const [showArchived, setShowArchived] = useState(false);
 useEffect(() => {
  const create = (event: Event) => { if ((event as CustomEvent).detail?.projectId === projectId && (event as CustomEvent).detail?.target !== "nav") { setEditing(null); setOpen(true); } };
  window.addEventListener("metis:new-project-agent", create);
  return () => window.removeEventListener("metis:new-project-agent", create);
 }, [projectId]);
 async function archive() {
  if (!removing) return;
  setBusy(true); setActionError("");
  try {
   const response = await fetch(`/api/projects/${projectId}/agents/${removing.id}`, { method: "DELETE" });
   const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not archive agent.");
   setRemoving(null); changed();
  } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Could not archive agent."); }
  finally { setBusy(false); }
 }
 const [presetsOpen, setPresetsOpen] = useState(false);
 const visible = team.agents.filter(a => showArchived || !a.archivedAt);
 return <section className="space-y-4" aria-label="Agent team" data-slot="project-agents">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold">Your team</h2><p className="mt-1 text-xs text-muted-foreground">Message an agent to start work. Handoffs stay visible across the team.</p></div><Button variant="outline" size="sm" onClick={() => setPresetsOpen(true)}>Team presets</Button></div>
  {team.error || actionError ? <p role="alert" className="text-sm text-destructive">{team.error || actionError} <button className="underline" onClick={() => void team.load()}>Retry</button></p> : null}
  {team.loading ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading team…</p> : !visible.length && team.error ? null : !visible.length ? <div className="py-6"><h3 className="text-sm font-medium">Give your project a team</h3><p className="mt-1 text-sm text-muted-foreground">Create any role, or add a Coordinator, Planner, Software Engineer, and Tester.</p><Button variant="outline" className="mt-3" onClick={async () => { setActionError(""); try { const r = await fetch(`/api/projects/${projectId}/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset: true }) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); changed(); } catch (e) { setActionError(e instanceof Error ? e.message : "Could not create team."); } }}>Add starter team</Button></div> : <ul className="divide-y divide-border/50">
   {visible.map(agent => <li key={agent.id} className="flex items-center gap-3 py-3">
    <button onClick={() => onOpenChat(agent.chatId)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${agent.name} chat`}><TeamAgentAvatar color={agent.color} name={agent.name} animated={agent.status === "running"}/><span className="min-w-0"><span className="block truncate text-sm font-medium">{agent.name}</span><span className="block text-xs text-muted-foreground">{agent.role}</span><span className="mt-0.5 block text-xs text-muted-foreground">{agent.supervisorId ? `Reports to ${team.agents.find(a => a.id === agent.supervisorId)?.name || "archived supervisor"} · ` : ""}<RunStatus status={agent.status} label={labels[agent.status] || agent.status}/></span></span></button>
    {!agent.archivedAt ? <><Button variant="ghost" size="icon-sm" aria-label={`Edit ${agent.name}`} onClick={() => { setEditing(agent); setOpen(true); }}><Edit3 className="size-4"/></Button><Button variant="ghost" size="icon-sm" aria-label={`Archive ${agent.name}`} onClick={() => setRemoving(agent)}><Trash2 className="size-4"/></Button></> : <span className="text-xs text-muted-foreground">History kept</span>}
   </li>)}
  </ul>}
  {team.agents.some(a => a.archivedAt) ? <button className="text-xs text-muted-foreground underline" onClick={() => setShowArchived(v => !v)}>{showArchived ? "Hide archived agents" : "Show archived agents"}</button> : null}
  <TeamActivity projectId={projectId} agents={team.agents} handoffs={team.handoffs}/>
  <TeamPresetDialog open={presetsOpen} onOpenChange={setPresetsOpen} projectId={projectId} useLabel="Import agents" onUse={async draft => {
   const response = await fetch(`/api/projects/${projectId}/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft }) });
   const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not import team"); changed();
  }}/>
  <AgentEditor projectId={projectId} open={open} agent={editing} agents={team.agents} onOpenChange={setOpen}/>
  <Dialog open={!!removing} onOpenChange={value => { if (!value) setRemoving(null); }}><DialogContent><DialogHeader><DialogTitle>Archive {removing?.name}?</DialogTitle><DialogDescription>Its history and past handoffs remain available. Running tasks and dependent handoffs will be cancelled. Team members reporting to this agent become independent.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Keep agent</Button><Button variant="destructive" disabled={busy} onClick={() => void archive()}>{busy ? "Archiving…" : "Archive agent"}</Button></DialogFooter></DialogContent></Dialog>
 </section>;
}

function TeamActivity({ projectId, agents, handoffs }: { projectId: string; agents: ProjectAgent[]; handoffs: ProjectHandoff[] }) {
 const [error, setError] = useState("");
 const [busy, setBusy] = useState<string | null>(null);
 async function act(id: string, action: "cancel" | "retry") {
  setBusy(id); setError("");
  try { const r = await fetch(`/api/projects/${projectId}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoffId: id, action }) }); const b = await r.json(); if (!r.ok) throw new Error(b.error || "Could not update handoff."); changed(); }
  catch (e) { setError(e instanceof Error ? e.message : "Could not update handoff."); } finally { setBusy(null); }
 }
 const name = (id?: string) => agents.find(a => a.id === id)?.name || (id ? "Archived agent" : "You");
 return <section className="border-t border-border/60 pt-4" aria-label="Team activity"><h3 className="flex items-center gap-2 text-sm font-medium"><Activity className="size-4"/>Team activity</h3>
  {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  {!handoffs.length ? <p className="py-4 text-sm text-muted-foreground">No handoffs yet. Ask the Coordinator to involve the team.</p> : <ol className="mt-2 divide-y divide-border/40">{handoffs.map(h => <li key={h.id} className="py-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-xs font-medium">{name(h.senderAgentId)}<ArrowRight className="size-3" aria-label="to"/>{name(h.recipientAgentId)}</p><span className={cn("text-xs", h.status === "error" ? "text-destructive" : "text-muted-foreground")}><RunStatus status={h.status} label={h.status}/></span></div>
   <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.task}</p>
   {h.context || h.result || h.error ? <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Context and result</summary>{h.context ? <p className="mt-2 whitespace-pre-wrap break-words"><strong>Context:</strong> {h.context}</p> : null}{h.result ? <p className="mt-2 whitespace-pre-wrap break-words"><strong>Result:</strong> {h.result}</p> : null}{h.error ? <p role="alert" className="mt-2 text-destructive">{h.error}</p> : null}</details> : null}
   <div className="mt-2 flex items-center justify-between gap-2"><time className="text-[11px] text-muted-foreground" dateTime={h.createdAt}>{new Date(h.createdAt).toLocaleString("en")}</time>{["queued", "running"].includes(h.status) ? <Button variant="outline" size="sm" disabled={busy === h.id} onClick={() => void act(h.id, "cancel")}><CircleStop className="size-3.5"/>Stop task</Button> : ["error", "cancelled"].includes(h.status) ? <Button variant="outline" size="sm" disabled={busy === h.id} onClick={() => void act(h.id, "retry")}><RotateCcw className="size-3.5"/>Retry</Button> : null}</div>
  </li>)}</ol>}
 </section>;
}

export function ProjectAgentChatHeader({ projectId, chatId, fallbackTitle, onOpenTeam }: { projectId: string; chatId: string; fallbackTitle: string; onOpenTeam: () => void }) {
 const team = useProjectTeam(projectId);
 const agent = team.agents.find(a => a.chatId === chatId);
 if (!agent) return <div className="min-w-0 flex-1"><p className="truncate text-sm text-muted-foreground">{fallbackTitle}</p>{team.error ? <button type="button" className="text-xs text-destructive focus-visible:outline focus-visible:outline-ring" onClick={() => void team.load()}>Could not load agent · Retry</button> : null}</div>;
 return <div data-slot="project-agent-chat-header" className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
  <TeamAgentAvatar color={agent.color} name={agent.name} animated decorative className="size-8"/>
  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" title={agent.name}>{agent.name}</p><p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"><span className="truncate" title={agent.role}>{agent.role}</span><span aria-hidden="true">·</span><span className="shrink-0"><RunStatus status={agent.status} label={labels[agent.status] || agent.status}/></span></p></div>
  <Button type="button" variant="ghost" size="icon-sm" className="size-11 shrink-0 md:size-8" aria-label="Open agent overview" title="Open agent overview" onClick={onOpenTeam}><Users className="size-4" aria-hidden="true"/></Button>
 </div>;
}

function AgentEditor({ projectId, open, agent, agents, onOpenChange }: { projectId: string; open: boolean; agent: ProjectAgent | null; agents: ProjectAgent[]; onOpenChange: (open: boolean) => void }) {
 const [name, setName] = useState(""); const [role, setRole] = useState(""); const [prompt, setPrompt] = useState(""); const [color, setColor] = useState(COLORS[0]); const [supervisor, setSupervisor] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
 useEffect(() => {
  if (!open) return;
  setName(agent?.name || ""); setRole(agent?.role || ""); setPrompt(agent?.systemPrompt || ""); setColor(agent?.color || COLORS[0]); setSupervisor(agent?.supervisorId || ""); setError("");
 }, [agent, open]);
 async function save() {
  setBusy(true); setError("");
  try {
   const r = await fetch(agent ? `/api/projects/${projectId}/agents/${agent.id}` : `/api/projects/${projectId}/agents`, { method: agent ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, role, systemPrompt: prompt, color, supervisorId: supervisor || null }) });
   const b = await r.json(); if (!r.ok) throw new Error(b.error || "Could not save agent."); onOpenChange(false); changed();
  } catch (e) { setError(e instanceof Error ? e.message : "Could not save agent."); } finally { setBusy(false); }
 }
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{agent ? "Edit agent" : "New agent"}</DialogTitle><DialogDescription>Define its role and working style. Each agent keeps a persistent chat.</DialogDescription></DialogHeader>
  <div className="grid gap-4"><div className="flex items-center gap-3"><TeamAgentAvatar name={name || "New agent"} color={color} className="size-12"/><label className="grid flex-1 gap-1.5 text-sm">Name<Input value={name} maxLength={120} onChange={e => setName(e.target.value)} autoFocus placeholder="Coordinator"/></label></div>
   <label className="grid gap-1.5 text-sm">Role<Input value={role} maxLength={120} onChange={e => setRole(e.target.value)} placeholder="Organizes the team and reports results"/></label>
   <label className="grid gap-1.5 text-sm">System prompt<Textarea value={prompt} maxLength={20000} onChange={e => setPrompt(e.target.value)} rows={5} placeholder="Responsibilities, boundaries, and working style"/></label>
   <fieldset><legend className="mb-2 text-sm">Avatar color</legend><div className="flex flex-wrap items-center gap-2">{COLORS.map(c => <button key={c} type="button" aria-label={`Avatar color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cn("rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c === color && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}><TeamAgentAvatar name={c} color={c} className="size-8"/></button>)}<label className="sr-only" htmlFor="agent-custom-color">Custom avatar color</label><input id="agent-custom-color" type="color" value={color} onChange={e => setColor(e.target.value)} className="size-8 cursor-pointer rounded border border-input"/></div></fieldset>
   <label className="grid gap-1.5 text-sm">Supervising agent<select value={supervisor} onChange={e => setSupervisor(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">No supervisor</option>{agents.filter(a => a.id !== agent?.id && !a.archivedAt).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || !name.trim() || !role.trim()} onClick={() => void save()}>{busy ? "Saving…" : agent ? "Save changes" : "Create agent"}</Button></DialogFooter>
 </DialogContent></Dialog>;
}
