import type { MessagePart, ToolPart } from "@/lib/store";
import { getDatabase } from "@/lib/sqlite";
import { editedFileFromTool } from "@/lib/edited-files";
import { unwrapToolRecord } from "@/lib/tool-call-display";
import { researchProgressFromTool, researchToolNameFromTool } from "@/lib/research-progress";
import { acknowledgeFileEditSnapshot } from "@/lib/mcp-core/file-edit-snapshots.mjs";

const TOOL_INPUT_MAX_CHARS = 32_000;
const TOOL_RESULT_MAX_CHARS = 64_000;
const NESTED_TOOL_INPUT_MAX_CHARS = 8_000;
const NESTED_TOOL_RESULT_MAX_CHARS = 16_000;
const SUBAGENT_THINKING_MAX_CHARS = 32_000;
const SUBAGENT_MESSAGE_MAX_CHARS = 32_000;
const SUBAGENT_TOOL_LIMIT = 80;

export function truncatePersistedToolText(value: string | undefined, maxChars: number) {
  if (!value || value.length <= maxChars) return value;
  const marker = `\n…[truncated ${value.length - maxChars} chars]…\n`;
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.6);
  const tail = Math.floor(available * 0.4);
  return `${value.slice(0, head)}${marker}${tail ? value.slice(-tail) : ""}`;
}

function limitArray<T>(items: T[], max: number) {
  if (items.length <= max) return items;
  const head = Math.ceil(max / 2);
  const tail = Math.floor(max / 2);
  return [...items.slice(0, head), ...items.slice(-tail)];
}

export function compactToolForPersistence(tool: ToolPart, nested = false): ToolPart {
  const inputLimit = nested ? NESTED_TOOL_INPUT_MAX_CHARS : TOOL_INPUT_MAX_CHARS;
  const resultLimit = nested ? NESTED_TOOL_RESULT_MAX_CHARS : TOOL_RESULT_MAX_CHARS;
  const subagent = tool.subagent
    ? {
        ...tool.subagent,
        ...(tool.subagent.thinking
          ? { thinking: truncatePersistedToolText(tool.subagent.thinking, SUBAGENT_THINKING_MAX_CHARS) }
          : {}),
        ...(tool.subagent.messages
          ? {
              messages: limitArray(tool.subagent.messages, 80).map((message) => ({
                ...message,
                text: truncatePersistedToolText(message.text, SUBAGENT_MESSAGE_MAX_CHARS) || "",
              })),
            }
          : {}),
        ...(tool.subagent.tools
          ? {
              tools: limitArray(tool.subagent.tools, SUBAGENT_TOOL_LIMIT).map((item) =>
                compactToolForPersistence(item, true),
              ),
            }
          : {}),
      }
    : undefined;

  const compactDiff = tool.diff
    ? {
        ...(typeof tool.diff.additions === "number" ? { additions: tool.diff.additions } : {}),
        ...(typeof tool.diff.deletions === "number" ? { deletions: tool.diff.deletions } : {}),
      }
    : undefined;

  const researchToolName = researchToolNameFromTool(tool);
  const research = researchToolName ? researchProgressFromTool(tool) : undefined;
  return {
    ...tool,
    researchToolName,
    research,
    ...(tool.status === "completed" ? { editedFile: editedFileFromTool(tool) } : {}),
    // Full before/after snapshots live in tool_revert_snapshots. Keeping them in
    // the transcript made a handful of edits inflate chats to tens of MB.
    ...(compactDiff && Object.keys(compactDiff).length ? { diff: compactDiff } : { diff: undefined }),
    ...(tool.input ? { input: truncatePersistedToolText(tool.input, inputLimit) } : {}),
    // Parsed subagent metadata is canonical. Keeping the Cursor conversationSteps
    // blob as well only duplicates file contents and is what previously leaked
    // raw assistantMessage/readToolCall JSON into the UI.
    ...(tool.result && !(tool.kind === "subagent" && subagent)
      ? { result: truncatePersistedToolText(tool.result, resultLimit) }
      : { result: undefined }),
    ...(subagent ? { subagent } : {}),
  };
}

/**
 * Message.parts exists to preserve interleaving/order. The full ToolPart already
 * lives in message.tools (and must retain complete edit snapshots for Revert),
 * so persisting the same potentially-large payload twice is unnecessary.
 */
