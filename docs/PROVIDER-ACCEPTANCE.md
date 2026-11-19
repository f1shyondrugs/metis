# Provider acceptance

## What the feature establishes

Open **/provider-acceptance** on your Metis server while signed in. The console inventories every registry provider and advertised authentication path, separately for each configured connection and model. It uses cached discovery metadata without silently falling back to another account or endpoint. Unknown model capabilities remain unknown; catalog entries are explicitly unverified.

Opening the console, refreshing saved results, creating a plan or downloading a report never starts a model. Select exact targets and checks, set the logical-turn/time limits, acknowledge possible paid usage, and press **Start selected tests**. No targets or checks are preselected.

**Limits are not a dollar budget.** The limit counts submitted Metis jobs. Tool loops, SDK reconnects and the account's existing retry setting can cause additional upstream requests. Tests do not change that account setting. Begin with one model, response/persistence, and one turn.

The browser drives one idempotent step at a time. Unmounting, losing connectivity or refreshing stops further advancement; a submitted job may still finish. The persisted job carries an independent deadline, so new worker processes enforce it even after the console disconnects. The console also cancels expired and provider-reset-waiting jobs. Stop only addresses the exact recorded report/job/account. Never restart worker or gateway services to stop a test.

Test chats are private Incognito chats, outside projects, with the ordinary 24-hour expiry and restricted workspace-write runtime. The report contains synthetic evidence and IDs, not credentials, personal connection labels, raw model/tool outputs or endpoint URLs. File fixtures live in a dedicated .metis-provider-acceptance/<report>/<random> subdirectory of the account workspace. They are not automatically deleted while a provider could still be writing. Clean only a specific report's fixture directory after all its jobs have terminated; never clean the workspace or runtime.

## Automated live checks

| Check | Required evidence |
| --- | --- |
| Response | Completed worker turn, exact provider/connection/model identity, random marker in answer |
| Incremental runtime events | At least two non-empty text events before terminal event; not a browser-paint or SSE-network certificate |
| Durable answer | Matching answer and marker from a fresh canonical SQLite read, not the chat cache |
| MCP | Completed MCP read/write calls, no native tool fallback, and independently read output file with hidden nonce and correct computed sum |
| Continuation | Second turn in the same chat recalls a first-turn random marker that is not repeated |
| Vision | Actual image attachment with nine randomly chosen color squares; all colors/order must match |
| Cancellation | Generation observed running with text, cancelled through ordinary job control, worker lease released |
| Usage | Non-estimated measured input/output token counts in persisted run metadata |

A baseline turn combines response, runtime streaming, persistence and usage checks. Continuation requires a successful baseline; its prerequisite counts toward the confirmed turn limit. Other probes require a separate turn. Selection, missing credentials, timeouts, exhausted quotas, missing telemetry and depleted turn budgets never become passes. Fixture failures and submission errors are not automatically retried; uncertain submission outcomes are reconciled by stable message ID.

Interactive input, live model switching, browser actions, skills, subagents, speech/audio, UI paint and cross-account security are **not certified by this live suite**. They remain untested unless explicitly unsupported; existing contract/security tests are separate evidence. This first suite must not be described as proving universal feature support.

## Reports and honest states

- passed: the implemented verifier observed its required evidence.
- failed: an executed probe did not satisfy its verifier.
- blocked: an external prerequisite, budget, approval or execution deadline prevented proof.
- unsupported: explicit capability metadata declares the feature unavailable.
- untested: no adequate probe has been executed, including unimplemented deeper probes.

Reports include code/dependency fingerprint, model/auth/connection, check timestamp, logical-turn limits and reference IDs. JSON, Markdown and standalone HTML downloads are account-authenticated and not public share links. All dynamic report text is escaped; HTML downloads have a restrictive CSP.

The full matrix stays in the report, including unselected models and missing authentication paths. Counts are cells, not providers. A successful single model cannot certify other models. Release readiness fails closed for empty, catalog, incomplete, evidence-free, blocked, failed or untested matrices. Historical evidence belongs to its recorded revision and time, not later SDK/model changes.

## Offline checks and CI

From the repository:

    pnpm test:provider-acceptance
    pnpm acceptance:providers --out outputs/provider-acceptance
    pnpm acceptance:providers --out outputs/provider-acceptance --strict

The inventory command imports only the pure registry and report core. It does not load the database, credentials or network. --strict intentionally returns nonzero for a catalog-only report. No successful offline command proves live providers.

The main CI runs the focused acceptance tests with an isolated local provider transport. The scheduled provider-acceptance workflow produces a daily explicitly unverified catalog report with no provider secrets or paid calls. It must not be presented as daily authenticated live verification. No unbounded paid background job is installed.

## HTTP contract

All endpoints require the current user's session, scope every read/write to that account, and disable caching. POST also validates request origin.

- GET /api/providers/acceptance: matrix, revision, available automated checks and latest report; no model call.
- POST /api/providers/acceptance: {targetIds, checks, maxTurns, timeoutMs, confirmLive:true}; creates a plan only. 1–20 selected targets/turns, 15–300 seconds per turn.
- GET /api/providers/acceptance/<id>: observe existing job and report; never dispatches another job.
- POST /api/providers/acceptance/<id>: {action:"next"} dispatches at most one next step; {action:"cancel"} stops this report.
- GET /api/providers/acceptance/<id>?format=json|markdown|html: private report download.

The server stores plans and step reservations in an additive provider_acceptance_reports SQLite table. Dispatch reservations and turn accounting are transactional. Stable message IDs and a transactional pre-enqueue guard prevent concurrent clicks and Stop/submit races from authorizing duplicate work. Credentials stay in the existing encrypted provider store and are resolved only by the normal worker.
