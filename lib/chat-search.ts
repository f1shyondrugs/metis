import { Worker } from "node:worker_threads";
import path from "node:path";
import { databasePath, getDatabase } from "@/lib/sqlite";
import type { ChatSearchResult } from "@/lib/db-store";
export type SearchPayload = {
    results: ChatSearchResult[];
    indexing?: boolean;
    notes: {
        noteId: string;
        title: string;
        snippet: string;
        updatedAt: string;
    }[];
    projects: {
        id: string;
        name: string;
        color: string;
        icon: string;
    }[];
};
type Task = {
    resolve: (value: SearchPayload) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
};
type Pool = {
    worker?: Worker;
    serial: number;
    tasks: Map<number, Task>;
    idle?: ReturnType<typeof setTimeout>;
};
const key = Symbol.for("metis.chat-search-worker");
const globalPool = globalThis as typeof globalThis & {
    [key]?: Pool;
};
const pool: Pool = globalPool[key] ??= { serial: 0, tasks: new Map() };
const abortError = () => Object.assign(new Error("Search cancelled"), { name: "AbortError" });
export function searchOffThread(query: string, ownerId?: string, limit = 30, related = false, signal?: AbortSignal, includeNotes = true, uniqueChats = false): Promise<SearchPayload> {
    if (signal?.aborted)
        return Promise.reject(abortError());
    if (!query.trim())
        return Promise.resolve({ results: [], notes: [], projects: [] });
    if (pool.tasks.size >= 16)
        return Promise.reject(new Error("Search is busy. Retry shortly."));
    getDatabase(); // Ensure additive schema exists; never backfill on the web thread.
    if (pool.idle)
        clearTimeout(pool.idle);
    if (!pool.worker) {
        const worker = pool.worker = new Worker(path.join(process.env.AI_CHAT_INSTALL_DIR || process.cwd(), "lib/chat-search-worker.mjs"), {
            workerData: { databasePath }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16 },
        });
        const failed = (error: Error) => {
            if (pool.worker !== worker)
                return;
            pool.worker = undefined;
            for (const task of pool.tasks.values()) {
                task.cleanup();
                task.reject(error);
            }
            pool.tasks.clear();
        };
        worker.on("message", (reply: {
            id: number;
            value: SearchPayload;
            error?: string;
            errorName?: string;
        }) => {
            const task = pool.tasks.get(reply.id);
            if (!task)
                return;
            task.cleanup();
            pool.tasks.delete(reply.id);
            if (reply.error)
                task.reject(Object.assign(new Error(reply.error), { name: reply.errorName }));
            else
                task.resolve(reply.value);
            if (!pool.tasks.size) {
                pool.idle = setTimeout(() => { if (pool.worker === worker) {
                    pool.worker = undefined;
                    void worker.terminate();
                } }, 30000);
                pool.idle.unref();
                worker.unref();
            }
        });
        worker.on("error", failed);
        worker.on("exit", code => failed(new Error("Search worker exited (" + code + ")")));
    }
    const id = ++pool.serial, worker = pool.worker;
    worker.ref();
    return new Promise((resolve, reject) => {
        const cancel = () => { worker.postMessage({ id, cancel: true }); reject(abortError()); };
        const timeout = setTimeout(() => { worker.postMessage({ id, cancel: true }); reject(new Error("Search timed out. Retry shortly.")); }, 30000);
        const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); };
        pool.tasks.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", cancel, { once: true });
        worker.postMessage({ id, query: query.trim().slice(0, 200), ownerId, limit: Math.min(50, Math.max(1, limit)), related, includeNotes, uniqueChats });
    });
}
