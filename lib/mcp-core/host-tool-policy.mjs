// This initial policy governs these first-party gateway tools, not arbitrary OS activity.
export const HOST_TOOL_GROUPS = {
  terminal: ["execute_command", "service_control", "verify_work"],
  files: ["write_file", "edit_file", "delete_file"],
};
export const HOST_TOOL_RULES = ["inherit", "confirm", "block"];

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isHostToolRules(value) {
  return exactKeys(value, Object.keys(HOST_TOOL_GROUPS))
    && Object.keys(HOST_TOOL_GROUPS).every((key) => HOST_TOOL_RULES.includes(value[key]));
}

export function isHostToolPolicy(value) {
  return exactKeys(value, ["revision", "rules"])
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && isHostToolRules(value.rules);
}

export function hostRuleForTool(policy, name) {
  for (const [group, names] of Object.entries(HOST_TOOL_GROUPS)) {
    if (names.includes(name)) return policy?.rules[group] ?? "inherit";
  }
  return "inherit";
}
