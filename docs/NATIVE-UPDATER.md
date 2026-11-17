# Native updater V2

## Supported strategy

Stable server updates use prebuilt OS/architecture packages. The initial native installer still installs dependencies and builds once; it registers the stable `scripts/run-installed-service.cjs` launcher and writes `.metis-package-updates-v1` only after startup succeeds. Existing installations need this bootstrap update before using V2. Source/development checkouts retain the old explicit commit update path; an activated package installation must use stable packages or a separate source checkout, not mix Git resets with a package pointer.

The desktop keeps electron-updater 6. No Velopack/MSIX migration is performed.

Windows server updates use an on-demand Task Scheduler action so stopping the old host's process tree cannot kill its updater. The task uses the current SID and already-effective elevation only; normal interactive accounts are never upgraded to Administrator. Built-in service identities retain their own identity. A custom non-interactive service account must use an operator-managed update task rather than borrowing credentials or silently changing logon rights. On Linux, managing existing system services still requires the OS authority configured by the installer; this change does not create a privileged helper or grant sudo rights.

## Server transaction

1. Resolve the exact published tag and platform asset through GitHub. Require HTTPS and a matching GitHub SHA256 digest or exact checksum sidecar. Retry transient interrupted downloads, never bad checksums.
2. Stage under `INSTALL_DIR/.metis-releases`. Bound archive bytes/entry count and reject traversal, escaping symlinks, duplicate entries and special files. Verify manifest, build ID, Node major and native node-pty loading before stopping any service.
3. Stop only this installation's named app/worker/MCP services. Save a consistent SQLite backup at `DATA_DIR/metis-pre-update.sqlite` (one replaced snapshot, not an unbounded archive).
4. Atomically replace `.metis-release.json`, start the named services and verify app/worker/gateway health, actual served release identity and browser assets.
5. On failure restore the old code pointer, restart and verify rollback. A durable transaction journal recovers interrupted activation on the next attempt. An unprovably stale lock is never stolen. Keep the active and previous release; referenced/recent versions are deferred by the shared retention helper.

The package's Next configuration is emitted as JavaScript in CI before pruning development tools. It does not ship a TypeScript Next configuration that could trigger a compiler installation on the host; the packaged startup smoke test also checks that package/lock files remain unchanged.

The old source installation remains untouched as the first rollback target. Application data and `.env` stay outside package releases. Code rollback does not blindly restore user data: the SQLite snapshot is preserved for explicit recovery if a migration makes old code incompatible. Rollback failure is reported as recovery-required, never success.

Native package CI builds linux-x64, linux-arm64, darwin-arm64, darwin-x64 and win32-x64 with their own native dependencies and Node 22. Releases remain drafts until every platform package verifies. Linux x64 uses Ubuntu 22.04; ARM uses Ubuntu 24.04. Older libc/OS versions can fail native preflight without touching services. Windows CI uses a hoisted dependency layout to avoid requiring Developer Mode for package symlinks.

## Diagnostics

Host administrators can download a bounded, allowlisted phase/error report from `GET /api/admin/system/update/logs?download=diagnostics`. Authentication and Host-Admin checks remain mandatory. The report excludes raw installer output, configuration, credentials, URLs and account data.

Desktop tray actions provide Check for updates, Install downloaded update and Export update diagnostics. Update checks/downloads coalesce, transient downloads retry at most twice, and integrity/permission/disk errors stop immediately. Installation occurs only after the shared Quit coordinator drains the owned background processes; hidden windows do not count as Quit. The downloaded installer remains managed by electron-updater.

## Verification boundaries

Run package transaction/security tests, existing native installer tests, the desktop controller/quit tests and genuine isolated Electron smoke tests. Then run TypeScript and a bounded production build. The five-OS CI matrix and real Windows/macOS installation upgrades must pass before calling a release cross-platform verified. Local Linux fixtures are not proof of native Windows/macOS installer success.
