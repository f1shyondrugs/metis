import { createHash } from "node:crypto";
import { innerToolName } from "@/lib/tool-call-display";
type Message = { id: string; role: string; content: string; tools?: Array<{ id: string; name: string; input?: string; result?: string }> };
export type UserInputProgress = { messageId?: string; signature: string };
function responseTools(message?: Message) {
  return (message?.tools ?? []).filter(tool => !/(?:^|__|[/.])(?:ask_user|request_mode_change|request_runtime_mode_change)$/.test(innerToolName(tool.name, tool.input, tool.result)));
}
export function hasUserInputResponse(message?: Message) {
  return Boolean(message?.content.trim() || responseTools(message).length);
}
/** A question/permission confirmation result is not work after the user answered. */
export function userInputProgress(messages: readonly Message[], messageId?: string): UserInputProgress {
  const message = messageId ? messages.find(item => item.id === messageId) : [...messages].reverse().find(item => item.role === "assistant");
  const tools = responseTools(message)
    .map(tool => [tool.id, innerToolName(tool.name, tool.input, tool.result)]);
  return { ...(message ? { messageId: message.id } : {}),
    signature: createHash("sha256").update(JSON.stringify({ text: message?.content.trim() ?? "", tools })).digest("hex") };
}
