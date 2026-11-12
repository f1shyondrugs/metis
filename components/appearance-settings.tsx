"use client";

import { useId, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Check, Code2, Download, Palette, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppearance } from "@/components/appearance-provider";
import {
  MAX_THEME_JSON_BYTES,
  THEME_PRESETS,
  isValidThemeVariableName,
  normalizeTheme,
  parseThemeJson,
  resolveThemeVariables,
  serializeTheme,
  type ThemeDefinition,
} from "@/lib/appearance-theme";

export { AppearanceProvider } from "@/components/appearance-provider";

/** Include every active root design token, keeping the theme's aliases editable. */
function themeDocument(theme: ThemeDefinition, captureRoot = false): ThemeDefinition {
  const variables: Record<string, string> = {};
  if (captureRoot) {
    const computed = getComputedStyle(document.documentElement);
    for (let index = 0; index < computed.length; index++) {
      const name = computed[index];
      // Tailwind's transient --tw-* and Next's font assets are implementation state.
      if (!isValidThemeVariableName(name) || name.startsWith("--tw-") || name.startsWith("--font-geist-")) continue;
      const value = computed.getPropertyValue(name).trim();
      if (value) variables[name] = value;
    }
  }
  return normalizeTheme({ ...theme, variables: { ...variables, ...resolveThemeVariables(theme) } });
}

function ThemeSwatch({ theme }: { theme: ThemeDefinition }) {
  const variables = resolveThemeVariables(theme);
  return <span aria-hidden="true" className="flex h-14 w-full overflow-hidden rounded-md border"
    style={{ background: variables["--background"], borderColor: variables["--border"] }}>
    <span className="w-1/4 border-r p-2" style={{ background: variables["--sidebar"], borderColor: variables["--border"] }}>
      <span className="block h-1.5 rounded" style={{ background: variables["--muted-foreground"] }} />
    </span>
    <span className="flex flex-1 flex-col gap-1.5 p-2">
      <span className="h-1.5 w-1/2 rounded" style={{ background: variables["--foreground"] }} />
      <span className="h-1 w-3/4 rounded" style={{ background: variables["--muted-foreground"] }} />
      <span className="mt-auto h-2 w-1/3 rounded" style={{ background: variables["--primary"] }} />
    </span>
  </span>;
}

