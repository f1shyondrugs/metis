/** One scope contract for memory tools, API responses and workspace tabs. */
export const MEMORY_SCOPES = Object.freeze(["chat", "project", "global"]);

export function isMemoryScope(value) {
  return MEMORY_SCOPES.includes(value);
}

export function availableMemoryScopes({hasProject = false, includeGlobal = true, incognito = false} = {}) {
  if (incognito) return [];
  return MEMORY_SCOPES.filter(scope => scope === "chat" || (scope === "project" ? hasProject : includeGlobal));
}