export function compactMessagePartsForPersistence(parts: MessagePart[]): MessagePart[] {
  return parts.map((part) => {
    if (part.type !== "tool") return part;
    const researchToolName = researchToolNameFromTool(part);
    const research = researchToolName ? researchProgressFromTool(part) : undefined;
    return {
      type: "tool",
      id: part.id,
      name: part.name,
      status: part.status,
      ...(part.kind ? { kind: part.kind } : {}),
      ...(researchToolName ? { researchToolName } : {}),
      ...(research ? { research } : {}),
      ...(part.source ? { source: part.source } : {}),
      ...(part.path ? { path: part.path } : {}),
      ...(part.status === "completed" ? { editedFile: editedFileFromTool(part) } : {}),
      ...(part.detail ? { detail: part.detail } : {}),
    };
  });
}


export function revertSnapshotFromTool(tool: ToolPart) {
  if (tool.kind !== "edit" || !tool.diff) return null;
  const before = typeof tool.diff.before === "string" ? tool.diff.before : undefined;
  const after = typeof tool.diff.after === "string" ? tool.diff.after : undefined;
  if (before === undefined && after === undefined) return null;
  return {
    ...(tool.path ? { path: tool.path } : {}),
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

export function persistToolsForMessage(
  chatId: string,
  messageId: string,
  tools: ToolPart[],
): ToolPart[] {
  if (!tools.length) return [];
  const db = getDatabase();
  const upsert = db.prepare(
    `INSERT INTO tool_revert_snapshots
      (chat_id, message_id, tool_id, path, before_text, after_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, message_id, tool_id) DO UPDATE SET
       path = COALESCE(excluded.path, tool_revert_snapshots.path),
       before_text = CASE WHEN ? THEN NULL ELSE COALESCE(excluded.before_text, tool_revert_snapshots.before_text) END,
       after_text = COALESCE(excluded.after_text, tool_revert_snapshots.after_text),
       updated_at = excluded.updated_at`,
  );
  const now = new Date().toISOString();
  for (const tool of tools) {
    const snapshot = revertSnapshotFromTool(tool);
    if (!snapshot) continue;
    upsert.run(
      chatId,
      messageId,
      tool.id,
      snapshot.path ?? null,
      snapshot.before ?? null,
      snapshot.after ?? null,
      now,
      now,
      tool.status === "completed" && snapshot.before === undefined
        && Object.prototype.hasOwnProperty.call(tool.diff, "before") && typeof snapshot.after === "string" ? 1 : 0,
    );
    acknowledgeFileEditSnapshot(unwrapToolRecord(tool.result)?.fileSnapshotRef, chatId, snapshot);
  }
  return tools.map((tool) => compactToolForPersistence(tool));
}

export function getToolRevertSnapshot(
  chatId: string,
  messageId: string,
  toolId: string,
  ownerId?: string,
) {
  const db = getDatabase();
  const row = ownerId
    ? db.prepare(
        `SELECT s.path, s.before_text AS beforeText, s.after_text AS afterText
         FROM tool_revert_snapshots s
         JOIN chats c ON c.id = s.chat_id
         WHERE s.chat_id = ? AND s.message_id = ? AND s.tool_id = ? AND c.owner_id = ?`,
      ).get(chatId, messageId, toolId, ownerId)
    : db.prepare(
        `SELECT path, before_text AS beforeText, after_text AS afterText
         FROM tool_revert_snapshots
         WHERE chat_id = ? AND message_id = ? AND tool_id = ?`,
      ).get(chatId, messageId, toolId);
  if (!row) return null;
  const value = row as { path?: string | null; beforeText?: string | null; afterText?: string | null };
  return {
    ...(value.path ? { path: value.path } : {}),
    ...(value.beforeText !== null && value.beforeText !== undefined ? { before: value.beforeText } : {}),
    ...(value.afterText !== null && value.afterText !== undefined ? { after: value.afterText } : {}),
  };
}

export function hydrateToolsForRevert(
  chatId: string,
  messageId: string,
  tools: ToolPart[] | undefined,
): ToolPart[] | undefined {
  if (!tools?.length) return tools;
  return tools.map((tool) => {
    if (tool.kind !== "edit") return tool;
    const snapshot = getToolRevertSnapshot(chatId, messageId, tool.id);
    if (!snapshot) return tool;
    return {
      ...tool,
      ...(snapshot.path && !tool.path ? { path: snapshot.path } : {}),
      diff: {
        ...(tool.diff ?? {}),
        ...(Object.prototype.hasOwnProperty.call(snapshot, "before") ? { before: snapshot.before } : {}),
        ...(Object.prototype.hasOwnProperty.call(snapshot, "after") ? { after: snapshot.after } : {}),
      },
    };
  });
}
