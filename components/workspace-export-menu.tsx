"use client";

import { useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadBlob } from "@/lib/download";
import type { DocumentExportFormat } from "@/lib/document-export";

type ExportDocument = { id: string; name: string; content: string; type: "canvas" | "plan" };

type ExportProps = { workspace: ExportDocument } & ({ chatId: string; shareId?: never } | { shareId: string; chatId?: never });

export function WorkspaceExportMenu({ chatId, shareId, workspace }: ExportProps) {
  const [exporting, setExporting] = useState(false);
  const inFlight = useRef(false);

  async function exportDocument(format: DocumentExportFormat) {
    if (inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    // Capture the current draft before a refresh or workspace switch can change it.
    const snapshot = shareId ? { id: shareId, workspaceId: workspace.id, format }
      : { chatId, workspaceId: workspace.id, name: workspace.name, content: workspace.content, format };
    try {
      const response = await fetch(shareId ? "/api/share/workspace" : "/api/workspace-export", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || "The document could not be exported.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const name = encodedName ? decodeURIComponent(encodedName) : "document." + format;
      downloadBlob(await response.blob(), name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The document could not be exported.");
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" size="icon-sm" variant="ghost" className="size-8 shrink-0" disabled={exporting}
        aria-label={"Export " + workspace.type} title={exporting ? "Exporting…" : "Export " + workspace.type} aria-busy={exporting}>
        {exporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={() => void exportDocument("md")}>Markdown (.md)</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void exportDocument("txt")}>Plain text (.txt)</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void exportDocument("pdf")}>PDF (.pdf)</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
