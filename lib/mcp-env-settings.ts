/** Browser-safe MCP metadata and environment patch validation. Never return registry values. */
export type McpEnvironmentPatch = { set: Record<string, string>; remove: string[] };
const envKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);
export class McpEnvironmentInputError extends Error {
  constructor() { super("Invalid environment changes. Use unique variable names and string values."); }
}
function validKey(key: string) {
  return key.length <= 128 && envKey.test(key) && !blockedKeys.has(key);
}
export function parseMcpEnvironmentPatch(value: unknown): McpEnvironmentPatch {
  const invalid = () => { throw new McpEnvironmentInputError(); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["set", "remove"].includes(key))) return invalid();
  const set = body.set ?? {};
  const remove = body.remove ?? [];
  if (!set || typeof set !== "object" || Array.isArray(set) || !Array.isArray(remove)) return invalid();
  if (Object.keys(set).length + remove.length > 100) return invalid();
  const result: Record<string, string> = Object.create(null);
  for (const [key, item] of Object.entries(set)) {
    if (!validKey(key) || typeof item !== "string" || item.length > 16384 || item.includes("\0")) return invalid();
    // Blank means preserve, not overwrite with an empty secret.
    if (item !== "") result[key] = item;
  }
  const removed = new Set<string>();
  for (const key of remove) {
    if (typeof key !== "string" || !validKey(key) || removed.has(key) || Object.hasOwn(set, key)) return invalid();
    removed.add(key);
  }
  return { set: result, remove: [...removed] };
}
function keys(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === "string"))].sort() : [];
}
export function configuredEnvironmentKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const server = value as Record<string, unknown>;
  const raw = server.env && typeof server.env === "object" && !Array.isArray(server.env) ? Object.keys(server.env) : [];
  return keys([...keys(server.configured_env_keys), ...raw]);
}
/** Allowlist only: probe errors and arbitrary runtime metadata may contain secrets. */
export function sanitizeMcpServer(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const server = value as Record<string, unknown>;
  return {
    id: typeof server.id === "string" ? server.id : "",
    name: typeof server.name === "string" ? server.name : "",
    kind: server.kind === "stdio" ? "stdio" : "remote",
    ...(typeof server.url === "string" ? { url: server.url } : {}),
    ...(typeof server.command === "string" ? { command: server.command } : {}),
    ...(Array.isArray(server.args) ? { args: server.args.filter((arg): arg is string => typeof arg === "string") } : {}),
    enabled: server.enabled === true,
    configured_env_keys: configuredEnvironmentKeys(server),
    configured_header_keys: keys([
      ...keys(server.configured_header_keys),
      ...(server.headers && typeof server.headers === "object" && !Array.isArray(server.headers) ? Object.keys(server.headers) : []),
    ]),
  };
}
export function ownedMcpServer(servers: unknown, id: string, userId: string) {
  return Array.isArray(servers) ? servers.find(server =>
    server && typeof server === "object" && server.id === id && server.ownerId === userId
  ) as Record<string, unknown> | undefined : undefined;
}
