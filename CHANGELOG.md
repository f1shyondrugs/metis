# Changelog

All notable Metis AI releases are documented here. Release tags and GitHub
releases are created locally with `pnpm release`; GitHub Actions does not
publish releases.

## v1.0.22 — 2026-11-02

- Transfer voice recordings in 512 KiB chunks through the existing authenticated upload API, avoiding HTTP 413 responses from reverse proxies for large recordings.
- Transcribe the complete reassembled recording while preserving the existing 250 MiB limit, audio validation, account isolation and provider segmentation.
- Remove temporary uploads after transcription or upload failures and retain the recording for retry.

## v1.0.21 — 2026-10-28

- Distribute native installers only for Linux, macOS and Windows. Remove the container installer, image build/publishing pipeline and installation instructions.
- Reject removed installation options and protect existing container installations from automatic conversion. Existing runtime detection and uninstall support remain available.

## v1.0.20 — 2026-10-28

- Set a custom Codex context window in the model options menu, with compact K/M labels and an Apply confirmation. Pass validated context and compaction settings to new and resumed Codex turns without changing the user's global Codex configuration; model and account limits still apply.
- Keep reference searches responsive with background workers, a persistent normalized file index, bounded requests, cancellation and account/project access checks.
- Insert note, canvas and plan references as Markdown links from the shared editor, restore internal link previews and Ctrl/Cmd-click navigation, and distinguish slash-menu actions with separate icons.
- Edit note icons and upload banner images from the document toolbar while preserving draft and save-conflict handling.
- Order issue board columns as Backlog, Todo, In Progress, Done and Canceled.
- Forward Antigravity reasoning parameters only when the provider explicitly advertises them, and validate saved parameters against the discovered model contract.
- Improve chat submission, history loading, notification polling and remote-device presence with background processing and bounded persistence work.
- Match tool details, provider retry controls and automation interfaces to the selected theme.

## v1.0.19 — 2026-10-24 (updated 2026-10-26)

- Introduce Notebooks with separate project and No Project file trees, nested Markdown documents, and migration of existing note hierarchies.
- Add Issuebooks with issue documents, statuses, priorities, assignees, relations, comments, and agent tools for managing issues.
- Unify Markdown editing across notebooks, plans, canvases and workspace files with a block editor, attachment support, and draft recovery.
- Import and export notebook archives, duplicate or move documents, and open notes directly from tool results and internal links.
- Improve chat search responsiveness with indexed background search, and streamline the command palette, grouped tool details and browser progress feedback.
- Save theme selection and custom JSON themes per account, with import/export and synchronization between sessions.
- Organize Settings into compact category overviews and detail pages, with a dedicated mobile main menu and Website/GitHub links at its bottom.
- Add optional automatic provider-error retries with up to three attempts and expandable error details, while preserving provider-limit waiting and cancellation.
- Let agents move chats between existing projects through account-scoped tools.
- Improve local Ollama discovery, provider-account model selection, browser stream cleanup, and memory-aware installer builds.

## v1.0.18 — 2026-10-21

- Open large chats through indexed message and activity pages, load tool results and subagent histories on demand, and keep unrelated requests responsive during legacy history preparation.
- Speed up note pinning with batched metadata reads, changed-only writes, inherited global pins and a searchable chat picker with fifty choices per page.
- Collect server metrics in the background, retain fifteen minutes across restarts, and add detailed tooltips and one-, five- and fifteen-minute chart ranges.
- Review, edit and reorder Deep Research plan steps before approval, then receive the completed report as an attached file.
- Render inline source badges and Lucide chat icons consistently during streaming, including aligned wrapped text after leading icons.
- Keep durable global memory guidance consistent across providers and distinguish project message authors.
- Bound updater log decoding, retained output and legacy update history to avoid loading complete logs into memory.
- Capture and preserve file-edit snapshots across gateway and remote-client execution for accurate diffs and rollback.

## v1.0.17 — 2026-10-20

- Open recorded file changes directly in the workspace diff editor, switch between edits, and open the current original file while preserving unsaved drafts.
- Add a Deep Research mode with source search, opening, finding and auditing tools, plus a composer shortcut for switching modes.
- Search references without loading full chat histories, cache bounded chat snapshots, and defer new worker jobs when host or cgroup memory is constrained.
- Keep actionable account notifications synchronized with jobs and project invitations, and enable remote-device notifications by default while respecting saved preferences.
- Consolidate UI guidance on UI UX Pro Max and exclude local skill installations and MCP configuration from new Git additions.

## v1.0.15 — 2026-10-19

- Invite users to shared projects, manage members and invitations, and use an account notification inbox with unread indicators while keeping provider, model and mode settings private. Automatic run-completed alerts no longer appear in that inbox.
- Show edited files above the composer only while a reply is running, then keep them under the completed reply. Improve mobile note grids and preserve existing file navigation.
- Preview internal chats, projects, notes and workspace links consistently from chat and workspace content.
- Configure account attachment limits and keep background and queued uploads consistent with those settings.
- Allow multiple Metis accounts to share an OS user and support `/` as an administrator workspace without changing the filesystem root's ownership.
- Show Logout in the account menu, project members' display names and avatars, and the actual target MCP server in tool badges.
- Refresh file trees and searches automatically while preserving unsaved editor changes. Preview media, Markdown and sandboxed HTML in the file editor, and inspect each recorded edit in an inline diff.
- Restore clickable response suggestions across providers with shared prompt guidance, streaming delivery and persistence.
- Let agent file attachments use the available message width on mobile, tablet and desktop.

