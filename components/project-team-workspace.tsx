"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowUp, ArrowRight, Focus, MessageSquare, Minus, Plus, RefreshCw, Users, ChevronDown, X } from "lucide-react";
import { useInfiniteViewport } from "@/components/use-infinite-viewport";
import { Button } from "@/components/ui/button";
import { TeamAgentAvatar } from "@/components/team-agent-avatar";
import { useProjectTeam } from "@/components/project-agents-panel";
import { buildTeamGraph, handoffTime, isActiveHandoff } from "@/lib/project-team-graph";
import type { ProjectAgentStatus, ProjectHandoff } from "@/lib/project-team-types";
import { cn } from "@/lib/utils";

const statusLabels: Record<ProjectAgentStatus, string> = { idle: "Ready", completed: "Ready", queued: "Queued", running: "Working", waiting_input: "Waiting for you", error: "Needs attention", cancelled: "Cancelled", archived: "Archived" };
const activityLabels: Record<ProjectHandoff["status"], string> = { queued: "Queued", running: "In progress", completed: "Completed", error: "Failed", cancelled: "Cancelled" };
function statusColor(status: string) {
 return status === "running" ? "text-blue-500" : status === "queued" || status === "waiting_input" ? "text-amber-500" : status === "error" ? "text-destructive" : "text-muted-foreground";
}
function ago(timestamp: number) {
 const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
 return minutes < 1 ? "Just now" : minutes < 60 ? minutes + "m ago" : minutes < 1440 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago";
}