export function AppearanceSettings() {
  const { state, theme, ready, busy, canEdit, persistence, syncError, refresh, choose, save, remove } = useAppearance();
  const locked = busy || !canEdit;
  const inputId = useId();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const [draft, setDraft] = useState<{ id?: string; json: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function attempt(action: () => void | Promise<void>) {
    setError("");
    setNotice("");
    try { await action(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The theme could not be saved. Please try again.");
    }
  }

  function editTheme(definition: ThemeDefinition, id?: string) {
    attempt(() => {
      importGeneration.current++;
      const document = themeDocument(definition, definition === theme);
      if (!id) document.name = (definition.name.slice(0, 100) + " custom");
      setDraft({ id, json: serializeTheme(document) });
      setDeleteTarget(null);
      requestAnimationFrame(() => editorRef.current?.focus());
    });
  }

  async function importTheme(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const generation = ++importGeneration.current;
    setImporting(true);
    setError("");
    setNotice("");
    try {
      if (file.size > MAX_THEME_JSON_BYTES) throw new Error("Theme JSON must be no larger than 256 KiB.");
      const imported = parseThemeJson(await file.text());
      if (generation !== importGeneration.current) return;
      // Import opens a draft. Nothing is applied or overwritten until Save.
      setDraft({ json: serializeTheme(imported) });
      setDeleteTarget(null);
      setNotice("Imported into the editor. Save and apply when ready.");
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch (failure) {
      if (generation === importGeneration.current) setError(failure instanceof Error ? failure.message : "This theme file could not be read.");
    } finally {
      if (generation === importGeneration.current) setImporting(false);
    }
  }

  function exportCurrent() {
    attempt(() => {
      const json = serializeTheme(themeDocument(theme, true));
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = (theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom") + ".metis-theme.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Theme exported as JSON.");
    });
  }

  if (!ready) return <p role="status" className="text-sm text-muted-foreground">Loading appearance…</p>;

  return <div className="min-w-0 space-y-6" data-slot="appearance-settings">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Active theme: {theme.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{persistence === "account"
          ? "Saved to your account and synced across devices."
          : "Demo themes are saved in this browser."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => importRef.current?.click()} disabled={importing || locked}>
          <Upload className="size-3.5" />{importing ? "Reading…" : "Import JSON"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportCurrent}><Download className="size-3.5" />Export JSON</Button>
        <input ref={importRef} type="file" accept=".json,application/json" aria-label="Import theme JSON file" className="hidden" onChange={(event) => void importTheme(event)} />
      </div>
    </div>

    <fieldset>
      <legend className="mb-3 text-xs font-medium text-muted-foreground">Built-in themes</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEME_PRESETS.map((preset) => <label key={preset.id}
          className="relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-border p-3 has-checked:border-ring has-checked:ring-1 has-checked:ring-ring focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <ThemeSwatch theme={preset} />
          <span className="flex items-center gap-2">
            <input type="radio" name="color-theme" value={preset.id} checked={state.selected === preset.id}
              disabled={locked || importing} onChange={() => void attempt(async () => { await choose(preset.id); setNotice(preset.name + " applied."); })} className="size-3.5 shrink-0 accent-current" />
            <span className="truncate text-sm font-medium">{preset.name}</span>
          </span>
          <span className="text-xs text-muted-foreground">{preset.description}</span>
        </label>)}
      </div>
    </fieldset>

    <section className="space-y-3" aria-labelledby={inputId + "-custom"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={inputId + "-custom"} className="text-sm font-medium">Custom themes</h4>
        <Button type="button" variant="outline" size="sm" onClick={() => editTheme(theme)} disabled={importing || locked}>
          <Plus className="size-3.5" />Create from current
        </Button>
      </div>
      {!state.customThemes.length ? <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
        Start from any preset, edit its JSON, or import a theme file.
      </p> : <div className="space-y-2">
        {state.customThemes.map((custom) => <div key={custom.id} className="rounded-lg border border-border p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input type="radio" name="color-theme" value={custom.id} checked={state.selected === custom.id}
                disabled={locked || importing} onChange={() => void attempt(async () => { await choose(custom.id); setNotice(custom.theme.name + " applied."); })} className="size-3.5 shrink-0 accent-current" />
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{custom.theme.name}</span>
                <span className="block text-xs text-muted-foreground">{custom.theme.mode === "dark" ? "Dark" : "Light"} · {Object.keys(custom.theme.variables).length} variables</span>
              </span>
            </label>
            <Button type="button" size="sm" variant="ghost" onClick={() => editTheme(custom.theme, custom.id)} disabled={importing || locked}><Code2 className="size-3.5" />Edit JSON</Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={"Delete theme " + custom.theme.name} disabled={locked || importing} onClick={() => setDeleteTarget(custom.id)}><Trash2 className="size-3.5" /></Button>
          </div>
          {deleteTarget === custom.id ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <p className="flex-1 text-xs">Delete this custom theme? {state.selected === custom.id ? "The default theme will be applied." : ""}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>Keep theme</Button>
            <Button type="button" size="sm" variant="destructive" disabled={locked || importing} onClick={() => void attempt(async () => {
              await remove(custom.id);
              if (draft?.id === custom.id) setDraft(null);
              setDeleteTarget(null);
              setNotice("Custom theme deleted.");
            })}>Delete theme</Button>
          </div> : null}
        </div>)}
      </div>}
    </section>

    {draft ? <section className="space-y-3 rounded-xl border border-border bg-card/40 p-3 sm:p-4" aria-labelledby={inputId + "-editor"}>
      <div className="flex items-center gap-2"><Palette className="size-4 text-muted-foreground" />
        <h4 id={inputId + "-editor"} className="text-sm font-medium">{draft.id ? "Edit custom theme" : "New custom theme"}</h4>
      </div>
      <p id={inputId + "-help"} className="text-xs leading-relaxed text-muted-foreground">
        Change the name, dark/light mode, and any CSS variable. Colors, fonts, spacing, text sizes, borders, shadows and radii are editable. Missing variables use the mode defaults.
      </p>
      <label htmlFor={inputId} className="sr-only">Theme JSON</label>
      <Textarea ref={editorRef} id={inputId} value={draft.json} onChange={(event) => { setDraft({ ...draft, json: event.target.value }); setError(""); setNotice(""); }}
        aria-describedby={inputId + "-help"} disabled={importing || locked} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        className="h-80 min-h-64 resize-y overflow-auto font-mono text-xs! [field-sizing:fixed]"
        style={{ tabSize: 2 } as CSSProperties} />
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">JSON format and variable reference</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p><code>format</code>: <code>metis-theme</code> · <code>version</code>: <code>1</code> · <code>mode</code>: <code>dark</code> or <code>light</code>.</p>
          <p><code>variables</code> maps CSS custom-property names to CSS strings. Examples: <code>--background</code>, <code>--primary</code>, <code>--font-sans</code>, <code>--spacing</code>, <code>--radius</code>, <code>--text-sm</code> and <code>--shadow-sm</code>.</p>
          <p>The editor includes all active root design variables. Aliases such as <code>--color-background: var(--background)</code> stay linked. You can add further CSS variables; they affect components that use them. Component-local positioning and assets are not theme settings.</p>
          <p>Use values such as <code>#252525</code>, <code>oklch(0.3 0 0)</code>, <code>0.75rem</code> or <code>var(--primary)</code>. CSS rules, URLs and scripts are rejected. Maximum file size: 256 KiB.</p>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={importing || locked} onClick={() => void attempt(async () => {
          const parsed = parseThemeJson(draft.json);
          const formatted = serializeTheme(parsed);
          const id = await save(parsed, draft.id);
          setDraft({ id, json: formatted });
          setNotice(parsed.name + " saved and applied.");
        })}><Check className="size-3.5" />Save and apply</Button>
        <Button type="button" size="sm" variant="outline" disabled={importing || locked} onClick={() => attempt(() => setDraft({ ...draft, json: serializeTheme(parseThemeJson(draft.json)) }))}>Format JSON</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { importGeneration.current++; setImporting(false); setDraft(null); setError(""); setNotice(""); }}>Close editor</Button>
      </div>
    </section> : null}
    {busy && persistence === "account" ? <p role="status" className="text-xs text-muted-foreground">Saving account theme settings…</p> : null}
    {syncError ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
      <p className="min-w-0 flex-1 break-words">{syncError}</p>
      <Button type="button" size="sm" variant="outline" onClick={refresh}>Retry sync</Button>
    </div> : null}
    {error ? <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
  </div>;
}
