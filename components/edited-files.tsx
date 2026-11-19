"use client";

import { useState } from "react";
import { ChevronRight, ChevronUp, FileCode2 } from "lucide-react";
import type { EditedFileSummary } from "@/lib/edited-files";
import { editedFileHref } from "@/lib/edited-files";
import type { FileChangeRange } from "@/lib/file-change-ranges";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { EditedFilesDiffProps } from "@/components/edited-file-diff";
import { toolsForEditedFile, type EditDiffFocus } from "@/lib/edited-file-diff";

function openFile(file: EditedFileSummary, context: EditedFilesDiffProps, focus?: EditDiffFocus) {
  const { versions: _versions, partialCounts: _partialCounts, ...original } = file;
  window.dispatchEvent(new CustomEvent("ai-chat:open-file", { detail: {
    path: file.path,
    diff: { ...context, file: original, tools: toolsForEditedFile(file, context.tools), focus },
  } }));
}

function rangeLabel(change: FileChangeRange) {
  const start = change.kind === "deleted" ? change.oldStartLine || change.startLine : change.startLine;
  const end = change.kind === "deleted" ? change.oldEndLine || start : change.endLine;
  return `${change.kind === "deleted" ? "Removed " : ""}L${start}${end > start ? "–" + end : ""}`;
}

function EditedFileRows({ files, compact = false, onOpen, ...diffProps }: EditedFilesDiffProps & { files: EditedFileSummary[]; compact?: boolean; onOpen?: () => void }) {
  let prefix = files[0]?.path.slice(0, files[0].path.lastIndexOf("/") + 1) || "";
  if (!files.every(file => file.target === files[0].target && file.path.startsWith("/"))) prefix = "";
  while (prefix && !files.every(file => file.path.startsWith(prefix))) {
    prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf("/") + 1);
  }
  return <>{files.map(file => {
    const href = editedFileHref(file);
    const relativePath = file.path.slice(prefix.length);
    const name = file.path.split(/[\\/]/).pop() || file.path;
    const directory = relativePath.slice(0, Math.max(0, relativePath.lastIndexOf("/")));
    const label = <>
      <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      {compact ? <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name}</span>
        {directory ? <span className="block truncate text-[11px] text-muted-foreground">{directory}</span> : null}
      </span> : <span className="min-w-0 flex-1 break-all font-mono">{relativePath}</span>}
      {file.additions !== undefined && file.deletions !== undefined ?
        <span data-line-stats className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums" title={file.partialCounts ? "Only edits with recorded line counts are included" : "Lines added and removed across edits in this response"}>
          <span className="text-green-500" aria-label={`${file.additions} lines added`}>+{file.additions}</span>
          <span className="text-red-400" aria-label={`${file.deletions} lines removed`}>−{file.deletions}</span>
          {file.partialCounts ? <span className="text-[10px] text-muted-foreground">Partial</span> : null}
        </span> : <span data-line-stats className="shrink-0 text-[10px] text-muted-foreground">No line counts</span>}
    </>;
    const key = file.target + ":" + file.path;
    return <li key={key} className="min-w-0 max-w-full">
      {href ? <a href={href} title={file.path} aria-label={`View changes for ${file.path}`} className={cn("flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-foreground/85 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact && "min-h-11")} onClick={event => {
        event.preventDefault();
        onOpen?.();
        openFile(file, diffProps);
      }}>{label}</a> : <button type="button" aria-label={`View changes for ${file.path}`} className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground/85 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} title={file.path} onClick={() => { onOpen?.(); openFile(file, diffProps); }}>{label}<span className="shrink-0 text-[10px] text-muted-foreground">{file.target}</span></button>}
      {file.versions?.map(({ toolId, ranges }, versionIndex) => ranges?.length ? <div key={toolId} className="flex flex-wrap items-center gap-x-2 pl-7" data-change-lines>
        {file.versions!.length > 1 ? <span className="text-[10px] text-muted-foreground">Edit {versionIndex + 1}:</span> : null}
        {ranges.map((range, index) => <button key={index} type="button" className="min-h-8 rounded-sm text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Edit ${versionIndex + 1}: ${rangeLabel(range)}`} title={range.kind === "deleted" ? "Jump to the removed lines" : "Jump to the changed lines"} onClick={() => {
            onOpen?.();
            openFile(file, diffProps, { toolId, range });
          }}>{rangeLabel(range)}</button>)}
      </div> : null)}
    </li>;
  })}</>;
}

export function EditedFiles({ files, streaming = false, ...diffProps }: EditedFilesDiffProps & { files: EditedFileSummary[]; streaming?: boolean }) {
  if (streaming || !files.length) return null;
  return (
    <details className="group/edited-files my-3 min-w-0 max-w-full text-xs" data-edited-files>
      <summary className="group/edited-summary flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md pr-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open/edited-files:rotate-90 motion-reduce:transition-none" />
        <FileCode2 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="transition-colors group-hover/edited-summary:text-foreground">{files.length} {files.length === 1 ? "file" : "files"} edited</span>
      </summary>
      <ul className="mt-1 max-h-64 min-w-0 overflow-y-auto border-l border-border/60 pl-3">
        <EditedFileRows files={files} {...diffProps} />
      </ul>
    </details>
  );
}

export function ComposerEditedFiles({ files, ...diffProps }: EditedFilesDiffProps & { files: EditedFileSummary[] }) {
  const [open, setOpen] = useState(false);
  if (!files.length) return null;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" data-composer-edited-files className="group/edited-trigger mb-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FileCode2 aria-hidden="true" className="size-3.5 shrink-0" />
        <span aria-live="polite" aria-atomic="true" className="transition-colors group-hover/edited-trigger:text-foreground">{files.length} {files.length === 1 ? "file" : "files"} edited</span>
        <ChevronUp aria-hidden="true" className={cn("ml-auto size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Edited files" className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-1.5">
      <ul className="min-h-0 overflow-y-auto overscroll-contain">
        {open ? <EditedFileRows files={files} compact {...diffProps} onOpen={() => setOpen(false)} /> : null}
      </ul>
    </PopoverContent>
  </Popover>;
}
