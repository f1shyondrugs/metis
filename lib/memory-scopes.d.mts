export type MemoryScope = "chat" | "project" | "global";
export const MEMORY_SCOPES: readonly ["chat", "project", "global"];
export function isMemoryScope(value: unknown): value is MemoryScope;
export function availableMemoryScopes(context?: {
  hasProject?: boolean;
  includeGlobal?: boolean;
  incognito?: boolean;
}): MemoryScope[];
