"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Compass, Library, PlugZap, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectionCatalog } from "@/components/connection-catalog";
import { McpEnvEditor } from "@/components/mcp-env-editor";
import type { AgentMode, ToolPermissionCategory } from "@/lib/store";
import { TOOL_PERMISSION_CATEGORIES } from "@/lib/modes";
type McpServer = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  configured_env_keys?: string[];
  can_edit_environment?: boolean;
  configured_header_keys?: string[];
};

type McpDraft = {
  id: string;
  name: string;
  kind: "remote" | "stdio";
  url: string;
  command: string;
  args: string;
  headers: string;
};

const emptyMcpDraft: McpDraft = {
  id: "",
  name: "",
  kind: "remote",
  url: "",
  command: "",
  args: "",
  headers: "",
};

export function HubConnections({isHostAdmin}: {isHostAdmin: boolean}) {
 const [mcpServers,setMcpServers]=useState<McpServer[]>([]);
 const [mcpLoaded,setMcpLoaded]=useState(false);
 const [mcpError,setMcpError]=useState("");
 const [mcpDraft,setMcpDraft]=useState<McpDraft>(emptyMcpDraft);
 const [mcpBusy,setMcpBusy]=useState(false);
 const [view,setView]=useState<"installed"|"discover"|"custom">("installed");
 const [query,setQuery]=useState("");
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [catalogBusy,setCatalogBusy]=useState(false);
 const [deleteTarget,setDeleteTarget]=useState<McpServer|null>(null);
  const loadMcpServers = useCallback(async () => {
    setMcpError("");
    try {
      const res = await fetch("/api/mcp-servers", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load MCP servers");
      const data = (await res.json()) as { servers?: McpServer[] };
      setMcpServers(data.servers || []);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : "Failed to load connections");
    } finally {
      setMcpLoaded(true);
    }
  }, []);

useEffect(() => { void loadMcpServers(); }, [loadMcpServers]);
  function parseLines(value: string) {
    const entries: Record<string, string> = {};
    for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error("Environment and header lines must use NAME=value");
      const key = line.slice(0, separator).trim();
      const item = line.slice(separator + 1);
      if (!/^[A-Za-z_][A-Za-z0-9-]*$/.test(key)) throw new Error(`Invalid key: ${key}`);
      entries[key] = item;
    }
    return entries;
  }

  async function saveMcpServer() {
    if (!isHostAdmin || mcpBusy) return;
    setMcpBusy(true);
    try {
      if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(mcpDraft.id)) {
        throw new Error("ID must use 2-64 lowercase characters, numbers, dots, underscores, or hyphens");
      }
      if (!mcpDraft.name.trim()) throw new Error("Name is required");
      if (mcpDraft.kind === "remote" && !mcpDraft.url.trim()) throw new Error("URL is required");
      if (mcpDraft.kind === "stdio" && !mcpDraft.command.trim()) throw new Error("Command is required");
      const headers = parseLines(mcpDraft.headers);
      const body = {
        id: mcpDraft.id.trim(),
        name: mcpDraft.name.trim(),
        kind: mcpDraft.kind,
        ...(mcpDraft.url.trim() ? { url: mcpDraft.url.trim() } : {}),
        ...(mcpDraft.command.trim() ? { command: mcpDraft.command.trim() } : {}),
        ...(mcpDraft.args.trim() ? { args: mcpDraft.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      };
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save MCP server");
      setMcpDraft(emptyMcpDraft);
      await loadMcpServers();
      setView("installed");
      toast.success("Connection saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save MCP server");
    } finally {
      setMcpBusy(false);
    }
  }

  function editMcpServer(server: McpServer) {
    setSelectedId(null);
    setView("custom");
    setMcpDraft({
      id: server.id,
      name: server.name,
      kind: server.kind,
      url: server.url || "",
      command: server.command || "",
      args: server.args?.join("\n") || "",
      headers: "",
    });
  }

  async function toggleMcpServer(server: McpServer) {
    if (!isHostAdmin || mcpBusy) return;
    setMcpBusy(true);
    try {
      const res = await fetch("/api/mcp-servers/" + encodeURIComponent(server.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      if (!res.ok) throw new Error("Failed to update connection");
      await loadMcpServers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update connection");
    } finally { setMcpBusy(false); }
  }

  async function deleteMcpServer(server: McpServer) {
    if (!isHostAdmin || mcpBusy) return;
    setMcpBusy(true);
    try {
      const res = await fetch("/api/mcp-servers/" + encodeURIComponent(server.id), { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete connection");
      await loadMcpServers();
      setSelectedId(null);
      if (mcpDraft.id === server.id) setMcpDraft(emptyMcpDraft);
      toast.success("Connection deleted");
    } finally { setMcpBusy(false); }
  }

  const selected = mcpServers.find(server => server.id === selectedId);
  const filtered = mcpServers.filter(server => query.toLowerCase().trim().split(/\s+/).filter(Boolean).every(term =>
    [server.name, server.id, server.kind, server.url, server.command, server.enabled ? "enabled" : "disabled"].join(" ").toLowerCase().includes(term)
  ));
  const confirmation = <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)} title="Delete connection?" description={"Remove "+(deleteTarget?.name || "this connection")+" and its saved configuration?"} confirmLabel="Delete" onConfirm={() => deleteTarget ? deleteMcpServer(deleteTarget) : undefined} />;

  if (selected) return <section className="flex min-h-0 flex-1 flex-col" aria-label="Connection details">
    <header className="space-y-4 border-b border-border px-5 py-4 sm:px-7">
      <Button variant="ghost" className="h-9 px-0 text-muted-foreground" onClick={() => setSelectedId(null)}><ArrowLeft /> All connections</Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><PlugZap className="mt-1 size-7 shrink-0" /><div className="min-w-0"><h3 className="break-words text-xl font-semibold">{selected.name}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{selected.kind === "remote" ? "Remote connection" : "Local tool"} · {selected.enabled ? "Enabled" : "Disabled"}</p></div></div>
        <div className="flex gap-2"><Button variant="outline" disabled={!isHostAdmin || mcpBusy} onClick={() => editMcpServer(selected)}>Edit connection</Button><Button variant="ghost" size="icon" disabled={!isHostAdmin || mcpBusy} onClick={() => setDeleteTarget(selected)} aria-label={"Delete " + selected.name}><Trash2 className="size-4" /></Button></div>
      </div>
    </header>
    <div className="min-w-0 overflow-auto p-5 sm:p-7">
      <div className="space-y-4 rounded-xl border border-border bg-background p-4">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Name</dt><dd className="break-words">{selected.name}</dd>
          <dt className="text-muted-foreground">Server ID</dt><dd className="break-all">{selected.id}</dd>
          <dt className="text-muted-foreground">{selected.kind === "remote" ? "URL" : "Command"}</dt><dd className="break-all">{selected.kind === "remote" ? selected.url || "Not provided" : selected.command || "Not provided"}</dd>
          {selected.args?.length ? <><dt className="text-muted-foreground">Arguments</dt><dd className="whitespace-pre-wrap break-all">{selected.args.join("\n")}</dd></> : null}
          {(selected.configured_env_keys?.length || selected.configured_header_keys?.length) ? <><dt className="text-muted-foreground">Credentials</dt><dd className="break-words">{[...(selected.configured_env_keys || []), ...(selected.configured_header_keys || [])].join(", ")}</dd></> : null}
        </dl>
        <div className="border-t border-border pt-3"><label className="flex items-center gap-3 text-sm"><Switch checked={Boolean(selected.enabled)} disabled={!isHostAdmin || mcpBusy} aria-label={"Enable " + selected.name} onCheckedChange={() => void toggleMcpServer(selected)} />Enabled</label></div>
        <p className="text-xs text-muted-foreground">Saved credentials remain private. Their values are never returned to the editor.</p>
      </div>
      {selected.kind === "stdio" ? selected.can_edit_environment ? <McpEnvEditor key={selected.id} serverId={selected.id} onSaved={() => void loadMcpServers()} /> : <p className="mt-4 text-xs text-muted-foreground">Only the connection owner can edit environment variables.</p> : null}
      {mcpError ? <p role="alert" className="mt-4 text-sm text-destructive">{mcpError}</p> : null}
      {!isHostAdmin ? <p className="mt-4 text-xs text-muted-foreground">A host administrator can manage server connections.</p> : null}
    </div>{confirmation}
  </section>;

  return <section className="min-w-0 overflow-auto p-5 sm:p-7" aria-label="Connection library">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-xl font-semibold">Connections</h3><p className="mt-1 text-sm text-muted-foreground">Services and tools for your agent through MCP.</p></div>
      <Button variant="outline" disabled={mcpBusy || catalogBusy} onClick={() => { setMcpDraft(emptyMcpDraft); setView("custom"); }}><Plus /> Add connection</Button>
    </div>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <Tabs value={view} onValueChange={value => setView(value as typeof view)}><TabsList aria-label="Connection library views">
        <TabsTrigger value="installed" disabled={mcpBusy || catalogBusy}><Library className="size-4" /> Installed</TabsTrigger>
        <TabsTrigger value="discover" disabled={mcpBusy || catalogBusy}><Compass className="size-4" /> Discover</TabsTrigger>
        <TabsTrigger value="custom" disabled={mcpBusy || catalogBusy}><Plus className="size-4" /> Custom</TabsTrigger>
      </TabsList></Tabs>
      {view !== "custom" ? <div className="relative min-w-0 sm:ml-auto sm:w-64 sm:shrink-0"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="h-10 pl-9" value={query} disabled={catalogBusy} onChange={event => setQuery(event.target.value)} placeholder="Search connections…" aria-label="Search connections" /></div> : null}
    </div>
    {view === "installed" ? <>
      {mcpError ? <div role="alert" className="mb-4 text-sm text-destructive">{mcpError}<Button variant="ghost" onClick={() => void loadMcpServers()}>Try again</Button></div> : null}
      {!mcpLoaded ? <div role="status" aria-label="Loading connections" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0,1,2].map(item => <Skeleton key={item} className="h-44 rounded-xl" />)}</div>
      : !mcpError && !filtered.length ? <p className="text-sm text-muted-foreground">{query.trim() ? "No connections match your search." : "No connections installed. Discover a service or add a custom connection."}</p>
      : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(server => <button type="button" key={server.id} onClick={() => setSelectedId(server.id)} className="group flex min-h-44 min-w-0 flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between"><PlugZap className="size-5 text-muted-foreground" /><ArrowUpRight className="size-4 text-muted-foreground" /></div>
        <h4 className="mt-4 break-words text-sm font-semibold">{server.name}</h4>
        <p className="mt-1 line-clamp-2 break-all text-xs leading-5 text-muted-foreground">{server.kind === "remote" ? server.url || server.id : server.command || server.id}</p>
        <p className="mt-auto break-words pt-4 text-[11px] text-muted-foreground">{server.kind === "remote" ? "Remote" : "Local tool"} · {server.enabled ? "Enabled" : "Disabled"}</p>
      </button>)}</div>}
    </> : null}
    {view === "discover" ? <ConnectionCatalog query={query} isHostAdmin={isHostAdmin} onBusyChange={setCatalogBusy} onCustomize={async id => {
      try {
        const response = await fetch("/api/mcp-servers", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the connection configuration.");
        const body = await response.json() as { servers?: McpServer[] };
        const server = body.servers?.find(item => item.id === id);
        if (!server) throw new Error("The connection configuration is no longer available.");
        setMcpServers(body.servers || []);
        editMcpServer(server);
      } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load the connection configuration."); }
    }} onInstalled={() => { void loadMcpServers(); setQuery(""); setView("installed"); toast.success("Connection ready"); }} /> : null}
    {view === "custom" ? <form id="custom-connection-form" aria-label="Custom connection" className="max-w-2xl space-y-4" onSubmit={event => { event.preventDefault(); void saveMcpServer(); }}>
      <div><h4 className="text-sm font-semibold">{mcpDraft.id && mcpServers.some(server => server.id === mcpDraft.id) ? "Edit connection" : "Add a custom connection"}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">Connect an MCP server by URL or run a local tool. Leave credentials blank to keep existing values.</p></div>
      <fieldset disabled={!isHostAdmin || mcpBusy} className="min-w-0 space-y-4">                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={mcpDraft.name}
                    onBlur={() => setMcpDraft(current => ({ ...current, id: current.id || current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) }))}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Display name"
                    aria-label="MCP server name"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "remote" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "remote" }))}
                  >
                    Connect by URL
                  </Button>
                  <Button
                    type="button"
                    variant={mcpDraft.kind === "stdio" ? "default" : "outline"}
                    onClick={() => setMcpDraft((current) => ({ ...current, kind: "stdio" }))}
                  >
                    Run a local tool
                  </Button>
                </div>
                {mcpDraft.kind === "remote" ? (
                  <Input
                    value={mcpDraft.url}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, url: e.target.value }))}
                    placeholder="https://example.com/mcp"
                    aria-label="MCP server URL"
                  />
                ) : (
                  <>
                    <Input
                      value={mcpDraft.command}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, command: e.target.value }))}
                      placeholder="npx"
                      aria-label="MCP command"
                    />
                    <Textarea
                      value={mcpDraft.args}
                      onChange={(e) => setMcpDraft((current) => ({ ...current, args: e.target.value }))}
                      placeholder={"One argument per line\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed-directory"}
                      aria-label="MCP arguments"
                      rows={4}
                    />
                  </>
                )}
                <details className="sm:col-span-2"><summary className="min-h-10 cursor-pointer text-sm">Credentials and advanced options</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">                  <Input
                    value={mcpDraft.id}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, id: e.target.value }))}
                    placeholder="server-id"
                    aria-label="MCP server ID"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">Save the connection, then open its details to manage environment variables securely.</p>
                  <Textarea
                    value={mcpDraft.headers}
                    onChange={(e) => setMcpDraft((current) => ({ ...current, headers: e.target.value }))}
                    placeholder={"Headers (NAME=value)\nAuthorization=Bearer ..."}
                    aria-label="MCP headers"
                    rows={4}
                  />
                </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={mcpBusy}>
                    {mcpBusy ? "Saving…" : "Save connection"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setMcpDraft(emptyMcpDraft)}>
                    Clear
                  </Button>
                </div>
