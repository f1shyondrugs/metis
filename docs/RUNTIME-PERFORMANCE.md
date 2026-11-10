# Bounded runtime performance sampling

Opt-in timing for an operator-requested investigation. It is disabled unless METIS_PERFORMANCE_UNTIL is a future Unix timestamp in milliseconds no more than ten minutes away and METIS_PERFORMANCE_OUTPUT_DIR is an absolute directory. METIS_PERFORMANCE_START_AT optionally delays the observation window to exclude application startup. No public endpoint or account setting enables it.

Each process/isolate writes one mode-0600 JSON file named runtime-PID-THREAD.json atomically when its deadline is reached. Timers are unreferenced and stop automatically. Each file contains event-loop utilization, delay percentiles/max/sample count and bounded operation-level SQLite timing counters. Database timings include synchronous execution and possible lock waits, and cannot distinguish those causes. Percentile upper bounds come from fixed histogram buckets. No SQL text, bound arguments, returned rows, URLs or stack traces are stored.

SQLite is returned unchanged when disabled. During a sample, native receiver binding, return values, errors, statement configuration and iterator cleanup are preserved. Iteration measures individual next calls, excluding JavaScript work between rows. The completed sampler stops collecting; a temporary service environment override can be removed without another restart. New isolates obey the same absolute deadline. Existing worker/MCP processes need not restart for a web-process sample.

Use a temporary systemd environment drop-in for a single authorized deployment; remove the owned drop-in and reload systemd after observation. Do not read provider credentials or dump service environments. Inspect the JSON files only. A low-traffic observation establishes behavior during that window, not peak capacity. Use isolated synthetic tests for deliberate lock contention or event-loop blocking.

Tests: runtime-performance.test.ts exercises a real native SQLite connection, an actual lock timeout, iteration, disabled identity, privacy and automatic/delayed termination.
