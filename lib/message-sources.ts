export type SourceLink = {
  label: string;
  url: string;
};

/** Sources are explicit citations, never every URL mentioned in the response. */
export function extractMessageSources(message: { content: string }): SourceLink[] {
  const sources = new Map<string, SourceLink>();
  const add = (url: string, label?: string) => {
    const cleanUrl = url.replace(/[),.;!?]+$/g, "");
    if (!/^https?:\/\//i.test(cleanUrl) || sources.has(cleanUrl)) return;
    let fallbackLabel = cleanUrl;
    try {
      fallbackLabel = new URL(cleanUrl).hostname.replace(/^www\./i, "");
    } catch {
      // Keep the full URL when it cannot be parsed.
    }
    sources.set(cleanUrl, { label: label?.trim() || fallbackLabel, url: cleanUrl });
  };
  const addFromSourceBlock = (text: string) => {
    for (const match of text.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/gi)) {
      add(match[2], match[1]);
    }
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
      add(match[0]);
    }
  };
  for (const match of message.content.matchAll(/```sources\s*([\s\S]*?)```/gi)) {
    addFromSourceBlock(match[1]);
  }
  return [...sources.values()];
}

/** Match the favicon fallback already used by browser tabs and link previews. */
export function sourceFaviconUrl(href: string): string | undefined {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.origin + "/favicon.ico";
  } catch {
    return undefined;
  }
}
