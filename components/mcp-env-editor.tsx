"use client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { key: string; configured: boolean; value: string; remove: boolean };
export function McpEnvEditor({ serverId, onSaved }: { serverId: string; onSaved?: () => void }) {
  const prefix = useId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [envRevision, setEnvRevision] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]);
    void (async () => {
      try {
        const response = await fetch("/api/mcp-servers/" + encodeURIComponent(serverId) + "/env", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { keys: { key: string; configured: boolean }[]; revision: string };
        if (!controller.signal.aborted) setEnvRevision(body.revision);
        if (!controller.signal.aborted) setRows(body.keys.map(row => ({ key: row.key, configured: row.configured, value: "", remove: false })));
      } catch {
        if (!controller.signal.aborted) setError("Could not load environment settings.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [serverId, revision]);
  function change(index: number, patch: Partial<Row>) {
    setSaved(false); setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  async function save() {
    setError(""); setSaved(false);
    const names = rows.map(row => row.key);
    if (names.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) || new Set(names).size !== names.length) {
      setError("Use unique variable names containing letters, numbers and underscores. Start with a letter or underscore."); return;
    }
    if (rows.some(row => !row.configured && !row.value && !row.remove)) {
      setError("Enter a value for each new variable, or remove the unused row."); return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/mcp-servers/" + encodeURIComponent(serverId) + "/env", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: envRevision,
          set: Object.fromEntries(rows.filter(row => !row.remove && row.value !== "").map(row => [row.key, row.value])),
          remove: rows.filter(row => row.configured && row.remove).map(row => row.key),
        }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { revision: string };
      setEnvRevision(result.revision);
      setRows(current => current.filter(row => !row.remove).map(row => ({ ...row, configured: true, value: "" })));
      setSaved(true); onSaved?.();
    } catch { setError("Could not save environment settings. Reload the settings and try again."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 min-w-0 max-w-3xl space-y-4" aria-labelledby={prefix + "-title"}>
    <div><h4 id={prefix + "-title"} className="text-sm font-semibold">Environment variables</h4>
      <p id={prefix + "-help"} className="mt-1 text-xs leading-5 text-muted-foreground">Saved values are never displayed. Leave a replacement blank to keep its value. Remove explicitly to delete a variable.</p></div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading environment settings…</p> :
      <fieldset disabled={busy} className="min-w-0 space-y-3" aria-describedby={prefix + "-help"}>
        {!rows.length && !error ? <p className="text-sm text-muted-foreground">No environment variables configured.</p> : null}
        {rows.map((row, index) => <div key={index} className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="min-w-0 text-xs">Variable name
            <Input className="mt-1 h-11 font-mono" value={row.key} readOnly={row.configured} disabled={row.remove} autoComplete="off" spellCheck={false}
              onChange={event => change(index, { key: event.target.value })} aria-label={"Variable name " + (index + 1)} />
          </label>
          <label className="min-w-0 text-xs">{row.configured ? "Configured · replacement value" : "New value"}
            <Input className="mt-1 h-11" type="password" value={row.value} autoComplete="new-password" spellCheck={false} disabled={row.remove}
              placeholder={row.remove ? "Will be removed" : row.configured ? "Leave blank to preserve" : "Enter value"}
              aria-label={"Value for " + (row.key || "new variable")} onChange={event => change(index, { value: event.target.value })} />
          </label>
          <Button className="min-h-11" type="button" variant="outline" aria-label={(row.remove ? "Keep " : "Remove ") + (row.key || "new variable")}
            onClick={() => row.configured ? change(index, { remove: !row.remove, value: "" }) : setRows(current => current.filter((_, i) => i !== index))}>{row.remove ? "Undo remove" : "Remove"}</Button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={!!error && !rows.length} onClick={() => { setRows(current => [...current, { key: "", configured: false, value: "", remove: false }]); setSaved(false); }}>Add variable</Button>
          <Button type="button" className="min-h-11" disabled={!rows.some(row => row.value || row.remove)} onClick={() => void save()}>{busy ? "Saving…" : "Save environment"}</Button>
        </div>
      </fieldset>}
    {error ? <div role="alert" className="text-sm text-destructive">{error}<Button type="button" variant="ghost" disabled={busy} onClick={() => { setSaved(false); setRevision(value => value + 1); }}>Reload settings</Button></div> : null}
    {saved ? <p role="status" className="text-sm">Environment settings saved.</p> : null}
  </section>;
}
