import { REFERENCE_KINDS, type ReferenceResult } from "./reference-search";

/** Keep durable draft links, not cached file contents or terminal output. */
export function normalizeComposerDraftReferences(value: unknown): ReferenceResult[] {
  if (!Array.isArray(value)) return [];
  const result: ReferenceResult[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== "object" || !(REFERENCE_KINDS as readonly string[]).includes(item.kind)
      || typeof item.id !== "string" || !item.id.trim() || item.id.length > 2_000 || /[\u0000-\u001f\u007f]/.test(item.id)
      || typeof item.label !== "string" || !item.label.trim() || /[\r\n]/.test(item.label)) continue;
    const key = JSON.stringify([item.kind, item.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const reference: ReferenceResult = { kind: item.kind, id: item.id, label: item.label.slice(0, 1_000) };
    for (const field of ["detail", "chatId", "path", "sessionId", "parentId", "target"] as const) {
      if (typeof item[field] === "string") reference[field] = item[field].slice(0, field === "path" ? 4_096 : 1_000);
    }
    result.push(reference);
  }
  return result;
}

/** Older clients only write draft text. Never leave unrelated links attached to that text. */
export function retainComposerDraftReferences(text: string, references: readonly ReferenceResult[]): ReferenceResult[] {
  const labels = new Set(composerMentionTokens(text, references.map((reference) => reference.label)).map((token) => token.label));
  return references.filter((reference) => labels.has(reference.label));
}

/** Offsets are UTF-16, matching textarea selectionStart/selectionEnd. */
export type ComposerMentionQuery = { start: number; end: number; query: string };
export type ComposerMentionToken = { start: number; end: number; label: string };

function startsMention(text: string, start: number) {
  return start === 0 || /[\s([{]/u.test(text[start - 1]);
}

function endsMention(text: string, end: number) {
  return end === text.length || /[\s.,!?;:)\]}]/u.test(text[end]);
}

/** Only selected, complete @labels count as tokens; emails and label prefixes do not. */
export function composerMentionTokens(text: string, labels: readonly string[]): ComposerMentionToken[] {
  const candidates = [...new Set(labels)].filter(Boolean).sort((a, b) => b.length - a.length);
  const tokens: ComposerMentionToken[] = [];
  for (let start = text.indexOf("@"); start !== -1; start = text.indexOf("@", start + 1)) {
    if (!startsMention(text, start)) continue;
    const label = candidates.find((label) =>
      text.startsWith(label, start + 1) && endsMention(text, start + 1 + label.length));
    if (!label) continue;
    const end = start + 1 + label.length;
    tokens.push({ start, end, label });
    start = end - 1;
  }
  return tokens;
}

/** Remove the linked token, not a partial label, an email address, or unrelated spacing. */
export function removeComposerReferenceMention(text: string, label: string, labels: readonly string[]): string {
  const token = composerMentionTokens(text, labels).find((candidate) => candidate.label === label);
  if (!token) return text;
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  return before + (!before || /[ \t]$/u.test(before) ? after.replace(/^[ \t]+/u, "") : after);
}

/** A selection, completed token, email, or new line cannot be an active query. */
export function composerMentionQuery(
  text: string,
  cursor: number,
  selectionEnd = cursor,
  labels: readonly string[] = [],
): ComposerMentionQuery | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length || selectionEnd !== cursor) return null;
  const start = text.lastIndexOf("@", cursor - 1);
  if (start < 0 || start >= cursor || !startsMention(text, start)) return null;
  const query = text.slice(start + 1, cursor);
  if (/[\r\n@]/u.test(query)) return null;
  if (composerMentionTokens(text, labels).some((token) => start >= token.start && start < token.end)) return null;
  return { start, end: cursor, query };
}

/** Refuse stale menus rather than replacing unrelated live text after an async lookup. */
export function replaceComposerMention(
  text: string,
  mention: ComposerMentionQuery,
  label: string,
): { value: string; cursor: number } | null {
  const { start, end, query } = mention;
  if (!label || /[\r\n]/u.test(label) || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > text.length || !startsMention(text, start)
    || text.slice(start, end) !== "@" + query) return null;
  const suffix = text.slice(end);
  // Separate the completed token from subsequent typing without duplicating whitespace.
  const separator = !suffix || !/[\s.,!?;:)\]}]/u.test(suffix[0]) ? " " : "";
  const replacement = "@" + label + separator;
  return { value: text.slice(0, start) + replacement + suffix, cursor: start + replacement.length };
}

export function composerIsComposing(event: { isComposing?: boolean; keyCode?: number }, composing = false) {
  return composing || event.isComposing === true || event.keyCode === 229;
}

/** Keep category and result navigation on the same visible list. */
export function composerReferenceKeyAction(options: {
  key: string; shiftKey?: boolean; repeat?: boolean; composing?: boolean;
  count: number; index: number;
}): { type: "move"; index: number } | { type: "select"; index: number } | { type: "dismiss" } | null {
  if (options.composing) return null;
  if (options.key === "Escape") return { type: "dismiss" };
  const count = Math.max(0, Math.floor(options.count));
  if (!count) return null;
  const index = Math.min(count - 1, Math.max(0, Math.floor(options.index)));
  if (options.key === "ArrowDown") return { type: "move", index: (index + 1) % count };
  if (options.key === "ArrowUp") return { type: "move", index: (index - 1 + count) % count };
  if ((options.key === "Enter" || options.key === "Tab") && !options.shiftKey && !options.repeat) {
    return { type: "select", index };
  }
  return null;
}
