# CPU utilization and parallelism

Metis is not confined to one CPU. Each Node.js isolate executes ordinary JavaScript on one event-loop thread, while worker threads, child processes and native libraries can run on other logical CPUs. Async I/O concurrency alone does not parallelize CPU-bound JavaScript.

## Observed deployment, 10 November 2026

A read-only 10.01-second sample of Linux counters found 8 logical CPUs, 1.31% aggregate busy time and 0% steal time. The web process used 7.09% of one logical CPU (100% here means one fully occupied logical CPU). The application, durable worker and MCP units had no configured CPU quota or CPU affinity. These are a short, lightly loaded snapshot, not a peak-load profile or evidence of a current CPU bottleneck. Virtual CPU topology does not establish dedicated physical capacity.

The measurement used only /proc counters and cgroup membership. It did not inspect chats, credentials or process arguments, generate user traffic, or change production configuration.

## Existing parallel execution

- [worker.ts](../worker.ts) starts each admitted job as a separate worker-job.ts child process. Admission considers concurrency and RAM; increasing its limit alone does not make an individual agent step compute in parallel.
- [chat-search.ts](../lib/chat-search.ts) and [reference-search-server.ts](../lib/reference-search-server.ts) move searches to bounded worker threads. Reference indexing has another thread.
- [chat-page-loader.ts](../lib/chat-page-loader.ts) uses one bounded serial worker for submission writes, patches and legacy history preparation. Serialization protects memory and ordering but can make independent operations wait for each other.
- Notification observation and remote presence also have dedicated threads. Browser/provider processes run separately. Thread counts include runtime/native housekeeping and should not be read as the number of parallel JavaScript workers.
- [sqlite.ts](../lib/sqlite.ts) uses synchronous DatabaseSync with WAL and a 10-second busy timeout. Calling a blocking statement from the web thread can delay unrelated requests; SQLite still serializes writers across processes.
- [db-store.ts](../lib/db-store.ts) retains synchronous full-chat reads and JSON handling alongside the newer indexed/paged paths. Remaining callers need profiling before deciding which ones to move.

## Recommended order

| Priority | Change | Validation and constraints |
| --- | --- | --- |
| 1 | Measure web event-loop delay/utilization and request p95, worker queue time and SQLite lock wait under representative isolated concurrent usage. | A busy logical CPU can migrate between cores. Host-wide core charts alone cannot attribute its cause to Metis or prove event-loop saturation. Avoid collecting user payloads. |
| 2 | Offload measured CPU-heavy request paths and independent read-only work to a small, bounded pool, initially 2 workers on this 8-vCPU host; compare 2 and 4. | Reuse the existing worker module loader, preserve account checks, cancellation, deadlines and memory caps. Keep ordered writes and per-chat operations serial. Separate read-only work from slow backfills before increasing concurrency. Measure p95 and RAM; do not just maximize CPU usage. |
| 3 | Consider multiple web processes only after process-local state and connection ownership have a supported sharing/routing design. | WebSockets, presence, browser sessions and protected-login broker identity cannot simply be duplicated. SQLite write contention remains. A database change is warranted only if measured lock/write pressure persists after reducing work and shortening transactions. |

Do not start with a blanket cluster/PM2 replica count, UV_THREADPOOL_SIZE, or Promise.all around synchronous loops. Those changes do not automatically parallelize application JavaScript or resolve database locks.

## Monitor implementation

The existing five-second sampler reads aggregate and per-logical-CPU counters together from /proc/stat. Guest time is already included in user/nice and is not counted twice. Core IDs remain stable when reordered or hotplugged; a new/reset/unchanged interval is unknown until there is a usable delta. A selected core uses the existing 1/5/15-minute history chart and gaps stay gaps. The view labels these as logical CPUs and host-wide utilization, not Metis-only load.

Old saved samples without cpuCores remain valid. Current unavailable or initial readings have explicit states. Up to 1,024 cores are accepted; restart history remains size-bounded at 16 MiB and time-bounded at 15 minutes. No new polling loop, process enumeration or database write was added to the production sampler.

Verification: tests/server-cpu.test.ts, tests/server-monitor.test.tsx and the actual-component tests/server-monitor.browser.tsx fixture. Browser telemetry is synthetic; CPU analysis uses a separate read-only live snapshot. This change does not apply the proposed runtime scaling or deploy itself.
