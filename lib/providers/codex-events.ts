import { providerErrorWithCause } from "@/lib/provider-rate-limit";

export function isCodexReconnectNotice(message: string): boolean {
  return /^\s*Reconnecting[\s.…]*\d+\s*\/\s*\d+\b/i.test(message);
}

/** A CLI reconnect notice is progress; an EOF without turn.completed is a failure. */
export async function* codexEventsUntilCompleted<T extends { type: string; message?: string }>(
  events: AsyncIterable<T>, signal?: AbortSignal,
): AsyncGenerator<T> {
  let completed = false;
  let lastDiagnostic: T | undefined;
  for await (const event of events) {
    signal?.throwIfAborted();
    if (event.type === "turn.completed") completed = true;
    if (event.type === "error") lastDiagnostic = event;
    yield event;
  }
  signal?.throwIfAborted();
  if (!completed) throw providerErrorWithCause(
    lastDiagnostic?.message || "Codex stream ended before the turn completed.",
    lastDiagnostic,
  );
}
