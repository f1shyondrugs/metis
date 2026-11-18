import { CHAT_LIST_PAGE_SIZE, type ChatListPage } from "@/lib/chat-list-pagination";
import type { ChatIndexEntry } from "@/lib/store";

export type ChatListState = ChatListPage & { loaded: boolean; loading: boolean; error: string };
const emptyState = (): ChatListState => ({ chats: [], nextCursor: null, loaded: false, loading: false, error: "" });

/** One serialized request stream per sidebar scope; obsolete responses never commit. */
export class ChatListClient {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private request: Promise<void> | null = null;
  private refreshPending = false;
  private projectId: string | null = null;
  private enabled = false;
  private pages = 1;
  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ChatListState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  configure(enabled: boolean, projectId: string | null) {
    this.controller?.abort();
    this.request = null;
    this.refreshPending = false;
    this.enabled = enabled;
    this.projectId = projectId;
    this.pages = 1;
    this.state = emptyState();
    this.listeners.forEach(listener => listener());
    if (enabled) void this.refresh();
  }
  dispose() {
    this.enabled = false;
    this.controller?.abort();
    this.controller = null;
    this.request = null;
    this.refreshPending = false;
  }
  setChats = (value: ChatIndexEntry[] | ((current: ChatIndexEntry[]) => ChatIndexEntry[])) => {
    this.publish({ chats: typeof value === "function" ? value(this.state.chats) : value });
  };
  refresh = (): Promise<void> => {
    if (!this.enabled) return Promise.resolve();
    if (this.request) {
      this.refreshPending = true;
      return this.request;
    }
    return this.run(false);
  };
  loadMore = (): Promise<void> => {
    if (!this.enabled || this.request || !this.state.nextCursor) return this.request || Promise.resolve();
    return this.run(true);
  };
  private run(append: boolean): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ loading: true, error: "" });
    const projectId = this.projectId;
    const task = async () => {
      try {
        let cursor = append ? this.state.nextCursor : null;
        const entries = append ? [...this.state.chats] : [];
        const count = append ? 1 : this.pages;
        let fetched = 0;
        for (let index = 0; index < count; index++) {
          const params = new URLSearchParams({ limit: String(CHAT_LIST_PAGE_SIZE), sidebar: "true" });
          if (projectId) params.set("projectId", projectId);
          if (cursor) params.set("cursor", cursor);
          const response = await this.fetcher("/api/chats?" + params, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Failed to load chats");
          const page = await response.json() as ChatListPage;
          if (controller.signal.aborted) return;
          entries.push(...page.chats);
          fetched++;
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (controller.signal.aborted) return;
        this.pages = append ? this.pages + 1 : fetched;
        this.publish({ chats: [...new Map(entries.map(chat => [chat.id, chat])).values()], nextCursor: cursor, loaded: true });
      } catch (error) {
        if (!controller.signal.aborted) this.publish({ loaded: true, error: error instanceof Error ? error.message : "Failed to load chats" });
      } finally {
        if (this.controller === controller && !controller.signal.aborted) {
          this.request = null;
          this.publish({ loading: false });
          if (this.refreshPending) {
            this.refreshPending = false;
            void this.refresh();
          }
        }
      }
    };
    this.request = Promise.resolve().then(task);
    return this.request;
  }
}
