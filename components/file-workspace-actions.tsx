"use client";

import { createContext, useContext, useRef, useState } from "react";
import { ClipboardList, LoaderCircle, MoreHorizontal, Palette } from "lucide-react";
import { isTextAttachment, type FileEmbedSpec } from "@/lib/file-types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const FileWorkspaceContext = createContext<{
  chatId: string | null;
  open: (type: "canvas" | "plan", sourceUrl: string) => Promise<void>;
} | null>(null);

/** Actions exist only in the authenticated chat, for its registered upload URLs. */
export function FileWorkspaceActions({ file }: { file: FileEmbedSpec }) {
  const context = useContext(FileWorkspaceContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (!context?.chatId || !file.url.startsWith("/api/uploads/" + context.chatId + "/") || !isTextAttachment(file.mimeType, file.name)) return null;
  const open = async (type: "canvas" | "plan") => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await context.open(type, file.url); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not open file."); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <div className="hidden items-center gap-1 sm:flex">
      {(["canvas", "plan"] as const).map(type => {
        const Icon = type === "canvas" ? Palette : ClipboardList;
        const label = type === "canvas" ? "Open in Canvas" : "Open in Plan";
        return <button key={type} type="button" title={label} aria-label={label} disabled={busy}
          className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          onClick={() => void open(type)}>{busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/> : <Icon className="size-3.5" aria-hidden="true"/>}</button>;
      })}
    </div>
    <div className="sm:hidden">
      <DropdownMenu><DropdownMenuTrigger asChild>
        <button type="button" aria-label={"File actions for " + file.name} disabled={busy}
          className="flex size-11 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true"/> : <MoreHorizontal className="size-4" aria-hidden="true"/>}
        </button>
      </DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="min-h-11" onSelect={() => void open("canvas")}><Palette className="size-4" aria-hidden="true"/>Open in Canvas</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => void open("plan")}><ClipboardList className="size-4" aria-hidden="true"/>Open in Plan</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>
    {error && <span role="alert" className="max-w-48 text-xs text-destructive">{error}</span>}
  </>;
}
