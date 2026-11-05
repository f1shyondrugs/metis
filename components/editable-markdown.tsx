"use client";

import dynamic from "next/dynamic";
import type { PointerEventHandler } from "react";
import { cn } from "@/lib/utils";
import type { NotesBlockEditorProps } from "@/components/notes/block-editor";
import type { WorkspaceFileLocation } from "@/lib/workspace-file-link";

// Every Markdown editing surface shares the actual Shared Notes implementation.
// Keep this boundary lazy so read-only chat and workspace previews stay lightweight.
const SharedMarkdownEditor = dynamic<NotesBlockEditorProps>(
  () => import("@/components/notes/block-editor").then((module) => module.NotesBlockEditor),
  { ssr: false, loading: () => <div role="status" className="p-3 text-xs text-muted-foreground">Opening editor…</div> },
);

export type EditableMarkdownProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  /** Checkboxes are editable blocks in the shared engine; kept for caller compatibility. */
  interactiveTasks?: boolean;
  noteId?: string;
  workspace?: { chatId: string; id: string; type?: string; idempotencyKey?: string };
  editorId?: string;
  hideAttachmentButton?: boolean;
  onFiles?: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  initialMode?: "blocks" | "markdown" | "source";
  sourceLocation?: WorkspaceFileLocation | null;
  resolveUrl?: (url: string, kind: "image" | "link") => string;
};

export function EditableMarkdown({ className, interactiveTasks: _interactiveTasks, ...props }: EditableMarkdownProps) {
  return <div className={cn("editable-markdown shared-markdown-surface relative min-h-0 w-full", className)}>
    <SharedMarkdownEditor {...props}/>
  </div>;
}
