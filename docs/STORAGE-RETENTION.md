# Update storage retention

- Native server updates alternate between `.next-a` and `.next-b`. The previous slot remains available for rollback. Successful clean production builds discard only webpack/SWC compiler caches; runtime image/fetch caches and compiled assets remain. Local rebuilds can opt into compiler cache reuse with `METIS_REUSE_BUILD_CACHE=1`.
- Managed Codex/Grok/OpenCode installations retain the validated active version and the immediately preceding version. The synchronizer writes `previousVersion` into the atomic active manifest only after installation and version checks succeed.
- The standalone Linux/macOS remote-client installer prunes obsolete `releases/release.XXXXXX` directories only after the new release authenticates. It keeps the current and immediately preceding release.
- Both versioned layouts use the shared `public/install/release-retention.mjs` helper. Recently created directories (24 hours), running/referenced releases, symlinks, unrecognized/incomplete layouts, and unrelated files are not removed. No reliable process visibility means cleanup is deferred. A subsequent successful update retries deferred cleanup; the two-version bound excludes these safety exceptions.
- Per-install locks prevent concurrent invocations of these installers. A crash can leave a lock; inspect it and confirm no installer is running before manually removing it. Never steal a lock based on age alone.
- Cleanup never scans arbitrary application data, provider sessions, chats, notebooks, uploads, backups, or other applications' caches. It does not manage Electron's updater internals.
- Existing development preview directories and hand-created release artifacts on a development server require a separately reviewed cleanup. They are not representative of a normal two-slot installation.

Checks: `node --import tsx --test tests/release-retention.test.mjs tests/sync-provider-clis.test.ts tests/updater-stability.test.ts tests/remote-client-startup.test.mjs`. Unix installer fixtures use real local enrollment/WebSocket authentication but fake service managers, never live services.