export function ProjectTeamWorkspace({ projectId, chatId, onOpenChat }: { projectId: string; chatId: string; onOpenChat: (chatId: string) => void }) {
 const team = useProjectTeam(projectId);
 const graph = useMemo(() => buildTeamGraph(team.agents, team.handoffs, projectId), [team.agents, team.handoffs, projectId]);
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const [detailsOpen, setDetailsOpen] = useState(false);
 const [filter, setFilter] = useState<"all" | "active">("all");
 const selected = graph.nodes.find(node => node.agent.id === selectedId)?.agent || graph.nodes.find(node => node.agent.chatId === chatId)?.agent || graph.nodes[0]?.agent;
 const supervisor = graph.nodes.find(node => node.agent.id === selected?.supervisorId)?.agent;
 const selectedActivity = graph.activity.filter(h => h.senderAgentId === selected?.id || h.recipientAgentId === selected?.id);
 const shownActivity = graph.activity.filter(h => filter !== "active" || isActiveHandoff(h)).slice(0, 20);
 const highlightedHandoff = selectedActivity.find(isActiveHandoff) || selectedActivity[0];
 const working = graph.nodes.filter(node => node.agent.status === "running").length;
 const waiting = graph.nodes.filter(node => node.agent.status === "waiting_input").length;
 const activeExchanges = graph.activity.filter(isActiveHandoff).length;
 const { viewport, view, updateView, fit, zoom, panning, pointerHandlers } = useInfiniteViewport(graph.width, graph.height, !team.loading && graph.nodes.length > 0);
 const marker = useId().replace(/:/g, "");
 useEffect(() => { setSelectedId(null); setFilter("all"); setDetailsOpen(false); }, [projectId]);
 useEffect(() => { setSelectedId(null); }, [chatId]);
 const labelScale = Math.max(0.65, view.zoom);
 const positions = new Map(graph.nodes.map(node => [node.agent.id, node]));
 const name = (id: string | undefined, fallback: string | undefined) => positions.get(id || "")?.agent.name || team.agents.find(agent => agent.id === id)?.name || fallback || "Project";
 if (team.loading) return <div role="status" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading team…</div>;
 if (!graph.nodes.length) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><Users className="size-7 text-muted-foreground"/><p className="text-sm">{team.error || "No agents in this team yet."}</p>{team.error ? <Button variant="outline" onClick={() => void team.load()}>Retry</Button> : <p className="text-xs text-muted-foreground">Add an agent from the project’s Team page.</p>}</div>;
 return <section onKeyDown={event => { if (event.key === "Escape" && detailsOpen) { event.preventDefault(); setDetailsOpen(false); } }} aria-label="Team overview" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
  <header className="shrink-0 border-b border-border/40 px-4 py-3">
   <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Team overview</h2><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", team.error ? "bg-amber-500" : "bg-blue-500")}/>{team.error ? "Update paused" : "Live"}</span></div>
   <p className="mt-1 text-xs text-muted-foreground">{graph.nodes.length} {graph.nodes.length === 1 ? "agent" : "agents"} · {working} working · {waiting} waiting for you · {activeExchanges} active {activeExchanges === 1 ? "handoff" : "handoffs"}</p>
  </header>
  {team.error ? <div role="alert" className="flex items-center justify-between gap-2 px-2 pb-2 text-xs text-amber-500"><span>Could not refresh team. Showing the last update.</span><Button variant="ghost" size="icon-sm" aria-label="Refresh team" onClick={() => void team.load()}><RefreshCw className="size-3.5"/></Button></div> : null}
  <div className="relative min-h-0 flex-1">
  <div ref={viewport} role="region" aria-label="Agent hierarchy graph" tabIndex={0} onKeyDown={event => {
   if (event.target !== event.currentTarget) return;
   const movement: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
   if (movement[event.key]) { event.preventDefault(); const [x, y] = movement[event.key]; updateView(previous => ({ ...previous, x: previous.x + x, y: previous.y + y })); }
   else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
   else if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
   else if (event.key === "0") { event.preventDefault(); fit(); }
  }} {...pointerHandlers}
   aria-description="Scroll or drag to move. Ctrl or Command plus scroll to zoom. Pinch on touch screens. Arrow keys move, plus and minus zoom, zero fits the team."
   className={cn("relative h-full min-h-[200px] touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", panning ? "cursor-grabbing" : "cursor-grab")}
   style={{
    backgroundColor: "var(--background)",
    backgroundImage: "radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--muted-foreground) 24%, transparent) 1px, transparent 1.2px)",
    backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
   }}>
   <div className="absolute left-0 top-0 origin-top-left" style={{ width: graph.width, height: graph.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
    <svg aria-hidden="true" width={graph.width} height={graph.height} className="absolute inset-0 overflow-visible">
     <defs><marker id={marker + "-report"} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" className="fill-muted-foreground"/></marker><marker id={marker + "-handoff"} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="context-stroke"/></marker></defs>
     {graph.reporting.map(edge => { const child = positions.get(edge.source)!, parent = positions.get(edge.target)!; return <path key={edge.source} d={`M${child.x},${child.y - 30} C${child.x},${child.y - 90} ${parent.x},${parent.y + 85} ${parent.x},${parent.y + 32}`} fill="none" className="stroke-muted-foreground/40" strokeWidth="1.2" markerEnd={`url(#${marker}-report)`}/>; })}
     {graph.exchanges.map(edge => { const from = positions.get(edge.source)!, to = positions.get(edge.target)!; const direction = to.x >= from.x ? 1 : -1; const bend = from.y === to.y ? -65 : 70 * direction; return <path key={edge.source + edge.target} d={`M${from.x + direction * 28},${from.y} Q${(from.x + to.x) / 2 + bend},${(from.y + to.y) / 2 + (from.y === to.y ? -65 : 0)} ${to.x - direction * 30},${to.y}`} fill="none" stroke="currentColor" strokeWidth={edge.active ? 1.8 : 1.2} strokeDasharray={edge.active ? "5 4" : "2 5"} className={edge.active ? "text-blue-500" : "text-muted-foreground/35"} markerEnd={`url(#${marker}-handoff)`}><title>{name(edge.source, undefined)} → {name(edge.target, undefined)}: {edge.handoff.task} ({activityLabels[edge.handoff.status]})</title></path>; })}
    </svg>
    {graph.nodes.map(({ agent, x, y }) => <button key={agent.id} type="button" aria-label={agent.name + ", " + statusLabels[agent.status] + (agent.supervisorId ? ", reports to " + name(agent.supervisorId, "unavailable agent") : ", no supervisor")} aria-pressed={selected?.id === agent.id} onClick={() => { setSelectedId(agent.id); setDetailsOpen(true); }} title={agent.role} style={{ left: x, top: y }} className="group absolute flex w-[150px] cursor-pointer -translate-x-1/2 -translate-y-[28px] flex-col items-center rounded-md text-center outline-none focus-visible:ring-2 focus-visible:ring-ring">
     <span className={cn("relative rounded-full border p-1 transition-colors group-hover:border-border", selected?.id === agent.id ? "border-primary bg-background" : "border-transparent bg-background/95")}><TeamAgentAvatar color={agent.color} name={agent.name} decorative animated={agent.status === "running"} className="size-11"/><span className={cn("absolute bottom-0 right-0 flex size-3 items-center justify-center rounded-full bg-background", statusColor(agent.status))}><span className="size-2 rounded-full bg-current"/></span></span>
     <span style={{ fontSize: 13 / labelScale, lineHeight: `${16 / labelScale}px` }} className="mt-1.5 line-clamp-2 max-w-full break-words bg-background/90 px-1 font-medium">{agent.name}</span>
     <span style={{ fontSize: 11 / labelScale, lineHeight: `${14 / labelScale}px` }} className={cn("mt-0.5 bg-background/90 px-1", statusColor(agent.status))}>{statusLabels[agent.status]}{agent.chatId === chatId ? " · This chat" : ""}</span>
    </button>)}
   </div>
  </div>
  <div className="pointer-events-none absolute left-4 right-4 top-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span className="flex items-center gap-1 bg-background/90"><ArrowUp className="size-3"/>Reports to</span><span className="flex items-center gap-1 bg-background/90"><span className="w-4 border-t border-dashed border-blue-500"/>Active handoff</span><span className="flex items-center gap-1 bg-background/90"><span className="w-4 border-t border-dotted border-muted-foreground/60"/>Recent handoff</span></div>
  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
   <Button variant="outline" size="sm" className="h-9 gap-2 bg-background text-xs" aria-expanded={detailsOpen} aria-controls={marker + "-details"} onClick={() => setDetailsOpen(!detailsOpen)}><MessageSquare className="size-3.5"/>Activity{activeExchanges ? <span className="text-muted-foreground">{activeExchanges}</span> : null}<ChevronDown className={cn("size-3.5 transition-transform", !detailsOpen && "rotate-180")}/></Button>
   <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5"><Button size="icon-sm" variant="ghost" className="size-8" aria-label="Zoom out team graph" onClick={() => zoom(1 / 1.2)}><Minus className="size-3.5"/></Button><span className="min-w-9 text-center text-[11px] tabular-nums text-muted-foreground" aria-live="polite">{Math.round(view.zoom * 100)}%</span><Button size="icon-sm" variant="ghost" className="size-8" aria-label="Zoom in team graph" onClick={() => zoom(1.2)}><Plus className="size-3.5"/></Button><span className="mx-0.5 h-4 border-l border-border/60"/><Button size="icon-sm" variant="ghost" className="size-8" aria-label="Fit team graph" onClick={fit}><Focus className="size-3.5"/></Button></div>
  </div>
  <p className="pointer-events-none absolute bottom-14 left-4 text-[10px] text-muted-foreground"><span className="hidden sm:inline">Scroll or drag to move · Ctrl / ⌘ + scroll to zoom</span><span className="sm:hidden">Drag to move · Pinch to zoom</span></p>
  {detailsOpen ? <div id={marker + "-details"} aria-label="Agent details and team activity" className="absolute bottom-[76px] left-3 right-3 max-h-[min(55%,420px)] overflow-y-auto overscroll-contain rounded-md border border-border bg-background px-3 shadow-sm">
   <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/40 bg-background py-1.5"><span className="text-[11px] text-muted-foreground">Agent & activity</span><Button variant="ghost" size="icon-sm" aria-label="Close agent details" onClick={() => setDetailsOpen(false)}><X className="size-3.5"/></Button></div>
   {selected ? <div className="py-3">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-xs font-semibold">{selected.name}</h3><p className="mt-1 break-words text-[11px] text-muted-foreground">{selected.role}</p></div><Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" disabled={selected.chatId === chatId} onClick={() => onOpenChat(selected.chatId)}><MessageSquare className="size-3.5"/>{selected.chatId === chatId ? "This chat" : "Open chat"}</Button></div>
    <p className="mt-2 text-[11px] text-muted-foreground">{supervisor ? "Reports to " + supervisor.name : selected.supervisorId ? "Supervisor unavailable" : "No supervisor"} · {graph.reporting.filter(edge => edge.target === selected.id).length} direct reports</p>
    {highlightedHandoff ? <p className="mt-1.5 line-clamp-2 text-[11px]"><span className="text-muted-foreground">{isActiveHandoff(highlightedHandoff) ? "Active handoff: " : "Latest handoff: "}</span>{highlightedHandoff.task}</p> : <p className="mt-1.5 text-[11px] text-muted-foreground">No handoffs yet.</p>}
   </div> : null}
   <div className="sticky top-[45px] flex items-center justify-between gap-2 border-t border-border/40 bg-background py-2"><h3 className="text-xs font-semibold">Team activity</h3><div className="flex gap-0.5">{(["all", "active"] as const).map(value => <Button key={value} variant={filter === value ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-[11px]" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "Recent" : "Active"}</Button>)}</div></div>
   {shownActivity.length ? <ol className="divide-y divide-border/30 pb-2">{shownActivity.map(handoff => <li key={handoff.id} className="py-2.5">
    <div className="flex items-start justify-between gap-2"><span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] font-medium"><span>{name(handoff.senderAgentId, handoff.senderName)}</span><ArrowRight className="size-3 shrink-0 text-muted-foreground"/><span>{name(handoff.recipientAgentId, handoff.recipientName)}</span></span><time dateTime={handoff.updatedAt} title={new Date(handoffTime(handoff)).toLocaleString("en")} className="shrink-0 text-[10px] text-muted-foreground">{ago(handoffTime(handoff))}</time></div>
    <p className="mt-1 line-clamp-2 break-words text-xs">{handoff.task}</p><p className={cn("mt-1 text-[10px]", statusColor(handoff.status))}>{activityLabels[handoff.status]}</p>
    {handoff.error ? <p className="mt-1 line-clamp-2 text-[11px] text-destructive">{handoff.error}</p> : handoff.result ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{handoff.result}</p> : null}
   </li>)}</ol> : <p className="py-4 text-xs text-muted-foreground">{filter === "active" ? "No active handoffs." : "Handoffs and replies will appear here when agents work together."}</p>}
  </div> : null}
  </div>
 </section>;
}
