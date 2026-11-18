---
name: metis-development
description: "Develop, debug, or refactor the Metis AI application, provider harness, MCP gateway, installers, and shared UI. Use for changes to the Metis repository; not for unrelated user projects or routine Metis tool use."
metadata:
  category: Development
  tags: "Metis, Refactoring, Runtime, MCP, Testing"
---

# Metis Development

Metis is both a public application and the runtime executing this work. Changes must work on fresh installations and preserve the active harness.

## Find the owning layer

Establish the repository root and read its `AGENTS.md`, then the relevant entry in `docs/README.md`. Inspect `git status` before editing and preserve existing unrelated changes. Use [the code map](references/code-map.md) to locate the current owner of behavior; confirm callers with scoped searches.

Provider capabilities and model metadata come from the typed provider registry and live discovery. Missing metadata stays unknown. Provider adapters use the canonical Metis MCP tool contract; do not add native file, shell, browser, task, or agent fallbacks.

## Reuse behavior, preserve contracts

Before adding a function, search for its behavior and callers, including implementations with another name. For a scoped inventory of exact function-body copies, run `node skills/manual/metis-development/scripts/find-duplicates.cjs [directory ...]` from the repository; review each candidate and its callers because equal bodies can depend on different surrounding policies. Prefer an existing canonical helper. When copies have the same semantics, move the smallest coherent behavior into a shared module and migrate the callers together. Keep differences explicit through a small typed parameter or separate domain functions; do not erase owner boundaries, defaults, error messages, or parsing limits to make code look alike.

Keep browser helpers separate from server code, and preserve the ESM boundary for standalone MCP modules. Avoid a catch-all utility file and abstractions with one-off switches. A shared API must describe the behavior it owns.

Test the observable contract before and after the refactor: authentication and account scope, malformed payloads, text ordering, cleanup on unmount, persisted settings, and fresh-install defaults as relevant. Reuse existing test suites; add focused boundary tests for behavior that could drift. Source-string checks alone cannot establish correctness.

When bundling an isolated Metis UI fixture from a staged web snapshot, use that snapshot’s `tsconfig.json` and `node_modules` for both the fixture (including React and its renderer) and the imported app components. Mixing dependencies from the canonical checkout with snapshot aliases can bundle two React instances and leave the fixture blank with a null hook dispatcher. Verify the actual rendered controls in the in-app browser with synthetic account/device state.

For Electron multi-window ownership, passive click feedback and native-coordinate verification, read [the desktop guidance](references/electron-windows-and-coordinates.md).

## Compact controls and reference appearance

The shared Button primitive defaults to `shrink-0`. Bound and explicitly shrink unpredictable model/account labels before fixed Context/Usage controls; test the actual footer parent, not only the standalone picker, and retain an operable full-value disclosure. Reference rows reuse `ReferenceResultIcon`/`ReferenceResultMetadata`, `NoteIcon` and `NotebookProjectIcon` so item glyphs and authorized project context keep their separate colors/logos.

For automation appearance, omission preserves the icon and null removes it. A one-field icon change must remain metadata-only in both editor requests and storage: do not rebuild schedules, resume completed/error tasks, or clear claims/errors. Test the outgoing request as well as the API, and verify additive-schema compatibility with old writers.

## Calendar date precision

For calendar/time-zone work, read `docs/CALENDAR.md` and reuse `lib/calendar/time-zone.ts`. Keep date-only values as date strings and use FullCalendar's offset-aware `dateStr` for clicks. New drafts shown in minute-precision inputs must be rounded to that precision: fractional milliseconds cannot round-trip through second-precision ICS and can misleadingly trigger the existing time-zone-definition mismatch error. Do not remove that export guard. When an existing local input is unchanged, retain its original ISO instant/offset to disambiguate DST fall-back times; reject nonexistent spring-forward input instead of silently shifting it. Test both cases and a real canonical API round trip.

All-day `DTEND` is exclusive: normalize a same-day timed draft to a following-date end, constrain the end picker, and keep a submit/API guard. Test start changes, leap days and valid multi-day ranges. For time-zone export, a newer bundled database can differ from runtime ICU; accept a generated definition only when both endpoints round-trip to the requested instants. Preserve matching IANA alias TZIDs and imported definitions; do not fix a mismatch by dropping its guard or silently rewriting recurrence exceptions.

