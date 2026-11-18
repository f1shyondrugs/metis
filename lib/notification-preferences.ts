export type NotificationPrefs = {
  toastEnabled: boolean;
  /** Kept in the wire format for older clients; OS alerts now use Remote Clients. */
  browserEnabled: boolean;
  remoteEnabled: boolean;
  agentFinishedEnabled: boolean;
  showChatTitle: boolean;
  showServerDomain: boolean;
  remoteClientIds: string[];
};

export function normalizeNotificationPrefs(value: unknown, defaultClientIds: string[] = []): NotificationPrefs {
  const data = value && typeof value === "object" ? value as Partial<NotificationPrefs> : {};
  const selected = Array.isArray(data.remoteClientIds) ? data.remoteClientIds : defaultClientIds;
  const remoteClientIds = [...new Set(selected.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0,50);
  return {
    toastEnabled: typeof data.toastEnabled === "boolean" ? data.toastEnabled : true,
    browserEnabled: false,
    remoteEnabled: typeof data.remoteEnabled === "boolean" ? data.remoteEnabled : true,
    agentFinishedEnabled: typeof data.agentFinishedEnabled === "boolean" ? data.agentFinishedEnabled : true,
    showChatTitle: data.showChatTitle === true,
    showServerDomain: data.showServerDomain === true,
    remoteClientIds,
  };
}

export function remoteNotificationAllowed(prefs: NotificationPrefs, agentFinished = false, clientId?: string) {
  return prefs.remoteEnabled && (!agentFinished || prefs.agentFinishedEnabled)
    && (clientId === undefined || prefs.remoteClientIds.includes(clientId));
}
