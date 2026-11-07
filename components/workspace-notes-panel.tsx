"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const NotesWorkspace = dynamic(() => import("./notes/notes-workspace").then(mod => mod.NotesWorkspace), {
  loading: () => <div role="status" className="p-5 text-sm text-muted-foreground">Loading notes…</div>,
});

/** Keep the open document when changing tabs, without loading notes until requested. */
export function WorkspaceNotesPanel({ active, projectId }: { active: boolean; projectId: string | null }) {
  const [opened, setOpened] = useState(active);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  if (!active && !opened) return null;
  return <div hidden={!active} className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"} aria-label="Workspace notes">
    <NotesWorkspace embedded active={active} initialProjectId={projectId} />
  </div>;
}
