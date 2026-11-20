"use client";

import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/components/account/profile-avatar";
import { subscribeVisiblePolling } from "@/lib/visible-polling";
import { projectMessageAuthor, projectMessageMembers, type ProjectMessageMember } from "@/lib/project-message-authors";

/** One request for the active project, shared by every message in the transcript. */
export function useProjectMessageMembers(projectId: string | null | undefined) {
  const [state, setState] = useState<{ projectId: string; members: ProjectMessageMember[] } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("metis:projects-changed", refresh);
    return () => window.removeEventListener("metis:projects-changed", refresh);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let disposed = false, version = 0;
    const load = async (signal: AbortSignal) => {
      const request = ++version;
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/members`, { cache: "no-store", signal });
        if (!response.ok) throw new Error("Could not load project members");
        const members = projectMessageMembers(await response.json());
        if (!disposed && !signal.aborted && request === version) setState(previous =>
          previous?.projectId === projectId && previous.members.length === members.length && members.every((member, index) => {
            const old = previous.members[index];
            return old.userId === member.userId && old.username === member.username && old.displayName === member.displayName && old.avatar === member.avatar;
          }) ? previous : { projectId, members });
      } catch {
        // Omit this optional decoration if membership cannot be established.
        if (!disposed && !signal.aborted && request === version) setState(null);
      }
    };
    const initial = new AbortController();
    void load(initial.signal);
    const unsubscribe = subscribeVisiblePolling(load, 5000);
    return () => { disposed = true; initial.abort(); unsubscribe(); };
  }, [projectId, revision]);
  return projectId && state?.projectId === projectId ? state.members : [];
}

export function ProjectMessageAuthor({ members, authorId, authorName }: {
  members: ProjectMessageMember[]; authorId?: string; authorName?: string;
}) {
  const identity = projectMessageAuthor(members, { authorId, authorName });
  if (!identity) return null;
  return <div data-project-message-author className="mb-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
    <ProfileAvatar profile={identity} name={identity.displayName} className="size-5 shrink-0 text-[9px]" />
    <span className="min-w-0 break-words">{identity.displayName}</span>
  </div>;
}
