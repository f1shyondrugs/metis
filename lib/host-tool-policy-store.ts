import { getDatabase, transaction } from "@/lib/sqlite";
import { isHostToolPolicy, isHostToolRules, type HostToolPolicy, type HostToolRules } from "@/lib/mcp-core/host-tool-policy.mjs";

const KEY = "host_tool_policy_v1";

export function getHostToolPolicy(): HostToolPolicy {
  const row = getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as {value: string} | undefined;
  if (!row) return {revision: 0, rules: {terminal: "inherit", files: "inherit"}};
  const parsed: unknown = JSON.parse(row.value);
  if (!isHostToolPolicy(parsed)) throw new Error("Invalid stored host tool policy.");
  return parsed;
}

export function saveHostToolPolicy(expectedRevision: number, rules: HostToolRules): HostToolPolicy | null {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !isHostToolRules(rules)) {
    throw new Error("Invalid host tool policy.");
  }
  return transaction(() => {
    const current = getHostToolPolicy();
    if (current.revision !== expectedRevision) return null;
    if (current.rules.terminal === rules.terminal && current.rules.files === rules.files) return current;
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error("Policy revision exhausted.");
    const next = {revision: current.revision + 1, rules};
    getDatabase().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(KEY, JSON.stringify(next));
    return next;
  });
}
