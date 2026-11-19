"use client";

import { useEffect, useRef, useState } from "react";
import { File, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceSearchResult, type WorkspaceSearchEntry, type WorkspaceSearchResult } from "@/lib/workspace-search-result";
import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";
import { subscribeVisiblePolling } from "@/lib/visible-polling";

type Props = {
  directory: string;
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: (location: WorkspaceFileLocation) => void;
  disabled: boolean;
  revision: number;
};

type SearchResults = {
  search?: WorkspaceSearchResult;
  fileNames?: WorkspaceSearchResult;
  contentSearchError?: string;
  fileNamesError?: string;
};

function SearchFileButton({ entry, count, disabled, onOpen }: {
  entry: WorkspaceSearchEntry;
  count?: number;
  disabled: boolean;
  onOpen: Props["onOpen"];
}) {
  const slash = entry.path.lastIndexOf("/");
  return <button type="button" disabled={disabled} onClick={() => onOpen({ path: entry.absolutePath, line: entry.line, column: entry.column })} title={entry.path} className="flex min-h-10 w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <File aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.path.slice(slash + 1)}</span>{slash >= 0 ? <span className="block truncate text-[11px] text-muted-foreground">{entry.path.slice(0, slash)}</span> : null}</span>
    {count !== undefined ? <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span> : null}
  </button>;
}

