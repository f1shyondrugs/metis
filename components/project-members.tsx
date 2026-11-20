"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProfileAvatar } from "@/components/account/profile-avatar";
import type { AccountIdentity } from "@/lib/account-types";

type MembersData = {
  canManage: boolean;
  members: Array<AccountIdentity & { userId: string; username: string; role: "owner" | "member" }>;
  invitations: Array<AccountIdentity & { id: string; username: string; status: "pending" }>;
};

export function ProjectMembers({ projectId, membershipRole, open, onOpenChange, onLeft }: {
  projectId: string; membershipRole?: "owner" | "member";
  open: boolean; onOpenChange: (open: boolean) => void; onLeft?: () => void;
}) {
  const [data, setData] = useState<MembersData | null>(null);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/members`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Could not load project members.");
      const body = await response.json();
      if (!Array.isArray(body.members) || !Array.isArray(body.invitations) || typeof body.canManage !== "boolean") throw new Error("Could not load project members.");
      if (!signal?.aborted) setData(body);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load project members.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null); setError(""); setMessage(""); setUsername(""); setLeaveOpen(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [open, load]);
  async function mutate(method: "POST" | "DELETE", payload: { username?: string; userId?: string; invitationId?: string }, leaving = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not update project members. Try again.");
      if (leaving) {
        window.dispatchEvent(new Event("metis:projects-changed"));
        onOpenChange(false); onLeft?.();
      } else {
        if (method === "POST") { setUsername(""); setMessage("Invitation sent."); }
        await load();
        window.dispatchEvent(new Event("metis:projects-changed"));
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Could not update project members.";
      setError(text);
      if (leaving) setLeaveOpen(false);
    } finally { setBusy(false); }
  }
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Project members</DialogTitle>
          <DialogDescription>Project content is shared with members. Personal connections, models, and modes stay private.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto [&_button]:min-h-11 sm:[&_button]:min-h-9">
          {error ? <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="ghost" disabled={busy} onClick={() => { setError(""); void load(); }}>Try again</Button></div> : null}
          {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading members…</p> : data ? <>
            {data.canManage ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (username.trim() && !busy) void mutate("POST", { username: username.trim() }); }}>
              <label htmlFor="project-invite-username" className="text-sm font-medium">Invite a member</label>
              <p id="project-invite-help" className="text-xs text-muted-foreground">Enter their exact username or @handle.</p>
              <div className="flex flex-wrap gap-2">
                <Input id="project-invite-username" aria-describedby="project-invite-help" name="username" spellCheck={false} autoCapitalize="none" autoComplete="off" className="h-11 min-w-0 flex-1" placeholder="Username or @handle" value={username} onChange={event => setUsername(event.target.value)} disabled={busy} required />
                <Button type="submit" disabled={busy || !username.trim()}>Send invite</Button>
              </div>
            </form> : null}
            <section aria-labelledby="project-members-heading">
              <h3 id="project-members-heading" className="mb-2 text-sm font-medium">Members</h3>
              {!data.members.length ? <p className="text-sm text-muted-foreground">No members to show.</p> : <ul className="divide-y divide-border">{data.members.map(member => <li key={member.userId} className="flex items-center gap-3 py-3">
                <ProfileAvatar profile={member} name={member.username} className="size-9 shrink-0" />
                <div className="min-w-0 flex-1"><p className="break-words text-sm">{member.displayName || member.username}</p><p className="text-xs capitalize text-muted-foreground">{member.role}</p></div>
                {data.canManage && member.role !== "owner" ? <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${member.displayName || member.username}`} onClick={() => void mutate("DELETE", { userId: member.userId })}>Remove</Button> : null}
              </li>)}</ul>}
            </section>
            <section aria-labelledby="project-invitations-heading">
              <h3 id="project-invitations-heading" className="mb-2 text-sm font-medium">Pending invitations</h3>
              {!data.invitations.length ? <p className="text-sm text-muted-foreground">No pending invitations.</p> : <ul className="divide-y divide-border">{data.invitations.map(invitation => <li key={invitation.id} className="flex items-center gap-3 py-3">
                <ProfileAvatar profile={invitation} name={invitation.username} className="size-9 shrink-0" />
                <p className="min-w-0 flex-1 break-words text-sm">{invitation.displayName || invitation.username}</p>
                {data.canManage ? <Button size="sm" variant="ghost" disabled={busy} aria-label={`Cancel invitation for ${invitation.displayName || invitation.username}`} onClick={() => void mutate("DELETE", { invitationId: invitation.id })}>Cancel invite</Button> : <span className="text-xs text-muted-foreground">Pending</span>}
              </li>)}</ul>}
            </section>
            {membershipRole === "member" ? <div className="border-t border-border pt-4"><Button variant="destructive" disabled={busy} onClick={() => setLeaveOpen(true)}>Leave project</Button></div> : null}
          </> : null}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={leaveOpen} onOpenChange={setLeaveOpen} title="Leave this project?" description="You will lose access to this project’s shared content. An owner can invite you again." confirmLabel="Leave project" onConfirm={() => mutate("DELETE", {}, true)} />
  </>;
}
