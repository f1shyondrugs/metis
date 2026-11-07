import {closeSync,fstatSync,readSync,readdirSync} from "node:fs";
import path from "node:path";
import {openSafeDirectory,openSafeRead,readSafeFile} from "@/lib/safe-file-read";
import { contextWindowOf } from "@/lib/context-window";

export function codexSessionHome(dataDir: string, ownerId: string, connectionId: string) {
  return path.join(dataDir, "provider-sessions", "codex", ownerId, connectionId);
}

/** The CLI cache is account-specific provider metadata, never a family guess. */
export function codexCachedContextWindow(home: string, modelId: string): number | undefined {
  try {
    const cache = JSON.parse(readSafeFile(path.join(home, "models_cache.json")).toString("utf8"));
    if (!Array.isArray(cache.models)) return undefined;
    const model = cache.models.find((entry: { slug?: string; id?: string; model?: string }) =>
      (entry.slug || entry.model || entry.id) === modelId,
    );
    return contextWindowOf(model);
  } catch {
    return undefined;
  }
}

export type CodexThreadContext = { usedTokens: number; maxTokens?: number };

/** Only last_token_usage describes the current context; totals accumulate across calls. */
export function codexContextFromRollout(tail: string): CodexThreadContext | undefined {
  for (const line of tail.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "event_msg" || event.payload?.type !== "token_count") continue;
      const info = event.payload.info;
      const used = info?.last_token_usage?.total_tokens;
      if (typeof used !== "number" || !Number.isFinite(used) || used < 0) continue;
      const maxTokens = contextWindowOf(info);
      return { usedTokens: used, ...(maxTokens ? { maxTokens } : {}) };
    } catch {
      // A bounded tail can begin mid-line or end at an in-progress write.
    }
  }
  return undefined;
}

/** Read at most 1 MiB of the exact thread's native rollout, without loading chat content. */
export function readCodexThreadRolloutTail(home: string, threadId: string): string | undefined {
  if (!/^[a-f0-9-]{36}$/i.test(threadId)) return undefined;
  let fd: number | undefined;
  try {
    const root = path.join(home, "sessions");
    const file = findRollout(root,`-${threadId}.jsonl`);
    if (!file) return undefined;
    const filename = path.join(root, file);
    fd = openSafeRead(filename);
    const size = fstatSync(fd).size;
    const length = Math.min(size, 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, size - length);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Bound metadata walking and never traverse a symlink supplied by the CLI. */
function findRollout(root:string,suffix:string):string|undefined{
  const pending=[{dir:root,relative:"",depth:0}];let budget=10000;
  while(pending.length&&budget>0){const item=pending.pop()!;let directory:number|undefined;
    try{directory=openSafeDirectory(item.dir);
      const entries=readdirSync(process.platform==="linux"?`/proc/self/fd/${directory}`:item.dir,{withFileTypes:true});
      for(const entry of entries){if(--budget<0)return;const relative=path.join(item.relative,entry.name);
        if(entry.isFile()&&entry.name.endsWith(suffix))return relative;
        if(entry.isDirectory()&&item.depth<5)pending.push({dir:path.join(root,relative),relative,depth:item.depth+1});
      }
    }catch{/* Unsafe or concurrently removed directories supply no telemetry. */}
    finally{if(directory!==undefined)closeSync(directory);}
  }
}

export function readCodexThreadContext(home: string, threadId: string): CodexThreadContext | undefined {
  const tail = readCodexThreadRolloutTail(home, threadId);
  return tail === undefined ? undefined : codexContextFromRollout(tail);
}
