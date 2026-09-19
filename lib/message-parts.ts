export type MessageToolLike = {
  id: string;
  name: string;
  status: string;
  kind?: string;
};

export type MessagePartLike<TTool extends MessageToolLike = MessageToolLike> =
  | { type: "thinking"; content: string; done?: boolean; durationMs?: number }
  | ({ type: "tool" } & TTool)
  | ({ type: "compaction" } & Record<string, unknown>)
  | { type: "text"; content: string };

type ReconcileMessagePartsInput<
  TTool extends MessageToolLike,
  TPart extends MessagePartLike<TTool>,
> = {
  parts?: readonly TPart[];
  content?: string;
  thinking?: string;
  thinkingDone?: boolean;
  thinkingDurationMs?: number;
  tools?: readonly TTool[];
};

function clonePart<TPart>(part: TPart): TPart {
  return { ...part };
}

/**
 * Reconciles the ordered message-part timeline with the flat compatibility
 * fields stored on ChatMessage. Existing order wins; missing or stale flat
 * projections are repaired without duplicating text or tool calls.
 */
export function reconcileMessageParts<
  TTool extends MessageToolLike,
  TPart extends MessagePartLike<TTool>,
>(input: ReconcileMessagePartsInput<TTool, TPart>): TPart[] {
  const parts = (input.parts ?? []).map(clonePart);
  const toolIndexes = new Map<string, number>();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.type !== "tool") continue;
    const previousIndex = toolIndexes.get(part.id);
    if (previousIndex === undefined) {
      toolIndexes.set(part.id, index);
      continue;
    }
    parts[previousIndex] = {
      ...parts[previousIndex],
      ...part,
      type: "tool",
    } as TPart;
    parts.splice(index, 1);
    index -= 1;
  }

  toolIndexes.clear();
  parts.forEach((part, index) => {
    if (part.type === "tool") toolIndexes.set(part.id, index);
  });
  for (const tool of input.tools ?? []) {
    const existingIndex = toolIndexes.get(tool.id);
    if (existingIndex !== undefined) {
      parts[existingIndex] = {
        ...parts[existingIndex],
        ...tool,
        type: "tool",
      } as TPart;
      continue;
    }
    const firstTextIndex = parts.findIndex((part) => part.type === "text");
    const insertionIndex = firstTextIndex >= 0 ? firstTextIndex : parts.length;
    parts.splice(insertionIndex, 0, { type: "tool", ...tool } as TPart);
    toolIndexes.clear();
    parts.forEach((part, index) => {
      if (part.type === "tool") toolIndexes.set(part.id, index);
    });
  }

  if (input.thinking !== undefined) {
    let thinkingIndex = -1;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (parts[index].type === "thinking") {
        thinkingIndex = index;
        break;
      }
    }
    const thinkingPart = {
      type: "thinking",
      content: input.thinking,
      ...(input.thinkingDone !== undefined ? { done: input.thinkingDone } : {}),
      ...(input.thinkingDurationMs !== undefined
        ? { durationMs: input.thinkingDurationMs }
        : {}),
    } as TPart;
    if (thinkingIndex >= 0) {
      parts[thinkingIndex] = {
        ...parts[thinkingIndex],
        ...thinkingPart,
      } as TPart;
    } else if (input.thinking) {
      const firstContentIndex = parts.findIndex(
        (part) => part.type === "tool" || part.type === "text",
      );
      parts.splice(
        firstContentIndex >= 0 ? firstContentIndex : parts.length,
        0,
        thinkingPart,
      );
    }
  }

  if (input.content !== undefined) {
    const textIndexes = parts
      .map((part, index) => part.type === "text" ? index : -1)
      .filter((index) => index >= 0);
    const existingText = textIndexes
      .map((index) => {
        const part = parts[index];
        return part.type === "text" ? part.content : "";
      })
      .join("");

    if (existingText !== input.content) {
      if (existingText && input.content.startsWith(existingText)) {
        const suffix = input.content.slice(existingText.length);
        if (suffix) {
          const last = parts.at(-1);
          if (last?.type === "text") last.content += suffix;
          else parts.push({ type: "text", content: suffix } as TPart);
        }
      } else {
        const insertionIndex = textIndexes[0] ?? parts.length;
        for (let index = textIndexes.length - 1; index >= 0; index -= 1) {
          parts.splice(textIndexes[index], 1);
        }
        if (input.content) {
          parts.splice(
            Math.min(insertionIndex, parts.length),
            0,
            { type: "text", content: input.content } as TPart,
          );
        }
      }
    }
  }

  return parts;
}

export function appendTextMessagePart<TTool extends MessageToolLike>(
  parts: Array<MessagePartLike<TTool>>,
  value: string,
) {
  if (!value) return;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.type === "thinking" && !part.done) {
      parts[index] = { ...part, done: true };
    }
  }
  const last = parts.at(-1);
  if (last?.type === "text") last.content += value;
  else parts.push({ type: "text", content: value });
}

export function upsertToolMessagePart<TTool extends MessageToolLike>(
  parts: Array<MessagePartLike<TTool>>,
  tool: TTool,
) {
  const index = parts.findIndex(
    (part) => part.type === "tool" && part.id === tool.id,
  );
  const next = { type: "tool" as const, ...tool };
  if (index >= 0) {
    parts[index] = { ...parts[index], ...next } as MessagePartLike<TTool>;
    return;
  }
  // Late tool events often arrive after the model already streamed its final
  // answer. Keep them in the activity timeline above that answer instead of
  // opening a new chip group under "I am done".
  let insertAt = parts.length;
  while (insertAt > 0 && parts[insertAt - 1]?.type === "text") insertAt -= 1;
  parts.splice(insertAt, 0, next);
}

export function updateThinkingMessagePart<TTool extends MessageToolLike>(
  parts: Array<MessagePartLike<TTool>>,
  update: {
    text?: string;
    replace?: boolean;
    done?: boolean;
    durationMs?: number;
  },
) {
  let index = -1;
  for (let candidate = parts.length - 1; candidate >= 0; candidate -= 1) {
    if (parts[candidate].type === "thinking") {
      index = candidate;
      break;
    }
  }
  const previous = index >= 0 && parts[index].type === "thinking"
    ? parts[index] as Extract<MessagePartLike<TTool>, { type: "thinking" }>
    : undefined;

  if (update.text !== undefined) {
    const content = update.replace || !previous
      ? update.text
      : previous.content + update.text;
    const next: MessagePartLike<TTool> = {
      type: "thinking",
      content,
      done: update.done ?? previous?.done ?? false,
      durationMs: update.durationMs ?? previous?.durationMs,
    };
    if (index >= 0) parts[index] = next;
    else parts.push(next);
    return;
  }

  if (previous) {
    parts[index] = {
      ...previous,
      done: update.done ?? previous.done,
      durationMs: update.durationMs ?? previous.durationMs,
    };
  }
}