## v1.0.14 — 2026-10-13 (updated 2026-10-16)

- Search workspace file names and contents, export notes, plans and canvases as Markdown, plain text or PDF, and download workspace files.
- Synchronize editor content with external changes, preserve unsaved drafts, detect save conflicts, search within files and highlight agent edits with links to affected lines.
- Improve streamed text and Markdown animations, chat activity indicators, browser frame feedback and tool-call details, while respecting reduced-motion settings.
- Preserve queued attachments across chat switches and isolate pending uploads and cached messages by chat.
- Configure Remote Client notifications globally and per device, control agent-finished alerts, and expose delivery status through the notify tool while retaining compatibility with customnotify.
- Recover saved form answers when a provider stream ends, prevent duplicate continuations, and allow custom responses in choice fields.
- Improve Project Hub and agent-team loading, caching and error recovery; normalize Google and Vertex tool schemas for provider compatibility.
- Keep Ask user forms connected beyond the default five-minute HTTP limit and preserve submitted answers for safe recovery after a provider disconnect, without starting duplicate runs.
- Choose an optional default model and model parameters for projects and enforce the selection across project chats, team agents and queued runs, while keeping agent modes independent.
- Open the recipient agent chat from handoff cards, move prompt and reply details into a three-dot menu, and display the assigned prompt as a normal user message in the recipient chat.
- Show the queued message count next to sidebar chat actions on hover or keyboard focus, including project agent chats, with immediate updates in the active chat.
- Pick custom project colors with a color picker or HEX input and search all 2,007 Lucide icons while preserving existing icons and uploaded logos.
- Require valid worker run leases for internal tools, forward job and lease credentials to remote devices, enforce remote approval policies and validate legacy file-operation fallbacks.
- Keep the current Skill Library view after installations and imports, and bundle Word, PDF, PowerPoint and spreadsheet skills.

## v1.0.13 — 2026-10-11

- Add Agent Hub for managing skills, connections, modes and rules, including a bundled Skill Creator, skills.sh discovery and share links for importing personal skill packages.
- Open Settings and Agent Hub as account pages, add settings search, and introduce profiles with custom handles and animated avatars plus private usage dashboards and configurable API-value estimates.
- Unify scoped memories across tools and workspaces, support typed interactive forms, and keep agents paused until a requested answer is submitted.
- Improve automation creation, note editing, file references, notifications, chat continuity and loading older messages without losing the reading position.
- Add per-user agent runtime limits and scoped stop controls, improve execution isolation and streaming, and reload the interface once after a verified successful installer update.

## v1.0.12 — 2026-10-08

- Restore the rotating disclosure arrow on grouped activity summaries such as commands, files and edits so their expand/collapse action stays visible.
- Keep individual tool details in consistent popovers without disclosure arrows.

## v1.0.11 — 2026-10-08

- Manage project memories in a dedicated modal and control global memory access with “Include global memory”; project-only agents cannot read or write global memories.
- Keep the current task list visible above chat, with static dots for active tasks and checkmarks for completed tasks.
- Open file, edit, terminal and other tool details in consistent popovers; remove rotating disclosure arrows from tool rows and activity groups.
- Animate running, queued and waiting statuses across chats and agent teams, while respecting reduced-motion preferences.
- Protect note edits with serialized saves, draft recovery and explicit conflict resolution.
- Improve long-chat responsiveness and synchronize project team statuses.
- Pin release installers to the selected version, verify checksums and release manifests, and test an isolated Docker stack without touching live installations.

## v1.0.10 — 2026-10-06

- Add scratchpad notes with movable, resizable text, image and file cards, plus paste and full-area drag-and-drop support.
- Support uploads up to 1 GiB with progress, estimated remaining time, retry and cancellation; continue uploads while switching chats or workspaces.
- Share file embeds across chat, notes, plans and canvas: playable video and audio, images, PDFs, text and JSON previews, editable workspace content and removable attachments.
- Stream media with range requests for playback and seeking, and move note attachments into the top toolbar.
- Keep the composer mounted while the first message appears to preserve the caret and scroll position.
- Add device-local microphone selection and a per-account transcription dictionary.
- Keep automatically captured task context scoped to chats; save global memories only through explicit memory actions, and improve memory tool feedback.
- Refresh the Metis wordmark and favicon.

## v1.0.9 — 2026-09-21

- Stabilize voice recording by keeping waveform callbacks consistent across renders.
- Start the login form with an empty username and add an accessible password visibility toggle.

## v1.0.8 — 2026-09-20

- Insert voice transcripts into the focused mobile composer instead of dropping them after transcription.
- Paint the recording waveform outside React so chat messages do not re-render at 60fps.
- Cap client chat snapshots at 8 and skip cache writes while a run is streaming.

## v1.0.7 — 2026-09-20

- Keep interleaved text between tool groups in chat instead of collapsing every
  tool call to the bottom of the message.
- Type `docker-urls` so the production build can import it.
- Default the Linux installer to native systemd; use `--docker` for Compose.
- Expose the sidebar browser settings (workspace, realtime, FPS, viewport) on
  Settings → General.
- Fix Docker so `.env` bind/host changes apply, stop the MCP restart loop, and
  add `reload.sh` (`reload.ps1` on Windows) because `docker compose restart`
  does not recreate published ports.

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
