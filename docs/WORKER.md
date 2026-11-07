# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`. Jobs and checkpoints
live under `CHAT_DATA_DIR` (default: `data/`). The worker processes up to 25
jobs in parallel at most (`AI_CHAT_WORKER_CONCURRENCY`). Actual admission also respects
available host RAM and the worker's cgroup memory limits, reserving headroom for
the application and OS. Newly started jobs reserve memory for 30 seconds before actual cgroup usage
replaces that estimate, so waiting parent agents leave headroom for children;
under pressure, queued jobs wait and existing agents keep running. Optional
`AI_CHAT_WORKER_MEMORY_PER_JOB_MB` overrides the adaptive per-job reservation
(default at most 1 GiB, scaled down on smaller installations). These reservations
are admission estimates, not per-job hard limits; systemd MemoryMax remains the
last protection against a growing job. The worker also recovers stale
`running` jobs after a process restart.

The worker uses the per-user Cursor SDK connections from Settings → Providers,
the same `CHAT_DATA_DIR`, and the agent workspace settings used by the web
service. Run it manually with:

```sh
node node_modules/tsx/dist/cli.mjs worker.ts
```

Production is a systemd unit (`metis-ai-worker`). **Do not stop or restart it**
as a side effect of a test, sandbox, or docs change. Restart only when the
operator explicitly asks.

## Recovery (current)

Stale `running` jobs are reaped with a **15-minute cutoff** and lease-based
`reapExpiredJobLeases` (BUG-C5). Do not reintroduce “requeue every running job”.

One interactive slot is reserved so heavy browser/MCP jobs cannot take the
whole pool. Jobs use priority classes: interactive `100`, interactive-heavy `60`
(parent/subagent or browser-ish mode), background `10`. The reserved slot skips
heavy and background work (BUG-C3).

Automatic subagent lifecycle reviews run only in delegated chats and registered
project-agent chats. Normal user chats, including project chats in Agent mode,
do not receive synthetic review prompts.

`reconcileSubagentParent` appends the lifecycle-review message with
`appendMessageInTransaction` inside the enqueue transaction. `transaction()`
nests with SAVEPOINT so a nested writer cannot fatal-exit the worker.
## Model switches, provider waits and error retries

Settings → Agent → Settings keeps provider reset waits enabled by default. When
an exhausted provider window includes a real future reset time, the same job is
queued until that time and releases its worker slot. Its saved provider session
and checkpoint are retained. Stop cancels the waiting job. An unknown reset time
never becomes an assumed five-hour wait.

Automatic retries for run errors are a separate setting, disabled by default.
When enabled, any failed run attempt, including unknown SDK errors and interrupted
Codex reconnects, gets at most three additional attempts. The count persists;
cleanup, the worker lease, runtime budget and Stop remain effective. A known
future provider reset takes the durable wait path first. SDK reconnect notices
can recover in their original stream; an EOF without turn.completed is an error.

Model switches use the latest accepted selection even when cancellation throws
or the old stream finishes before its polling watcher runs. The next attempt
uses the selected model and saved task/checkpoint. Switching a model during a
provider wait releases the previous selection's reset wait.

Switches, retries and provider waits appear in the transcript as matching
collapsible dividers. Their details preserve the previous/new model identities,
error or actual reset timestamp. No synthetic user message is inserted.

## RAM waiting and manual continuation

When RAM admission pauses a queued job, its chat shows **High RAM usage, waiting…**.
**Continue anyways** skips RAM admission for that one queued run. The request is
authenticated and bound to the run owner and job ID. It does not bypass worker
concurrency, leases, per-chat exclusivity, provider reset waits, or systemd memory
limits. The acknowledgement is consumed when the worker claims the run; follow-up
runs and subsequent attempts require a new choice if they wait for RAM again.
The ordinary queue resumes automatically when memory becomes available.

## Resource limits

The Linux systemd templates provide `MemoryHigh`, `MemoryMax`, and `TasksMax`.
Older or custom units can lack these limits; check the actual deployment with
`systemctl show <service> -p MemoryHigh -p MemoryMax -p TasksMax` rather than
assuming the template is active. Worker admission uses the limits actually
applied to its cgroup, including ancestor limits. Budget shared application,
worker, gateway/command, and unrelated server workloads together.

Full chat copies are capped per process at 8 entries / 64 MiB of estimated
snapshot memory. Indexed page previews replace the full-history page cache;
HTTP reads transfer only the selected preview rows. Oversized copies are not
cached, and evicted history remains available from the durable store. Large
legacy histories are prepared by one bounded background thread. See
[LONG-CHAT-PERFORMANCE.md](./LONG-CHAT-PERFORMANCE.md) for the migration and
performance evidence.
