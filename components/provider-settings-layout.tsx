"use client";

import { useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";

type Connection = {
  id: string;
  providerKey: string;
  label: string;
  enabled: boolean;
  hasSecret: boolean;
  lastCheckedAt?: string;
  lastError?: string;
};

export function providerConnectionStatus(connection: Connection) {
  if (!connection.enabled) return "Disabled";
  if (connection.lastError) return "Connection error";
  if (connection.lastCheckedAt) return "Ready";
  if (connection.hasSecret) return "Credentials saved";
  return "Not checked";
}

export function ProviderSettingsRow({ label, htmlFor, description, children }: {
  label: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
}) {
  return <div className="grid min-w-0 gap-2 border-b border-border/50 py-4 last:border-b-0 @min-[30rem]/provider-detail:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[30rem]/provider-detail:items-start @min-[30rem]/provider-detail:gap-6">
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
    <div className="min-w-0 [&_input]:w-full">{children}</div>
  </div>;
}

export function ProviderSettingsLayout({
  connections, definitions, selectedId, adding, loaded, error, busy,
  onSelect, onAdd, onRefresh, onToggle, children,
}: {
  connections: Connection[];
  definitions: Array<{ key: string; name: string }>;
  selectedId: string;
  adding: boolean;
  loaded: boolean;
  error?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRefresh: () => Promise<void>;
  onToggle: (id: string) => Promise<void>;
  children: ReactNode;
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const disabled = busy || !loaded || toggling !== null;
  async function toggle(id: string) {
    setToggling(id);
    try { await onToggle(id); } finally { setToggling(null); }
  }

  return <section aria-labelledby="settings-providers" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="settings-providers" className="text-base font-semibold">Providers</h3>
      <Button type="button" variant="ghost" size="sm" disabled={busy || !loaded} onClick={() => void onRefresh()}>
        <RefreshCw aria-hidden="true" className={cn("size-3.5", !loaded && "animate-spin")} />
        {loaded ? "Refresh" : "Refreshing…"}
      </Button>
    </div>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
      <p className="text-destructive">{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()} disabled={!loaded}>Try again</Button>
    </div> : null}
    <div className="grid min-w-0 overflow-hidden rounded-xl border border-border/70 @min-[42rem]/providers:grid-cols-[13.5rem_minmax(0,1fr)]" data-slot="provider-split-view">
      <nav aria-label="Provider connections" className="min-w-0 border-b border-border/70 bg-muted/10 @min-[42rem]/providers:border-b-0 @min-[42rem]/providers:border-r">
        <div className="max-h-64 overflow-y-auto @min-[42rem]/providers:max-h-[36rem]">
          {!loaded && connections.length === 0 ? <p role="status" className="px-4 py-6 text-sm text-muted-foreground">Loading provider connections…</p>
            : connections.length === 0 ? <p className="px-4 py-6 text-sm leading-relaxed text-muted-foreground">No connections yet. Add a provider to get started.</p>
            : connections.map(connection => {
              const name = definitions.find(provider => provider.key === connection.providerKey)?.name || connection.providerKey;
              const selected = !adding && connection.id === selectedId;
              return <div key={connection.id} className={cn("flex items-center border-b border-border/50 pr-3 transition-colors", selected ? "bg-muted/70" : "hover:bg-muted/40")}>
                <button type="button" disabled={disabled} aria-current={selected ? "true" : undefined}
                  aria-controls="provider-connection-detail" onClick={() => onSelect(connection.id)}
                  className="flex min-h-20 min-w-0 flex-1 items-start gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60">
                  <ProviderLogo providerId={connection.providerKey} className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{connection.label}</span>
                    {connection.label !== name ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{name}</span> : null}
                    <span className={cn("mt-1 flex items-center gap-1.5 text-xs", connection.enabled && connection.lastError ? "text-destructive" : "text-muted-foreground")}>
                      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", !connection.enabled ? "bg-muted-foreground/60" : connection.lastError ? "bg-destructive" : connection.lastCheckedAt ? "bg-emerald-500" : "bg-muted-foreground/60")} />
                      {providerConnectionStatus(connection)}
                    </span>
                  </span>
                </button>
                <Switch checked={connection.enabled} disabled={disabled} aria-label={`Enable ${connection.label}`}
                  onCheckedChange={() => void toggle(connection.id)} />
              </div>;
            })}
        </div>
        <button type="button" onClick={onAdd} disabled={disabled || !definitions.length} aria-current={adding ? "true" : undefined}
          className={cn("flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50", adding ? "bg-muted/70 text-foreground" : "text-muted-foreground")}>
          <Plus aria-hidden="true" className="size-4" /> Add provider
        </button>
      </nav>
      <div id="provider-connection-detail" className="@container/provider-detail min-w-0 p-4 sm:p-5" aria-busy={!loaded}>
        {children}
      </div>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">Credentials are encrypted on the server and never sent back to your browser.</p>
  </section>;
}
