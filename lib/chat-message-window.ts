import { reconcileMessageParts, type MessagePartLike, type MessageToolLike } from "./message-parts";

type WindowInput<TTool extends MessageToolLike, TPart extends MessagePartLike<TTool>> = {
  parts?: readonly TPart[];
  tools?: readonly TTool[];
  content?: string;
  thinking?: string;
  thinkingDone?: boolean;
  eventOffset?: number;
  eventsUrl?: string;
  contentUrl?: string;
};

/** Hydrate an ordered page without mixing its deferred prefix into the visible tail. */
export function reconcileChatMessageWindow<TTool extends MessageToolLike, TPart extends MessagePartLike<TTool>>(
  input: WindowInput<TTool, TPart>,
  include: (part: TPart) => boolean = () => true,
) {
  const offset = input.eventOffset ?? 0;
  const partial = offset > 0;
  let nextIndex = offset;
  const indexed = input.parts?.map(part => {
    const storedIndex = (part as TPart & { transcriptIndex?: number }).transcriptIndex;
    const transcriptIndex = Number.isSafeInteger(storedIndex) && storedIndex! >= 0 ? storedIndex! : nextIndex;
    nextIndex = transcriptIndex + 1;
    return { ...part, transcriptIndex } as TPart;
  }).filter(include);
  const parts = reconcileMessageParts({
    ...input,
    parts: indexed,
    ...(partial ? { content: undefined, thinking: undefined } : {}),
  });
  const visibleContent = parts.map(part => part.type === "text" ? part.content : "").join("");
  let contentUrl = input.contentUrl;
  if (partial && !contentUrl && input.eventsUrl && input.content && visibleContent !== input.content) {
    // Older transcripts can store their reply only in the flat field. Keep it
    // available through the existing bounded-preview/full-text control.
    const url = new URL(input.eventsUrl, "http://metis.invalid");
    if (url.origin === "http://metis.invalid" && url.pathname.startsWith("/api/chats/")) {
      url.searchParams.delete("before");
      url.searchParams.set("full", "1");
      contentUrl = url.pathname + url.search;
    }
  }
  return {
    parts,
    content: partial ? visibleContent : input.content ?? "",
    thinking: partial ? undefined : input.thinking,
    contentUrl,
  };
}
