import { setTimeout as delay } from "node:timers/promises";
import { getDatabase } from "@/lib/sqlite";
import { getJob } from "@/lib/db-jobs";
import { getPendingQuestion } from "@/lib/db-questions";

/** Durable gate: a dropped MCP connection never counts as a user answer. */
export async function waitForJobUserInput(jobId: string, userId?: string, signal?: AbortSignal) {
  while (true) {
    signal?.throwIfAborted();
    const job = getJob(jobId);
    if (!job || job.userId !== userId) throw new Error("Invalid question run context.");
    if (["cancelled", "interrupted", "error"].includes(job.status)) {
      throw new Error("The run was stopped before the user answered.");
    }
    const row = getDatabase().prepare(
      "SELECT question_id AS id FROM pending_questions WHERE job_id = ? AND user_id IS ? ORDER BY CASE WHEN status = 'waiting_for_user' THEN 0 ELSE 1 END, created_at DESC, rowid DESC LIMIT 1",
    ).get(jobId, userId ?? null) as { id: string } | undefined;
    const pending = row ? getPendingQuestion(row.id, userId) : null;
    if (!pending || pending.status === "answered") return;
    if (pending.status !== "waiting_for_user") throw new Error("The user question was cancelled.");
    await delay(250, undefined, { signal });
  }
}
