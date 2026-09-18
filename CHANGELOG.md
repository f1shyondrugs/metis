# Changelog

All notable Metis AI releases are documented here. Release tags and GitHub
releases are created locally with `pnpm release`; GitHub Actions does not
publish releases.

## v1.0.7 — 2026-09-18

### Chat sources and Codex tools

- Keep source chips on one line and portal link previews out of the text flow so hover no longer shifts the message.
- Route Codex file edits through the Metis MCP gateway, allow Codex todo-list events, and drop the per-parent subagent child cap.

### Agent runtime and context reliability

- Fix provider-measured context compaction so it always removes enough local
  history to produce a usable recovery context and agent output continues.
- Preserve concurrent chat metadata changes, including project moves, while
  assistant streaming checkpoints are written.
- Enforce one observable Metis MCP tool surface across provider runtimes:
  disable native subagents and built-in tools in Claude, Antigravity, Grok,
  OpenCode, and AI SDK providers; disable Codex native feature gates, force its
  fallback sandbox read-only/offline, and fail closed on native tool events.
- Add provider-policy regression tests for every SDK and CLI integration.

### Projects and browser settings

- Add project avatars and explicit move/remove icons to chat project actions.
- Expose embedded-browser enablement, realtime preview, FPS, and default
  viewport controls directly under Settings → General → Browser.

### Installers, Docker, and networking

- Default Linux installs to native Node.js + systemd; use `--docker` for
  Compose. Keep Docker as the automatic macOS/Windows path when available and
  retain explicit native install flags.
- Generate `reload.sh` on Linux/macOS and `reload.ps1` on Windows so `.env`,
  port, and bind changes recreate containers instead of using an insufficient
  `docker compose restart`.
- Make published web and MCP ports consistently respect `AI_CHAT_HOST`, add
  explicit container-internal URLs, and rewrite legacy loopback endpoints for
  Docker networking.
- Add an MCP gateway healthcheck and health-based Compose ordering to stop the
  gateway restart loop and startup races.
- Extend startup waits, installer output, release assets, documentation,
  production-build typings, and release tests for every supported install path.

## v1.0.6 — 2026-09-17

- Persist composer drafts, agent-generated chat titles, and explicit-only memories.
- Let users lock chat titles so agents cannot overwrite them.
- Keep the chat view stable after completion and reconcile the sending device
  with the durable server snapshot.
- Persist automation model options, restyle the split view, and improve live
  chat plus remote editing.
- Improve browser loading, streaming rendering, and long-chat performance.
- Harden network access, production checks, native Next updates, updater health
  checks, version selection, and persisted update jobs.
- Move release publishing to the local account-based workflow; GitHub Actions
  no longer publishes releases.
- Fix context usage leaking across model/context-tier switches and start native
  sessions fresh with compacted recovery context when required.
- Fix Codex runs hanging after the last visible token.
- Preserve provider output after compaction.
- Publish Docker, Linux/macOS, Windows, native, and source installers on the
  GitHub release so each user can install the way they want.
- Print `You can change this. Add: <install-dir>/.env` under the Open URL after
  install.
- Install Chromium with native installers and let the UI install the browser
  when it is missing.

## v1.0.5 — 2026-09-12

- Improved browser loading and streaming performance.
- Kept Codex sessions from hanging after the last visible token.
- Improved updater health checks and version handling.

## v1.0.4 — 2026-09-12

- Added the versioned updater and installer release flow.
- Stabilized native Next updates and production slot replacement.

## v1.0.3 — 2026-09-12

- Improved updater and release metadata handling.
- Added safer persistence for runtime jobs and sessions.

## v1.0.2 — 2026-09-12

- Improved release versioning and installer metadata.
- Tightened production build and update checks.

## v1.0.1 — 2026-09-12

- Isolated updater tests from GitHub Actions environment variables.

## v1.0.0 — 2026-09-05

- Established the versioned release and updater pipeline.
- Added versioned Docker and native installer assets.