## Settings navigation

Settings categories are compact overviews, not mixed overviews and full forms. Give each independent feature a peer `SettingsTile` opening a `SettingsFeaturePane`; for example, Security → Passkeys and Security → Credential vault use the same detail-navigation pattern. Reuse the existing primitives instead of inventing another tab style. Keep built-in labels and accessibility text English.

Update `lib/settings-navigation.ts` and the pane type, section-to-pane mapping, overview tile and detail branch in `components/settings-panel.tsx` together. Preserve search/deep-link destinations, mobile category → detail → back navigation, focus return to the originating tile, and role-based visibility. Mount data-loading managers only inside their detail pane, so overview visits do not fetch or expose their data. Cover overview composition, search and desktop/mobile navigation in the existing settings regression suites.

## Skills and settings

`skills-lock.json` registers complete skill packages; keep scripts, references, and assets beside `SKILL.md`. Default activation is owned by `lib/skills.ts`. Both Cursor and alternative providers use `buildSkillContext` for per-turn skill injection. Explicit user disable and Always-on overrides must remain effective; do not rewrite users' saved preferences to apply a new default.

Register a new package with the bundled Skill Creator's `scripts/register_skill.py`, validate it with `scripts/quick_validate.py`, and include its lockfile entry. Keep development guidance match-based unless the user requests Always on. Test fresh state without borrowing the production database or credentials.

## Verify and ship within the requested scope

Run focused tests while iterating, then the required type check and production build after changes settle. Use isolated data roots, ports, and named test services for runtime checks. Do not stop live Metis services or the remote client as test cleanup.

For prebuilt updater packages, test the extracted artifact with its bundled runtime, pruned dependencies and isolated HOME/data—not only the source checkout. A TypeScript Next configuration can trigger compiler installation after pruning; emit JavaScript in CI or retain an intentional runtime dependency, and verify startup leaves package/lock files unchanged. Packages nested below a bootstrap Git checkout can inherit the wrong commit identity; test a deliberately different parent checkout. On Windows, detached process groups do not escape `taskkill /T`: use an independent executor at the same verified identity/effective authority, and test that the new host survives updater exit and task cleanup. Managed launchers should name physical release paths in argv so retention can protect running versions even when cwd/exe metadata is hidden.

On systemd Linux deployments, `lib/mcp-core/resource-scope.mjs` automatically puts shared-spawn tool commands in per-invocation bounded scopes, preserving UID/groups, sanitized environment, cwd, stdin and the existing mount namespace. Manager failure must not fall back to an unbounded command. Old gateway processes retain the pre-update behavior until drained: their children can share the gateway cgroup, where a compiler or FFmpeg OOM plus `OOMPolicy=stop` disconnects every session. A Node heap flag or detached shell does not isolate that workload. Confirm the actual process version and cgroup, not only source files.

Run memory-heavy builds, type checks and media jobs in an authorized, separately bounded transient systemd unit, with explicit working directory, resource limits and isolated test data. Preserve the caller's permitted identity and environment boundaries; do not copy production/provider secrets into test units or weaken protections. Verify `/proc/self/cgroup` inside the job differs from the gateway and that gateway PID/restart count remain unchanged. Keep normal authenticated network operations in the approved tool environment. If separate execution is unavailable, report the limit rather than stress-testing the live gateway.

Staged web snapshots can retain a different canonical `AI_CHAT_INSTALL_DIR` for jobs and data. Pin server-side worker entrypoints to the actual web source revision (`AI_CHAT_SERVER_SOURCE_DIR` in the slot wrapper), and test with a deliberately different legacy install root; otherwise the new UI can silently call an older search worker. Merge the actual live wrapper rather than replacing it with Git's generic version, preserving explicit data/MCP/install-root guards.

For an authorized deployment, read `docs/DEPLOY.md` and the current deployment configuration. Build the inactive production slot with `scripts/build-production-slot.sh`; never overwrite the active slot. Switch only after the build succeeds. Restart only the service required by the approved deployment, preserving the worker/MCP runtime when instructed. Verify the artifact's BUILD_ID, active service, and actual HTTP response through `verify_work` before reporting deployment success.

Commit only the owned changes. Preserve the configured author and provide the direct GitHub commit link when pushing. Report what changed, what was verified, and any material limit; a refactor does not prove that unrelated instability has been resolved.
