import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { writeSafeFile } from "@/lib/safe-file-read";
import { nativeRuntimeScope } from "./native-sandbox";

/** Per invocation: the CLI rereads this base policy even when resuming a thread.
 * Do not use developer_instructions: the CLI restores its old value on resume.
 * Keep the file in an already mounted account home when isolation is active.
 */
export function createCodexInstructionFile(instructions: string, home?: string): string {
  const file = path.join(home || nativeRuntimeScope()?.home || os.tmpdir(), `metis-instructions-${randomUUID()}.md`);
  writeSafeFile(file, instructions, { exclusive: true, mode: 0o600 });
  return file;
}
