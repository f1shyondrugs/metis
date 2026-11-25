export type HostToolGroup = "terminal" | "files";
export type HostToolRule = "inherit" | "confirm" | "block";
export type HostToolRules = Record<HostToolGroup, HostToolRule>;
export type HostToolPolicy = { revision: number; rules: HostToolRules };
export const HOST_TOOL_GROUPS: Readonly<Record<HostToolGroup, readonly string[]>>;
export const HOST_TOOL_RULES: readonly HostToolRule[];
export function isHostToolRules(value: unknown): value is HostToolRules;
export function isHostToolPolicy(value: unknown): value is HostToolPolicy;
export function hostRuleForTool(policy: HostToolPolicy | undefined, name: string): HostToolRule;
