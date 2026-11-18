import { randomUUID } from "node:crypto";
import { getRemoteClient } from "@/lib/remote-clients";
import { getNotificationPrefs, notificationForDisplay, type NotificationRecord } from "@/lib/notification-store";
import { remoteNotificationAllowed } from "@/lib/notification-preferences";
type Socket = { readyState: number; send(data: string): void; on(event: "message" | "close", callback: (raw?: unknown) => void): void };
type Session = { socket: Socket; ownerId: string; native: boolean; pending: Map<string, { id: string; resolve(value: boolean): void; timer: ReturnType<typeof setTimeout> }> };
const globals = globalThis as typeof globalThis & { __metisNotificationSessions?: Map<string, Session> };
const sessions = globals.__metisNotificationSessions ??= new Map();
export function bindNotificationSession(socket: Socket, clientId: string, ownerId: string) {
  const old = sessions.get(clientId);
  if (old) for (const item of old.pending.values()) { clearTimeout(item.timer); item.resolve(false); }
  const session: Session = { socket, ownerId, native: false, pending: new Map() };
  sessions.set(clientId, session);
  socket.on("message", raw => {
    if (sessions.get(clientId) !== session) return;
    let data;
    try { data = JSON.parse(String(raw)); } catch { return; }
    if (data?.type === "heartbeat") session.native = data.nativeNotifications === true;
    if (data?.type !== "notification_ack" || typeof data.requestId !== "string") return;
    const pending = session.pending.get(data.requestId);
    if (!pending || pending.id !== data.notificationId) return;
    session.pending.delete(data.requestId); clearTimeout(pending.timer);
    pending.resolve(data.ok === true);
  });
  socket.on("close", () => {
    if (sessions.get(clientId) === session) sessions.delete(clientId);
    for (const item of session.pending.values()) { clearTimeout(item.timer); item.resolve(false); }
    session.pending.clear();
  });
}
export function notificationCapability(clientId: string, ownerId: string) {
  const session = sessions.get(clientId);
  const client = getRemoteClient(clientId, ownerId);
  return Boolean(client && client.status !== "revoked" && session?.ownerId === ownerId && session.native && session.socket.readyState === 1);
}
export async function sendRemoteNotification(clientId: string, ownerId: string, notification: NotificationRecord, timeoutMs = 10000) {
  if (!notificationCapability(clientId, ownerId)) return false;
  const prefs = getNotificationPrefs(ownerId);
  if (!remoteNotificationAllowed(prefs, false, clientId)) return false;
  const display = notificationForDisplay(ownerId, notification, prefs);
  const session = sessions.get(clientId)!;
  const requestId = randomUUID();
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => { session.pending.delete(requestId); resolve(false); }, timeoutMs);
    session.pending.set(requestId, { id: notification.id, resolve, timer });
    try { session.socket.send(JSON.stringify({ type: "notification", requestId, notification: display })); }
    catch { clearTimeout(timer); session.pending.delete(requestId); resolve(false); }
  });
}
