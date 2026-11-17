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

## Settings navigation

Settings categories are compact overviews, not mixed overviews and full forms. Give each independent feature a peer `SettingsTile` opening a `SettingsFeaturePane`; for example, Security → Passkeys and Security → Credential vault use the same detail-navigation pattern. Reuse the existing primitives instead of inventing another tab style. Keep built-in labels and accessibility text English.

Update `lib/settings-navigation.ts` and the pane type, section-to-pane mapping, overview tile and detail branch in `components/settings-panel.tsx` together. Preserve search/deep-link destinations, mobile category → detail → back navigation, focus return to the originating tile, and role-based visibility. Mount data-loading managers only inside their detail pane, so overview visits do not fetch or expose their data. Cover overview composition, search and desktop/mobile navigation in the existing settings regression suites.

## Skills and settings

`skills-lock.json` registers complete skill packages; keep scripts, references, and assets beside `SKILL.md`. Default activation is owned by `lib/skills.ts`. Both Cursor and alternative providers use `buildSkillContext` for per-turn skill injection. Explicit user disable and Always-on overrides must remain effective; do not rewrite users' saved preferences to apply a new default.

Register a new package with the bundled Skill Creator's `scripts/register_skill.py`, validate it with `scripts/quick_validate.py`, and include its lockfile entry. Keep development guidance match-based unless the user requests Always on. Test fresh state without borrowing the production database or credentials.

## Verify and ship within the requested scope

Run focused tests while iterating, then the required type check and production build after changes settle. Use isolated data roots, ports, and named test services for runtime checks. Do not stop live Metis services or the remote client as test cleanup.

On systemd Linux deployments, local `execute_command` and `verify_work` children can share the live MCP gateway's cgroup. Node heap settings do not raise that cgroup's memory limit. A compiler or FFmpeg child exhausting the group can trigger `OOMPolicy=stop` and disconnect every session on that gateway; a tool-wrapper timeout or detached shell is not resource isolation. Check `systemctl show` and kernel/service journals before attributing transport errors to networking.

Run memory-heavy builds, type checks and media jobs in an authorized, separately bounded transient systemd unit, with explicit working directory, resource limits and isolated test data. Preserve the caller's permitted identity and environment boundaries; do not copy production/provider secrets into test units or weaken protections. Verify `/proc/self/cgroup` inside the job differs from the gateway and that gateway PID/restart count remain unchanged. Keep normal authenticated network operations in the approved tool environment. If separate execution is unavailable, report the limit rather than stress-testing the live gateway.

For an authorized deployment, read `docs/DEPLOY.md` and the current deployment configuration. Build the inactive production slot with `scripts/build-production-slot.sh`; never overwrite the active slot. Switch only after the build succeeds. Restart only the service required by the approved deployment, preserving the worker/MCP runtime when instructed. Verify the artifact's BUILD_ID, active service, and actual HTTP response through `verify_work` before reporting deployment success.

Commit only the owned changes. Preserve the configured author and provide the direct GitHub commit link when pushing. Report what changed, what was verified, and any material limit; a refactor does not prove that unrelated instability has been resolved.
