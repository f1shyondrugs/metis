export type SlashCommandId = "model" | "goal";

export const BUILT_IN_SLASH_COMMANDS: ReadonlyArray<{
  id: SlashCommandId;
  label: string;
  description: string;
}> = [
  { id: "model", label: "/model", description: "Choose a model" },
  { id: "goal", label: "/goal", description: "Send and keep a chat goal; /goal reset clears it" },
];

export const SLASH_SCOPES = ["model", "model-options", "mode", "access", "workspace", "chat"] as const;
export type SlashTrigger = { raw: string; query: string; scope?: typeof SLASH_SCOPES[number] };

/** The slash owns only the prefix before the caret, never a path, URL, selection, or suffix. */
export function slashTrigger(input: string, cursor: number, selectionEnd = cursor): SlashTrigger | null {
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > input.length || cursor !== selectionEnd || input[0] !== "/") return null;
  if (cursor < input.length && !/\s/u.test(input[cursor])) return null;
  const raw = input.slice(0, cursor);
  const plain = raw.match(/^\/([a-z-]*)$/i);
  if (plain) return { raw, query: plain[1].toLowerCase() };
  const scoped = raw.match(/^\/([a-z-]+)(?:[ \t]+|:[ \t]*)([^\/\r\n]{0,160})$/i);
  const scope = SLASH_SCOPES.find(name => name === scoped?.[1].toLowerCase());
  return scoped && scope ? { raw, scope, query: scoped[2] } : null;
}

export function slashCommandQuery(input: string, cursorPosition: number): string | null {
  return slashTrigger(input, cursorPosition)?.query ?? null;
}

/** Refuse stale DOM edits; a command consumes only its own token. */
export function consumeSlashTrigger(input: string, trigger: SlashTrigger | null): string | null {
  if (!trigger) return input;
  if (!input.startsWith(trigger.raw) || (input.length > trigger.raw.length && !/\s/u.test(input[trigger.raw.length]))) return null;
  return input.slice(trigger.raw.length).trimStart();
}

export function goalCommandAction(argument: string): { kind: "reset" } | { kind: "set"; goal: string } {
  const goal = argument.trim().slice(0, 4_000);
  return !goal || /^(?:reset|clear)$/i.test(goal) ? { kind: "reset" } : { kind: "set", goal };
}

export function matchSlashCommand(input: string): { id: SlashCommandId; argument: string } | null {
  const match = input.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = BUILT_IN_SLASH_COMMANDS.find((item) => item.id === match[1].toLowerCase());
  return command ? { id: command.id, argument: (match[2] || "").trim() } : null;
}
