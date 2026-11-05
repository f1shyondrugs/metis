"use client";
import { useState, useSyncExternalStore } from "react";
import { Check, X, RotateCcw, Loader2, ChevronDown } from "lucide-react";
import { subscribeUploads, getUploadSnapshot, getServerUploadSnapshot, cancelUpload, retryUpload, dismissUpload, type UploadTask } from "@/lib/background-uploads";
import { formatFileBytes } from "@/lib/upload-limits";
function description(task: UploadTask) {
  if (task.status === "completed") return "Uploaded";
  if (task.status === "cancelled") return "Cancelled";
  if (task.status === "error") return task.error || "Upload failed";
  if (task.status === "queued") return "Waiting…";
  if (task.status === "finishing") return "Saving…";
  const remaining = task.remainingSeconds;
  const eta = remaining === undefined ? "Calculating time…" : remaining < 60 ? `About ${Math.max(1, remaining)}s left` : `About ${Math.ceil(remaining / 60)} min left`;
  return `${Math.floor(task.loaded / task.size * 100)}% · ${eta}`;
}
function TaskProgress({ task }: { task: UploadTask }) {
  return <div className="min-w-0">
    <p className={`truncate text-[10px] ${task.status === "error" ? "text-destructive" : "text-muted-foreground"}`} title={description(task)}>{description(task)}</p>
    {!["completed", "cancelled"].includes(task.status) && <progress aria-label={`Uploading ${task.name}`} value={task.loaded} max={task.size} className="mt-1 block h-1 w-full accent-primary" />}
  </div>;
}
export function UploadProgress({ taskId }: { taskId?: string }) {
  const tasks = useSyncExternalStore(subscribeUploads, getUploadSnapshot, getServerUploadSnapshot);
  const task = tasks.find((task) => task.id === taskId);
  return task ? <TaskProgress task={task} /> : null;
}
export function UploadTray() {
  const [collapsed, setCollapsed] = useState(false);
  const tasks = useSyncExternalStore(subscribeUploads, getUploadSnapshot, getServerUploadSnapshot);
  const [hiddenTasks, setHiddenTasks] = useState<Set<string>>(() => new Set());
  if (!tasks.length || tasks.every(task => hiddenTasks.has(task.id))) return null;
  return <aside data-swipe-ignore aria-label="Background uploads" className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-[85] w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-background shadow-lg sm:top-auto sm:right-4 sm:bottom-24">
    <div className="flex items-center border-b border-border">
    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-secondary/50" aria-expanded={!collapsed} aria-label={collapsed ? "Expand uploads" : "Collapse uploads"} onClick={() => setCollapsed((value) => !value)}>
      <span className="text-xs font-medium">Uploads · {tasks.length}</span>
      <span className="text-[10px] text-muted-foreground">{tasks.some((task) => ["queued", "uploading", "finishing"].includes(task.status)) ? "Uploading in background" : "Uploads finished"}</span>
      <ChevronDown className={`size-3.5 shrink-0 ${collapsed ? "-rotate-90" : ""}`} />
    </button>
    <button type="button" aria-label="Close uploads" title="Hide upload queue" className="flex size-11 shrink-0 items-center justify-center rounded hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setHiddenTasks(new Set(tasks.map(task => task.id)))}><X className="size-4" aria-hidden="true" /></button>
    </div>
    {!collapsed && <div className="max-h-[min(16rem,50dvh)] overflow-y-auto">
      {tasks.map((task) => <div key={task.id} className="flex items-start gap-2 border-b border-border/50 px-3 py-2 last:border-0">
        {task.status === "completed" ? <Check className="mt-1 size-4 text-primary" /> : <Loader2 className={`mt-1 size-4 shrink-0 text-muted-foreground ${["uploading", "finishing"].includes(task.status) ? "animate-spin" : ""}`} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={task.name}>{task.name}</p>
          <p className="mb-1 truncate text-[10px] text-muted-foreground">{task.label} · {formatFileBytes(task.size)}</p>
          <TaskProgress task={task} />
        </div>
        {task.status === "error" && <button type="button" className="rounded p-1 hover:bg-secondary" aria-label={`Retry ${task.name}`} onClick={() => retryUpload(task.id)}><RotateCcw className="size-3.5" /></button>}
        <button type="button" disabled={task.status === "finishing"} className="rounded p-1 hover:bg-secondary disabled:opacity-40" aria-label={`${["completed", "cancelled"].includes(task.status) ? "Dismiss" : "Cancel"} ${task.name}`} onClick={() => ["completed", "cancelled"].includes(task.status) ? dismissUpload(task.id) : cancelUpload(task.id)}><X className="size-3.5" /></button>
      </div>)}
    </div>}
  </aside>;
}
