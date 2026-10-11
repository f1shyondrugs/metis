import {loadContextScope, globalFactsForScope} from "@/lib/context-scope";
import {getChat} from "@/lib/db-store";
import {chatMemoryLabel, type ChatMemoryView, type WorkspaceMemory} from "@/lib/chat-memory-view-model";

/** Read-only view of the memories available to this owned chat. */
export function loadChatMemoryView(chatId: string, ownerId: string): ChatMemoryView | null {
 if (!ownerId) return null;
 const chat = getChat(chatId, ownerId);
 if (!chat) return null;
 const scope = loadContextScope({chatId, ownerId, includeGlobal: false});
 if (!scope || (!chat.incognito && chat.projectId && !scope.project)) return null;
 const project = scope.project;
 const agentOriented = project?.mode === "agents";
 const label = chatMemoryLabel(agentOriented);
 if (chat.incognito) return {chatId, label, incognito: true, groups: []};
 const active = (memories: readonly (WorkspaceMemory & {state?: string})[]) => memories
  .filter(memory => memory.state !== "archived" && memory.state !== "superseded")
  .map(({id, content, tags, createdAt, updatedAt}) => ({id, content, ...(tags?.length ? {tags} : {}), createdAt, updatedAt}));
 const groups: ChatMemoryView["groups"] = [{
  scope: "chat", label, enabled: true,
  description: agentOriented ? "Decisions and context kept for this agent. Other agents have their own memory." : "Decisions and context kept only for this chat.",
  memories: active(scope.learnedFacts),
 }];
 if (project) groups.push({
  scope: "project", label: "Project Memory", enabled: true,
  description: "Shared across chats and agents in this project.",
  memories: active(project.memories || []),
 });
 const globalEnabled = project?.memoryMode !== "project_only";
 groups.push({
  scope: "global", label: "Global Memory", enabled: globalEnabled,
  description: globalEnabled ? "Account memories available for relevant retrieval. Each run uses only the facts it needs." : "Global memory is disabled for this project.",
  memories: globalEnabled ? active(globalFactsForScope({chatId, ownerId, includeGlobal: true})) : [],
 });
 return {chatId, label, incognito: false, groups};
}
