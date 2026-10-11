import type { MemoryScope } from "@/lib/memory-scopes.mjs";

export type WorkspaceMemory = {
 id: string;
 content: string;
 tags?: string[];
 createdAt: string;
 updatedAt: string;
};
export type ChatMemoryView = {
 chatId: string;
 label: "Chat Memory" | "Agent Memory";
 incognito: boolean;
 groups: {
  scope: MemoryScope;
  label: string;
  description: string;
  enabled: boolean;
  memories: WorkspaceMemory[];
 }[];
};

export function chatMemoryLabel(agentOriented: boolean): ChatMemoryView["label"] {
 return agentOriented ? "Agent Memory" : "Chat Memory";
}
