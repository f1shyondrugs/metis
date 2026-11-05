"use client";

import { FileText } from "lucide-react";
import { ProjectIconGlyph } from "@/components/project-avatar";
import { parseNoteIcon } from "@/lib/note-icon";
import { cn } from "@/lib/utils";

export function NoteIcon({ value, className }: { value?: string | null; className?: string }) {
  const icon = parseNoteIcon(value);
  if (icon?.kind === "emoji") return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}>{icon.text}</span>;
  return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center", className)} style={icon?.kind === "lucide" && icon.color ? { color: icon.color } : undefined}>
    {icon?.kind === "lucide" ? <ProjectIconGlyph icon={"lucide:" + icon.name} className="size-full" /> : <FileText className="size-full text-muted-foreground" />}
  </span>;
}
