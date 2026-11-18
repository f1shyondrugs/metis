"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChatListClient } from "@/lib/chat-list-client";

export function useChatList(enabled: boolean, projectId: string | null) {
  const [client] = useState(() => new ChatListClient());
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {
    client.configure(enabled, projectId);
    return () => client.dispose();
  }, [client, enabled, projectId]);
  return { ...state, setChats: client.setChats, refresh: client.refresh, loadMore: client.loadMore };
}
