import { randomBytes, randomInt } from "node:crypto";
import type { AcceptanceCheck, AcceptanceTarget, AcceptanceCell } from "./acceptance";
import type { ChatMessage, ToolPart } from "@/lib/store";
import type { AgentJob } from "@/lib/jobs";

export const AUTOMATED_ACCEPTANCE_CHECKS: AcceptanceCheck[] = [
  "response", "streaming", "persistence", "mcp", "continuation", "vision", "cancellation", "usage",
];
export const ACCEPTANCE_CHECK_LABELS: Record<AcceptanceCheck, string> = {
  response: "Model response", streaming: "Incremental runtime events", persistence: "Durable answer",
  mcp: "MCP read / compute / write", continuation: "Conversation continuation", vision: "Image input",
  cancellation: "Running-turn cancellation", usage: "Measured usage",
  "interactive-input": "Interactive input", "model-switch": "Model switch", browser: "Browser",
  skills: "Skills", subagents: "Subagents",
};
export type AcceptanceProbeKind = "baseline" | "mcp" | "continuation" | "vision" | "cancellation";
export type AcceptanceProbe = {
  targetId: string; kind: AcceptanceProbeKind; checks: AcceptanceCheck[];
};
export type AcceptanceChallenge = {
  nonce: string; numbers: number[]; sum: number; colors?: string[];
};
export function newAcceptanceChallenge(): AcceptanceChallenge {
  const numbers = Array.from({ length: 4 }, () => randomInt(10, 1000));
  return { nonce: randomBytes(18).toString("hex"), numbers, sum: numbers.reduce((a, b) => a + b, 0) };
}
export function acceptanceProbeQueue(targets: AcceptanceTarget[], selectedIds: string[], checks: AcceptanceCheck[]): AcceptanceProbe[] {
  const selected = new Set(selectedIds);
  const queue: AcceptanceProbe[] = [];
  for (const target of targets.filter(item => selected.has(item.id))) {
    if (!target.connectionId || !target.modelKey || target.cells.every(cell => cell.status === "blocked")) continue;
    const wants = (check: AcceptanceCheck) => checks.includes(check)
      && target.cells.some(cell => cell.check === check && cell.status === "untested");
    const baseline = checks.filter(check => ["response", "streaming", "persistence", "usage"].includes(check) && wants(check));
    // Continuation needs an earlier completed turn in the SAME test chat.
    if (baseline.length || wants("continuation")) queue.push({ targetId: target.id, kind: "baseline", checks: baseline });
    for (const kind of ["mcp", "continuation", "vision", "cancellation"] as const) {
      if (wants(kind)) queue.push({ targetId: target.id, kind, checks: [kind] });
    }
  }
  return queue;
}
export function probePrompt(kind: AcceptanceProbeKind, challenge: AcceptanceChallenge, files?: { input: string; output: string }): string {
  const prefix = "This is a bounded Metis integration test in a private test chat. Do not browse, delegate, change settings, create notes or memories, or access unrelated files. ";
  if (kind === "baseline") return prefix + "Remember this test marker for the next turn: " + challenge.nonce
    + ". Use no tools. Reply with exactly this marker, then a short sentence explaining that the test is running.";
  if (kind === "continuation") return prefix + "Use no tools. Return only the test marker you were given in the first turn of this conversation. It is intentionally not repeated in this message.";
  if (kind === "mcp") {
    if (!files) throw new Error("MCP probe requires its isolated fixture paths.");
    return prefix + "Use the canonical Metis MCP read_file tool to read " + JSON.stringify(files.input)
      + ". That file contains a nonce and an array of numbers. Compute their sum. Use the canonical Metis MCP write_file tool to create "
      + JSON.stringify(files.output) + ' with ONLY JSON {"nonce":<the nonce from the input file>,"sum":<computed sum>}. '
      + "Do not use native provider file or shell tools. Reply briefly when finished.";
  }
  if (kind === "vision") return prefix + "Use no tools. Inspect the attached 3 by 3 grid of solid colors. "
    + "Return exactly nine color names, row by row from top left, using only red, blue, green, yellow, black, white, separated by spaces.";
  return prefix + "Use no tools. Count upwards from 1 to 100000, one number per line. This running generation will be stopped by the test controller.";
}
export async function acceptanceVisionImage(challenge: AcceptanceChallenge): Promise<string> {
  const palette: Record<string, string> = { red: "#ff0000", blue: "#0000ff", green: "#00aa00", yellow: "#ffff00", black: "#000000", white: "#ffffff" };
  const names = Object.keys(palette);
  challenge.colors = Array.from({ length: 9 }, () => names[randomInt(names.length)]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">'
    + challenge.colors.map((color, index) => '<rect x="' + (index % 3) * 100 + '" y="' + Math.floor(index / 3) * 100
      + '" width="100" height="100" fill="' + palette[color] + '"/>').join("") + "</svg>";
  const sharp = (await import("sharp")).default;
  return (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
export type AcceptanceObservation = {
  job: AgentJob;
  message?: ChatMessage;
  persistedMessage?: ChatMessage;
  streamedAnswerMatches?: boolean;
  fixturePaths?: { input: string; output: string };
  textEvents: number;
  textBeforeDone: number;
  wasRunning: boolean;
  leaseReleased: boolean;
  cancelRequested: boolean;
  executionIdentity?: { providerId: string; connectionId: string; modelId: string };
  fileOutput?: string;
};
function completedMcpTools(tools: ToolPart[]): ToolPart[] {
  return tools.filter(tool => tool.source === "mcp" && tool.status === "completed");
}
export function verifyAcceptanceProbe(input: {
  probe: AcceptanceProbe; target: AcceptanceTarget; challenge: AcceptanceChallenge;
  observation: AcceptanceObservation; checkedAt: string;
}): AcceptanceCell[] {
  const { probe, target, challenge, observation: observed, checkedAt } = input;
  const { job, message } = observed;
  const metadata = message?.runMetadata;
  const actualModel = metadata?.modelId;
  const scopedModel = actualModel === target.modelKey;
  const identityMatches = job.modelId === target.modelKey && metadata?.providerId === target.providerKey
    && metadata?.connectionId === target.connectionId && (actualModel === target.modelId || scopedModel);
  const complete = job.status === "completed" && identityMatches;
  const evidence = { jobId: job.id, chatId: job.chatId, execution: "metis-worker", provider: target.providerKey,
    model: target.modelId || "", connectionId: target.connectionId || "", identityMatches, textEvents: observed.textEvents };
  const result = (check: AcceptanceCheck, ok: boolean, reason: string, blocked = false): AcceptanceCell => ({
    check, status: ok ? "passed" : blocked ? "blocked" : "failed", reason, checkedAt, evidence,
  });
  if (probe.kind === "cancellation") {
    const runtime = observed.executionIdentity;
    const runtimeMatches = job.modelId === target.modelKey && runtime?.providerId === target.providerKey
      && runtime?.connectionId === target.connectionId && runtime?.modelId === target.modelId;
    const ok = job.status === "cancelled" && runtimeMatches && observed.textEvents > 0 && observed.wasRunning && observed.cancelRequested && observed.leaseReleased;
    return probe.checks.map(check => result(check, ok, ok
      ? "A running generation was cancelled and its worker lease was released; provider-side billing is not observable."
      : "Cancellation did not establish the exact runtime identity, a running generation with text, and a released worker lease."));
  }
  if (job.status !== "completed") {
    const blocked = Boolean(job.providerRateLimit) || ["waiting_input", "waiting_for_user", "queued"].includes(job.status);
    return probe.checks.map(check => result(check, false,
      blocked ? "Execution is blocked by provider availability, queue admission, or interactive approval."
        : "The worker did not complete the requested test turn (status: " + job.status + ").", blocked));
  }
  if (!identityMatches) return probe.checks.map(check => result(check, false, "Persisted runtime identity does not match the exact selected provider, connection and model."));
  if (probe.kind === "baseline") return probe.checks.map(check => {
    if (check === "response") return result(check, complete && Boolean(message?.content.includes(challenge.nonce)), "The completed answer must include the random challenge marker.");
    if (check === "streaming") return result(check, complete && observed.textBeforeDone >= 2, "At least two non-empty text events must precede the terminal event. Browser paint and HTTP SSE delivery are not tested here.");
    if (check === "persistence") return result(check, complete && observed.streamedAnswerMatches === true && observed.persistedMessage?.id === message?.id
      && observed.persistedMessage?.content === message?.content && Boolean(message?.content.includes(challenge.nonce)),
    "A fresh canonical database read must match every runtime text fragment hash, the completed answer and random marker.");
    if (check === "usage") {
      const measured = Boolean(metadata && !metadata.inputTokensEstimated
        && typeof metadata.inputTokens === "number" && Number.isFinite(metadata.inputTokens) && metadata.inputTokens >= 0
        && typeof metadata.outputTokens === "number" && Number.isFinite(metadata.outputTokens) && metadata.outputTokens > 0);
      return result(check, measured, measured ? "Measured non-estimated input and output token usage was persisted." : "Measured non-estimated token usage was not available.", !measured);
    }
    return result(check, false, "No verifier is implemented for this check.", true);
  });
  if (probe.kind === "continuation") return probe.checks.map(check => result(check, message?.content.trim() === challenge.nonce, "The follow-up must recall the first-turn marker without receiving it again."));
  if (probe.kind === "vision") {
    const colors = message?.content.toLowerCase().match(/\b(red|blue|green|yellow|black|white)\b/g);
    const ok = Boolean(challenge.colors?.length === 9 && colors?.length === 9 && colors.every((color, i) => color === challenge.colors![i]));
    return probe.checks.map(check => result(check, ok, "All nine randomly chosen image colors must match in row-major order; the answer is not included in the prompt."));
  }
  let output: Record<string, unknown> | undefined;
  try { output = JSON.parse(observed.fileOutput || ""); } catch { /* A malformed file must fail. */ }
  const tools = [...(message?.tools || []), ...(message?.parts || []).filter(part => part.type === "tool") as ToolPart[]];
  const mcp = completedMcpTools(tools);
  const read = mcp.some(tool => /read_file/.test(tool.name + " " + tool.input) && Boolean(observed.fixturePaths?.input && (tool.input || "").includes(observed.fixturePaths.input)));
  const write = mcp.some(tool => /write_file/.test(tool.name + " " + tool.input) && Boolean(observed.fixturePaths?.output && (tool.input || "").includes(observed.fixturePaths.output)));
  const native = tools.some(tool => tool.source === "native");
  const ok = !native && read && write && output?.nonce === challenge.nonce && output?.sum === challenge.sum;
  return probe.checks.map(check => result(check, ok,
    "Completed canonical MCP read/write calls and the independently read output file must prove the hidden nonce and computed sum; native fallback is not accepted."));
}
