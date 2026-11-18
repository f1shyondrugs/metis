import { RUNTIME_MODES } from "./runtime-permissions.mjs";

// This is a transport ceiling, not a question expiry or model/provider default.
export const USER_INPUT_TRANSPORT_TIMEOUT_MS = 2 ** 31 - 1;

export async function awaitUserQuestionGate({ context, url, token, leaseHeaders, signal, dispatcher, fetcher = fetch }) {
  // Root maintenance calls and non-run sessions have no user question to await.
  if (!context.jobId || !context.chatId || !context.userId || !leaseHeaders["X-AI-Chat-Worker-Id"] || !leaseHeaders["X-AI-Chat-Lease-Token"]) return;
  const response = await fetcher(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token,
      "X-AI-Chat-Id": String(context.chatId), "X-AI-Chat-User-Id": String(context.userId),
      "X-AI-Chat-Job-Id": String(context.jobId), ...leaseHeaders },
    signal,
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (!response.ok) throw new Error("User-answer gate rejected the run (HTTP " + response.status + ").");
  const body = await response.json();
  if (body.waitingForUser !== false) throw new Error("The user-answer gate did not release the run.");
  // Signed provider tokens are snapshots. Only this lease-authorized server reply
  // refreshes runtime permissions, including changes made in another MCP session.
  if (body.runtimeMode !== undefined) {
    if (!RUNTIME_MODES.includes(body.runtimeMode)) throw new Error("Invalid runtime permission policy from the user-answer gate.");
    context.runtimeMode = body.runtimeMode;
  }
}

const activeQuestions = new Map();
async function waitForBarrier(barrier, signal) {
  if (!signal) return barrier;
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || new Error("Run cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { await Promise.race([barrier, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function withUserQuestionBarrier(name, context, execute, signal) {
  if (!context.jobId || !context.userId) return execute();
  const key = JSON.stringify([context.userId, context.jobId]);
  // Wait even when the provider dispatches a later tool concurrently.
  while (activeQuestions.has(key)) await waitForBarrier(activeQuestions.get(key), signal);
  if (!["ask_user", "request_runtime_mode_change"].includes(name)) return execute();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  activeQuestions.set(key, barrier);
  try { return await execute(); }
  finally { activeQuestions.delete(key); release(); }
}
