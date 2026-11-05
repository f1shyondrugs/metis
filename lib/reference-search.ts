export const REFERENCE_KINDS = ["file", "canvas", "plan", "note", "issue", "browser", "terminal", "memory", "chat"] as const;
export type ReferenceKind = typeof REFERENCE_KINDS[number];
export type ReferenceResult = {
  kind: ReferenceKind; id: string; label: string; detail?: string; chatId?: string;
  isCurrentChat?: boolean; path?: string; content?: string; sessionId?: string; parentId?: string; target?: string;
};

export const normalizeReferenceText = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/ß/g, "ss");
/** Search words independently; accents and German spelling should not hide a result. */
export function referenceMatches(query: string, ...values: Array<string | undefined>) {
  const terms = normalizeReferenceText(query).trim().split(/\s+/).filter(Boolean);
  // Most hits match a short title. Do not normalize a 6KB body after every term is found.
  let remaining = terms;
  for (const value of values) {
    if (!remaining.length) return true;
    if (!value) continue;
    const text = normalizeReferenceText(value);
    remaining = remaining.filter(term => !text.includes(term));
  }
  return remaining.length === 0;
}

export type ReferenceSearchState<T> = { key: string; status: "loading" | "ready" | "error"; results: T[]; error?: string; indexing?: boolean; notice?: string };

/** One active lookup; finite polling and revision guards also cover transports that ignore abort. */
export function createReferenceLookup<T>(fetcher: typeof fetch = fetch, options: {
  requestTimeoutMs?: number; pollIntervalMs?: number; maxIndexPolls?: number;
} = {}) {
  let revision = 0;
  let controller: AbortController | undefined;
  const cancel = () => { revision++; controller?.abort(); };
  return {
    cancel,
    async load(input: { chatId?: string | null; kind?: ReferenceKind | null; kinds?: readonly ReferenceKind[]; query: string; key: string },
      publish: (state: ReferenceSearchState<T>) => void) {
      cancel();
      const request = revision, current = controller = new AbortController();
      const active = () => request === revision && !current.signal.aborted;
      let results: T[] = [];
      publish({ key: input.key, status: "loading", results });
      const params = new URLSearchParams({ q: input.query, chatId: input.chatId || "" });
      if (input.kind) params.set("kind", input.kind);
      if (input.kinds?.length) params.set("kinds", input.kinds.join(","));
      const deadline = Date.now() + 10_000;
      try {
        for (let poll = 0; active(); poll++) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let abort: (() => void) | undefined;
          const operation = async () => {
            const response = await fetcher("/api/references?" + params, { cache: "no-store", signal: current.signal });
            if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to search your context." : "Could not load context. Try again.");
            const body = await response.json() as { results?: T[]; indexing?: boolean };
            if (!Array.isArray(body.results)) throw new Error("Could not load context. Try again.");
            return body as { results: T[]; indexing?: boolean };
          };
          let body: {results:T[];indexing?:boolean};
          try {
            body = await Promise.race([operation(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Context search timed out. Try again.")), Math.min(options.requestTimeoutMs ?? 8_000, Math.max(1, deadline - Date.now())));
              abort = () => reject(Object.assign(new Error("Search cancelled"), { name: "AbortError" }));
              current.signal.addEventListener("abort", abort, { once: true });
              if (current.signal.aborted) abort();
            })]);
          } finally {
            clearTimeout(timer);
            if (abort) current.signal.removeEventListener("abort", abort);
          }
          if (!active()) return;
          results = body.results;
          const indexing = Boolean(body.indexing);
          const exhausted = indexing && (poll + 1 >= (options.maxIndexPolls ?? 20) || Date.now() >= deadline);
          publish({ key: input.key, status: "ready", results, indexing: indexing && !exhausted,
            ...(exhausted ? { notice: "Some files are still being indexed. Search again shortly." } : {}) });
          if (!indexing || exhausted) return;
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(wait); current.signal.removeEventListener("abort", done); resolve(); };
            const wait = setTimeout(done, options.pollIntervalMs ?? 500);
            current.signal.addEventListener("abort", done, { once: true });
            if (current.signal.aborted) done();
          });
        }
      } catch (error) {
        if (active()) {
          const message = error instanceof Error ? error.message : "Could not load context. Try again.";
          publish(results.length ? { key: input.key, status: "ready", results, notice: message } : {
            key: input.key, status: "error", results: [], error: message,
          });
          current.abort();
        }
      }
    },
  };
}
