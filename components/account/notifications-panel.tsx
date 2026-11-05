"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

type InboxNotification = {
  id: string; title: string; body: string; createdAt: string; readAt: string | null;
  chatId: string | null; kind: "notice" | "project_invite"; projectId?: string;
  invitationId?: string; invitationStatus?: "pending" | "accepted" | "declined" | "revoked";
};

export function NotificationsPanel({ onOpenProject, onOpenChat, onNotificationsChanged }: {
  onOpenProject?: (id: string) => void;
  onOpenChat?: (id: string) => void;
  onNotificationsChanged?: () => void;
}) {
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notifications/inbox", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Could not load notifications.");
      const body = await response.json();
      if (!Array.isArray(body.notifications)) throw new Error("Could not load notifications.");
      if (!signal?.aborted) setNotifications(body.notifications);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load notifications.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const update=(event:Event)=>{const body=(event as CustomEvent).detail;if(Array.isArray(body?.notifications))setNotifications(body.notifications);};
    window.addEventListener("metis:notification-inbox-updated",update);
    return () => {controller.abort();window.removeEventListener("metis:notification-inbox-updated",update);};
  }, [load]);

  function changed() {
    window.dispatchEvent(new Event("metis:notifications-changed"));
    onNotificationsChanged?.();
  }
  async function markRead(id?: string) {
    setBusy(id ?? "all");
    setError("");
    try {
      const response = await fetch("/api/notifications/inbox", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { ids: [id] } : { all: true }),
      });
      if (!response.ok) throw new Error("Could not mark notifications as read. Try again.");
      setNotifications(items => items.map(item => !id || item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
      changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark notifications as read.");
    } finally { setBusy(null); }
  }
  async function respond(item: InboxNotification, action: "accept" | "decline") {
    if (!item.invitationId) return;
    setBusy(item.id);
    setError("");
    try {
      const response = await fetch(`/api/project-invitations/${encodeURIComponent(item.invitationId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not respond to this invitation. Try again.");
      setNotifications(items => items.filter(value => value.id !== item.id));
      changed();
      if (action === "accept") {
        window.dispatchEvent(new Event("metis:projects-changed"));
        if (body.projectId) onOpenProject?.(body.projectId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not respond to this invitation.");
    } finally { setBusy(null); }
  }

  return <section className="mx-auto max-w-2xl [&_button]:min-h-11 sm:[&_button]:min-h-9" aria-labelledby="notifications-heading">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 id="notifications-heading" className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <Button variant="outline" disabled={loading || busy !== null || !notifications.some(item => !item.readAt)} onClick={() => void markRead()}>Mark all as read</Button>
    </div>
    {error ? <div role="alert" className="mb-4 text-sm text-destructive"><p>{error}</p><Button variant="ghost" disabled={busy !== null} onClick={() => void load()}>Try again</Button></div> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading notifications…</p> :
      notifications.length === 0 && !error ? <div className="py-12 text-center"><Bell className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">You’re all caught up</h2><p className="mt-1 text-sm text-muted-foreground">Project invitations and updates will appear here.</p></div> :
      <ul className="divide-y divide-border">
        {notifications.map(item => <li key={item.id} className="py-5">
          <div className="flex items-start gap-3">
            <span className={`mt-2 size-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-destructive"}`} aria-label={item.readAt ? "Read" : "Unread"} />
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-sm font-medium">{item.title}</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.body}</p>
              <time dateTime={item.createdAt} className="mt-2 block text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("en")}</time>
              <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
                {item.kind === "project_invite" && item.invitationStatus === "pending" && item.invitationId ? <>
                  <Button size="sm" disabled={busy !== null} onClick={() => void respond(item, "accept")}>Accept invitation</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void respond(item, "decline")}>Decline</Button>
                </> : null}
                {item.kind === "project_invite" && item.invitationStatus && item.invitationStatus !== "pending" ? <span className="self-center text-xs capitalize text-muted-foreground">{item.invitationStatus}</span> : null}
                {item.projectId && item.invitationStatus === "accepted" && onOpenProject ? <Button size="sm" variant="outline" onClick={() => onOpenProject(item.projectId!)}>Open project</Button> : null}
                {item.chatId && onOpenChat ? <Button size="sm" variant="outline" onClick={() => { if (!item.readAt) void markRead(item.id); onOpenChat(item.chatId!); }}>Open chat</Button> : null}
                {!item.readAt ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void markRead(item.id)}>Mark as read</Button> : null}
              </div>
            </div>
          </div>
        </li>)}
      </ul>}
  </section>;
}
