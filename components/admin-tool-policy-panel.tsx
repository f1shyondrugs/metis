"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadError } from "@/components/load-error";
import {
  HOST_TOOL_GROUPS, HOST_TOOL_RULES, isHostToolPolicy,
  type HostToolGroup, type HostToolPolicy, type HostToolRule,
} from "@/lib/mcp-core/host-tool-policy.mjs";

const endpoint = "/api/admin/system/tool-policy";
const labels: Record<HostToolGroup, string> = { terminal: "Terminal & services", files: "File changes" };
const choices: Record<HostToolRule, string> = {
  inherit: "Use existing rules", confirm: "Require approval each time", block: "Block these tools",
};

async function requestPolicy(init?: RequestInit): Promise<HostToolPolicy> {
  const res = await fetch(endpoint, { cache: "no-store", ...init });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data ? data.error : undefined;
    throw new Error(typeof message === "string" ? message : "Could not load tool policy.");
  }
  if (!isHostToolPolicy(data)) throw new Error("Invalid tool policy response.");
  return data;
}

export function AdminToolPolicyPanel() {
  const [saved, setSaved] = useState<HostToolPolicy | null>(null);
  const [draft, setDraft] = useState<HostToolPolicy | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    setLoadError("");
    setSaved(null);
    setDraft(null);
    setNotice("");
    void requestPolicy({ signal: abort.signal }).then(policy => {
      if (abort.signal.aborted) return;
      setSaved(policy);
      setDraft(policy);
    }).catch(error => {
      if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load tool policy.");
    });
    return () => abort.abort();
  }, [loadRevision]);

  if (loadError) return <LoadError message={loadError} onRetry={() => setLoadRevision(n => n + 1)} />;
  if (!saved || !draft) return <p className="text-sm text-muted-foreground" role="status">Loading tool policy…</p>;

  const groups = Object.keys(HOST_TOOL_GROUPS) as HostToolGroup[];
  const changed = groups.filter(group => draft.rules[group] !== saved.rules[group]);
  async function save(policy: HostToolPolicy) {
    const updated = await requestPolicy({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    setSaved(updated);
    setDraft(updated);
    setNotice("Policy saved.");
  }

  return <div className="max-w-2xl space-y-4 pb-4">
    <p className="text-sm text-muted-foreground">
      Set server-wide rules for these Metis agent tools. Existing account, mode and device permissions still apply. Saved rules take effect on the next supported tool call.
    </p>
    <p className="text-xs text-muted-foreground">Tools that require interactive approval cannot run in unattended automations.</p>
    <div className="divide-y divide-border border-y border-border">
      {groups.map(group => {
        const fieldId = `host-tool-policy-${group}`;
        return <div key={group} className="grid items-center gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)]">
          <div className="min-w-0 space-y-1">
            <label htmlFor={fieldId} className="text-sm font-medium">{labels[group]}</label>
            <p id={fieldId + "-details"} className="break-words text-xs text-muted-foreground">
              {HOST_TOOL_GROUPS[group].join(", ")}
            </p>
            <p id={fieldId + "-active"} className="text-xs text-muted-foreground">
              Active: {choices[saved.rules[group]]} · {saved.rules[group] === "inherit" ? "Existing permissions" : "Host admin policy"}
            </p>
          </div>
          <select id={fieldId} aria-describedby={fieldId + "-details " + fieldId + "-active"}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring sm:text-sm"
            value={draft.rules[group]} onChange={event => {
              const rule = event.target.value as HostToolRule;
              if (!HOST_TOOL_RULES.includes(rule)) return;
              setNotice("");
              setDraft({ ...draft, rules: { ...draft.rules, [group]: rule } });
            }}>
            {HOST_TOOL_RULES.map(rule => <option key={rule} value={rule}>{choices[rule]}</option>)}
          </select>
        </div>;
      })}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="action" onClick={() => setConfirm(true)} disabled={!changed.length}>Save changes</Button>
      <Button size="action" variant="ghost" onClick={() => setLoadRevision(n => n + 1)}>Reload saved policy</Button>
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    </div>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm}
      title="Apply server tool rules?"
      description={changed.map(group => `${labels[group]}: ${choices[draft.rules[group]]}.`).join(" ") + " This applies to all supported Metis agent runs."}
      confirmLabel="Apply policy" destructive={false} onConfirm={() => save(draft)} />
  </div>;
}