</fieldset>
      {!isHostAdmin ? <p className="text-xs text-muted-foreground">A host administrator can manage server connections.</p> : null}
    </form> : null}
    {confirmation}
  </section>;
}

export function HubModes({onModesChanged}: {onModesChanged?: () => void}) {
const [modeError,setModeError]=useState("");
const [modesLoaded,setModesLoaded]=useState(false);
  const [customModes, setCustomModes] = useState<AgentMode[]>([]);
  const [modeDraft, setModeDraft] = useState<AgentMode>({
    id: "",
    name: "",
    description: "",
    icon: "sliders-horizontal",
    instructions: "",
    allowedCategories: ["read"],
  });
  const [modeOverridesDraft, setModeOverridesDraft] = useState("{}");
  const loadCustomModes = useCallback(async () => {
    setModeError("");
    try {
    const response = await fetch("/api/modes", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load modes");
    const data = (await response.json()) as { modes?: AgentMode[] };
    setCustomModes((data.modes || []).filter((mode) => !mode.builtIn));
    } catch (error) { setModeError(error instanceof Error ? error.message : "Could not load modes"); } finally { setModesLoaded(true); }
  }, []);

useEffect(() => { void loadCustomModes(); }, [loadCustomModes]);
  async function saveCustomMode() {
    try {
    const overrides = JSON.parse(modeOverridesDraft);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.values(overrides).some(value => typeof value !== "boolean")) throw new Error("Tool overrides must be a JSON object containing true or false values.");
    const payload = {
      ...modeDraft,
      id: modeDraft.id || undefined,
      allowedCategories: modeDraft.allowedCategories,
      toolOverrides: overrides,
    };
    const response = await fetch("/api/modes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      toast.error("Could not save mode");
      return;
    }
    setModeDraft({ id: "", name: "", description: "", icon: "sliders-horizontal", instructions: "", allowedCategories: ["read"] });
    setModeOverridesDraft("{}");
    await loadCustomModes();
    onModesChanged?.();
    toast.success("Mode saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save mode"); }
  }

  async function deleteCustomMode(mode: AgentMode) {
    try {
    const response = await fetch(`/api/modes?id=${encodeURIComponent(mode.id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Could not delete mode");
    await loadCustomModes();
    onModesChanged?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete mode"); }
  }

return <div className="p-5 sm:p-7"><section className="flex flex-col gap-4">
                <div>
                  <h3  className="text-sm font-medium">Agent modes</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Create reusable modes with custom instructions and server-enforced tool permissions.</p>
                </div>
                <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={modeDraft.name} onChange={(event) => setModeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Mode name" aria-label="Mode name" />
                    <Input value={modeDraft.icon} onChange={(event) => setModeDraft((current) => ({ ...current, icon: event.target.value }))} placeholder="Icon name" aria-label="Mode icon" />
                  </div>
                  <Input value={modeDraft.description} onChange={(event) => setModeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Short description" aria-label="Mode description" />
                  <Textarea value={modeDraft.instructions} onChange={(event) => setModeDraft((current) => ({ ...current, instructions: event.target.value }))} placeholder="Custom instructions for this mode" aria-label="Mode instructions" />
                  <div className="flex flex-wrap gap-1.5">
                    {TOOL_PERMISSION_CATEGORIES.map((category) => {
                      const active = modeDraft.allowedCategories.includes(category);
                      return <Button key={category} type="button" size="xs" variant={active ? "default" : "outline"} onClick={() => setModeDraft((current) => ({ ...current, allowedCategories: active ? current.allowedCategories.filter((item) => item !== category) : [...current.allowedCategories, category as ToolPermissionCategory] }))}>{category}</Button>;
                    })}
                  </div>
                  <Textarea value={modeOverridesDraft} onChange={(event) => setModeOverridesDraft(event.target.value)} placeholder='{"write_file": false}' aria-label="Individual tool overrides" className="min-h-16 font-mono text-xs" />
                  <p className="text-[11px] text-muted-foreground">Optional individual overrides as JSON, for example {"{"}"write_file": false{"}"}</p>
                  <div className="flex justify-end">
                    <Button type="button" onClick={() => void saveCustomMode()} disabled={!modeDraft.name.trim()}>Save mode</Button>
                  </div>
                </div>
                {customModes.length ? (
                  <div className="divide-y rounded-xl border">
                    {customModes.map((mode) => (
                      <div key={mode.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{mode.name}</p><p className="truncate text-xs text-muted-foreground">{mode.description || "Custom mode"}</p></div>
                        <Button type="button" size="xs" variant="ghost" onClick={() => { setModeDraft(mode); setModeOverridesDraft(JSON.stringify(mode.toolOverrides || {}, null, 2)); }}>Edit</Button>
                        <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => void deleteCustomMode(mode)}>Delete</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
{modeError ? <p role="alert" className="text-sm text-destructive">{modeError}<Button variant="ghost" onClick={() => void loadCustomModes()}>Try again</Button></p> : null}{!modesLoaded ? <p role="status">Loading modes…</p> : !modeError && !customModes.length ? <p className="text-sm text-muted-foreground">No custom modes yet. Create one with the instructions and permissions above.</p> : null}
</section>

</div>;
}
