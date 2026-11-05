"use client";
import { createClientId } from "@/lib/client-id";
import { UPLOAD_REQUEST_BYTES, type UploadedFile } from "@/lib/upload-limits";
export type UploadTask = {
  id: string; name: string; size: number; loaded: number; label: string;
  status: "queued" | "uploading" | "finishing" | "completed" | "error" | "cancelled";
  remainingSeconds?: number; error?: string;
};
type InternalTask = {
  state: UploadTask; file: File; serverId?: string; xhr?: XMLHttpRequest; startedAt: number;
  resolve: (result: UploadedFile) => void; reject: (error: Error) => void; promise: Promise<UploadedFile>;
  dismissed?: boolean; initialOffset?: number;
  onComplete?: (file: UploadedFile) => Promise<void>; result?: UploadedFile;
};
const tasks = new Map<string, InternalTask>();
const listeners = new Set<() => void>();
let snapshot: UploadTask[] = [];
const empty: UploadTask[] = [];
let running = 0;
function publish() { snapshot = [...tasks.values()].filter((task) => !task.dismissed).map((task) => ({ ...task.state })); listeners.forEach((fn) => fn()); }
export const subscribeUploads = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getUploadSnapshot = () => snapshot;
export const getServerUploadSnapshot = () => empty;
// Completed tasks remain usable after their tray row has been dismissed.
export const getUploadStatus = (id: string) => tasks.get(id)?.state.status;
export const getCompletedUploadResult = (id: string) => {
  const task = tasks.get(id);
  return task?.state.status === "completed" ? task.result : undefined;
};
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Upload failed");
  return body;
}
function chunk(task: InternalTask, offset: number) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.open("PUT", `/api/file-uploads/${task.serverId}`);
    xhr.setRequestHeader("Upload-Offset", String(offset));
    xhr.timeout = 5 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      task.state.loaded = offset + event.loaded;
      const seconds = (Date.now() - task.startedAt) / 1000;
      const speed = (task.state.loaded - (task.initialOffset || 0)) / Math.max(0.1, seconds);
      task.state.remainingSeconds = speed > 0 ? Math.ceil((task.file.size - task.state.loaded) / speed) : undefined;
      publish();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else { let message = "Upload failed"; try { message = JSON.parse(xhr.responseText).error || message; } catch {} reject(new Error(message)); }
    };
    xhr.onerror = () => reject(new Error("Connection interrupted. Retry to continue uploading."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Retry to continue uploading."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(task.file.slice(offset, offset + UPLOAD_REQUEST_BYTES));
  });
}
async function run(task: InternalTask) {
  task.state.status = "uploading"; task.state.error = undefined; publish();
  try {
    if (!task.serverId) {
      const created = await json("/api/file-uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: task.file.name, mimeType: task.file.type, size: task.file.size }) });
      task.serverId = created.id;
    }
    if ((task.state.status as string) === "cancelled") throw new Error("Upload cancelled");
    const saved = await json(`/api/file-uploads/${task.serverId}`);
    let offset = saved.offset as number;
    task.startedAt = Date.now();
    task.initialOffset = offset;
    while (offset < task.file.size) {
      if ((task.state.status as string) === "cancelled") throw new Error("Upload cancelled");
      await chunk(task, offset);
      offset = Math.min(task.file.size, offset + UPLOAD_REQUEST_BYTES);
      task.state.loaded = offset; publish();
    }
    task.state.status = "finishing"; publish();
    const result = await json(`/api/file-uploads/${task.serverId}`, { method: "POST" }) as UploadedFile;
    if ((task.state.status as string) === "cancelled") throw new Error("Upload cancelled");
    await task.onComplete?.(result);
    task.result = result; task.state.status = "completed"; task.state.remainingSeconds = 0;
    // Hide only the tray row; queued messages still need the completed result.
    const timer = setTimeout(() => dismissUpload(task.state.id), 5_000);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    task.resolve(result);
    task.file = new File([], task.state.name);
  } catch (error) {
    task.state.error = error instanceof Error ? error.message : "Upload failed";
    if ((task.state.status as string) !== "cancelled") task.state.status = "error";
    // Keep waiters pending on recoverable errors: Retry resumes the same upload.
    if ((task.state.status as string) === "cancelled") task.reject(new Error(task.state.error));
  } finally {
    task.xhr = undefined;
    if ((task.state.status as string) === "cancelled") {
      if (task.serverId) await json(`/api/file-uploads/${task.serverId}`, { method: "DELETE" }).catch(() => {});
      task.file = new File([], task.state.name);
    }
    running--; publish(); pump();
  }
}
function pump() {
  for (const task of tasks.values()) {
    if (running >= 2) break;
    if (task.state.status !== "queued") continue;
    running++; void run(task);
  }
}
export function startUpload(file: File, options: { label: string; onComplete?: (file: UploadedFile) => Promise<void> }) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Choose a non-empty file.");
  const id = createClientId();
  let resolve!: InternalTask["resolve"], reject!: InternalTask["reject"];
  const promise = new Promise<UploadedFile>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  tasks.set(id, { state: { id, name: file.name, size: file.size, loaded: 0, status: "queued", label: options.label }, file, startedAt: 0, resolve, reject, promise, onComplete: options.onComplete });
  publish(); pump(); return id;
}
export function waitForUpload(id: string): Promise<UploadedFile> {
  const task = tasks.get(id);
  return task ? task.promise : Promise.reject(new Error("Upload not found"));
}
export function retryUpload(id: string) {
  const task = tasks.get(id);
  if (!task || task.state.status !== "error") return;
  task.state.status = "queued"; publish(); pump();
}
export function cancelUpload(id: string) {
  const task = tasks.get(id);
  if (!task || ["completed", "cancelled", "finishing"].includes(task.state.status)) return;
  const wasRunning = task.state.status === "uploading";
  task.state.status = "cancelled"; task.xhr?.abort();
  if (!wasRunning) {
    if (task.serverId) void json(`/api/file-uploads/${task.serverId}`, { method: "DELETE" }).catch(() => {});
    task.file = new File([], task.state.name);
  } task.reject(new Error("Upload cancelled")); publish();
}
export function dismissUpload(id: string) {
  const task = tasks.get(id);
  if (task && ["completed", "cancelled"].includes(task.state.status)) { task.dismissed = true; publish(); }
}