export function FileExplorerSearch({ directory, query, onQueryChange, onOpen, disabled, revision }: Props) {
  const [mode, setMode] = useState<"files" | "content">("files");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResults | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const active = Boolean(query.trim());
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const searchKey = JSON.stringify([directory, query, mode, caseSensitive, regex, revision, retry]);
  const [resultKey, setResultKey] = useState("");
  const current = resultKey === searchKey ? result : null;
  const pending = active && (loading || resultKey !== searchKey);

  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    setError("");
    if (!active) { setLoading(false); setResult(null); setResultKey(""); return; }
    setLoading(true);
    let running = false, initialized = false;
    const search = async (signal: AbortSignal, background = false) => {
      if (running || (background && (!initialized || disabledRef.current))) return;
      running = true;
      try {
        const response = await fetch("/api/remote", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ action: "search", path: directory, cwd: directory, query, searchMode: mode, caseSensitive, regex }),
        });
        const data = await response.json().catch(() => { throw new Error("Search returned an incomplete response. Try again."); });
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Search failed. Try again.");
        const search = workspaceSearchResult(data.search);
        const fileNames = workspaceSearchResult(data.fileNames);
        if (!search && !fileNames) throw new Error("Search returned an invalid response. Try again.");
        const parsed: SearchResults = {
          search, fileNames,
          ...(typeof data.contentSearchError === "string" ? { contentSearchError: data.contentSearchError } : {}),
          ...(typeof data.fileNamesError === "string" ? { fileNamesError: data.fileNamesError } : {}),
        };
        if (version !== generation.current || signal.aborted) return;
        setResult(previous => JSON.stringify(previous) === JSON.stringify(parsed) ? previous : parsed);
        setResultKey(searchKey); setError("");
      } catch (cause) {
        if (version !== generation.current || signal.aborted) return;
        if (!background) { setResult(null); setResultKey(searchKey); }
        setError(cause instanceof Error ? cause.message : "Search failed.");
      } finally {
        running = false; initialized = true;
        if (version === generation.current && !signal.aborted) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void search(controller.signal), 300);
    const stopPolling = subscribeVisiblePolling(signal => search(signal, true));
    return () => { window.clearTimeout(timer); controller.abort(); stopPolling(); };
  }, [active, directory, query, mode, caseSensitive, regex, revision, retry, searchKey]);

  const groups = new Map<string, WorkspaceSearchEntry[]>();
  for (const entry of current?.search?.entries || []) {
    const group = groups.get(entry.absolutePath) || []; group.push(entry); groups.set(entry.absolutePath, group);
  }
  const names = (current?.fileNames?.entries || []).filter(entry => !groups.has(entry.absolutePath));
  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border/40 px-2 py-3">
        <div className="flex gap-1" role="group" aria-label="Search mode">
          <Button size="sm" variant={mode === "files" ? "secondary" : "ghost"} className="h-8 flex-1 text-xs" aria-pressed={mode === "files"} onClick={() => setMode("files")}>Files</Button>
          <Button size="sm" variant={mode === "content" ? "secondary" : "ghost"} className="h-8 flex-1 text-xs" aria-pressed={mode === "content"} onClick={() => setMode("content")}>Contents</Button>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-muted/40 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input value={query} onChange={event => onQueryChange(event.target.value)} maxLength={500} placeholder={mode === "files" ? "Find files…" : "Search in files…"} aria-label="Filter files" className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none" onKeyDown={event => { if (event.key === "Escape") onQueryChange(""); }} />
          {mode === "content" ? <>
            <Button size="icon-sm" variant={caseSensitive ? "secondary" : "ghost"} aria-label="Match case" title="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(value => !value)} className="size-7 shrink-0 font-mono text-xs">Aa</Button>
            <Button size="icon-sm" variant={regex ? "secondary" : "ghost"} aria-label="Use regular expression" title="Use regular expression" aria-pressed={regex} onClick={() => setRegex(value => !value)} className="size-7 shrink-0 font-mono text-xs">.*</Button>
          </> : null}
          {active ? <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" aria-label="Clear search" title="Clear search" onClick={() => onQueryChange("")}><X className="size-3.5" /></Button> : null}
        </div>

        {active ? <p className="truncate text-[11px] text-muted-foreground" title={directory}>In this folder and subfolders</p> : null}
      </div>
      {active ? <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2" aria-busy={pending} data-search-results>
        {pending ? <p role="status" className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Searching…</p> : null}
        {!pending && error ? <div role="alert" className="space-y-2 break-words p-3 text-xs text-destructive"><p>{error}</p><Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry search</Button></div> : null}
        {!pending && current ? <>
          {names.length ? <section aria-label="File name matches" className="mb-2 border-b border-border/40 pb-2">
            <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">Matching file names</p>
            {names.map(entry => <SearchFileButton key={entry.absolutePath} entry={entry} disabled={disabled} onOpen={onOpen} />)}
          </section> : null}
          {current.search ? <p role="status" className="px-2 pb-2 text-[11px] text-muted-foreground">
            {current.search.entries.length}{current.search.truncated ? "+" : ""} {mode === "files" ? (groups.size === 1 ? "file" : "files") : (current.search.entries.length === 1 ? "content match" : "content matches")}
          </p> : null}
          {!groups.size && !names.length && !current.contentSearchError && !current.fileNamesError ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches. Try another search.</p> : null}
          {[...groups].map(([path, entries]) => <div key={path} className="mb-2">
            <SearchFileButton entry={entries[0]} count={mode === "content" ? entries.length : undefined} disabled={disabled} onOpen={onOpen} />
            {mode === "content" ? entries.map(entry => <button key={entry.line} type="button" disabled={disabled} onClick={() => onOpen({ path, line: entry.line, column: entry.column })} title={`${entry.path}:${entry.line} — ${entry.text}`} className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md py-2 pl-7 pr-2 text-left font-mono text-[11px] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="shrink-0 tabular-nums text-muted-foreground">{entry.line}</span><span className="min-w-0 flex-1 truncate">{entry.text}</span>
            </button>) : null}
          </div>)}
          {current.search?.truncated || current.fileNames?.truncated ? <p className="px-2 py-2 text-[11px] text-muted-foreground">Results limited. Narrow your search.</p> : null}
          {mode === "content" && current.search?.skipped ? <p className="px-2 py-2 text-[11px] text-muted-foreground">Contents not searched in {current.search.skipped} entries (unreadable, binary, too large or symbolic links).</p> : null}
          {current.contentSearchError || current.fileNamesError ? <div role="alert" className="px-2 py-2 text-xs text-destructive">
            {current.contentSearchError || current.fileNamesError}
            <Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry search</Button>
          </div> : null}
        </> : null}
      </div> : null}
    </>
  );
}
