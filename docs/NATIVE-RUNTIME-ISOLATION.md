# Native runtime isolation on Linux

With the operator setting `METIS_NATIVE_ISOLATION=1`, native Codex, Claude,
Cursor, ACP and Antigravity execution crosses a positive-list Bubblewrap boundary.
The default is off so existing installations and upgrades retain their usable
workspaces and provider sessions. Operators who keep root execution can configure
credential services with `METIS_PROTECTED_LOGIN_MODE=trusted-root`; see
[Protected logins](PROTECTED-LOGINS.md). Credential services require either that
explicit trusted mode or native isolation. Enabling isolation requires the full
deployment below; a
failed isolated launch never falls back to legacy execution. Cursor's SDK runs in a separate stdio host,
including its local executor; wrapping only a Cursor CLI would leave that
executor inside the worker.

Each authenticated Metis owner has a separate home below
`CHAT_DATA_DIR/native-runtime/<owner>`. Only the configured workspace, that home
and explicitly owner-bound provider session directories are writable mounts.
Dependencies, selected managed runtime artifacts and launcher code are read-only.
App data, other owners' homes, credential databases, broker sockets and the
worker's global home are absent. Private PID/proc, closed inherited descriptors,
no capabilities and `NoNewPrivileges` prevent reaching the privileged parent.
Native children receive operational environment values plus their own adapter's
credentials and signed MCP session token; application master secrets stay out.

The seccomp filter rejects stream listeners, accept and io_uring. Outbound API,
DNS and signed HTTP MCP clients remain available. Native tool calls require the
signed HTTP gateway; there is no stdio fallback carrying the app environment.
Missing namespaces or unsafe mount configuration fail closed.

Native events cannot ask the parent to read a claimed edited path. File diffs
and Revert require gateway receipts bound to owner, chat and job. Upload reads,
downloads, auth refreshes and rollback writes use directory descriptors and
`O_NOFOLLOW` on Linux. This closes the separate confused-deputy path where a
native process creates a symlink to a file it cannot read itself. Worker-owned
files with multiple hardlinks inside writable mounts are rejected; silently
copying them would preserve a preexisting disclosure.

When gateway and worker use different UIDs and state roots, configure the same
`AI_CHAT_FILE_SNAPSHOT_DIR` for app, worker and gateway. Provision only that
dedicated directory with gateway ownership, the app/worker group and mode
`2770`; new receipts use `0640`. Grant the units write access to this directory,
not to each other's private state. The native namespace explicitly excludes it.
This preserves canonical file diffs without restoring privileged path reads.

Prerequisites: unprivileged Linux user namespaces, `/usr/bin/bwrap`, isolated
immutable release code, and host `fs.protected_hardlinks=1`. The deployment host
app and worker also need `services/native-runtime/systemd.conf` installed as a
late systemd drop-in. `ProcSubset=pid` hides the overflow UID/GID files required
by Bubblewrap; `ProcSubset=all` exposes those files to the trusted launcher while
`ProtectProc=invisible`, read-only kernel tunables and the child's private PID
namespace remain active. Test the complete production unit hardening together.
Verify the host sysctl as an operator; unprivileged services may not be able to
read it. Root operators and intentionally shared workspaces remain trusted:
assigning several accounts the same OS workspace shares those project files.
Private runtime homes and managed credentials remain owner-scoped. This change
does not claim an OS boundary on macOS or Windows.

Validation:

- `tests/native-runtime.test.ts`: actual namespace against same-UID foreign
  files, parent proc, app data, environment and a preexisting hardlink.
- `tests/native-runtime-launcher.test.py`: real filesystem/proc/network and
  mount-policy probes, runnable as root with an unprivileged test child.
- `tests/cursor-runtime.test.ts`: early progress, stream disposal, independent
  completion, cancellation, structured errors and bounded stdout.
- `tests/safe-file-read.test.ts` and `tests/native-file-receipts.test.ts`:
  symlink, pinned-inode, untrusted path and owner/chat/job receipt regressions.
- Existing browser, console and credential-owner tests remain applicable.

Keep legacy provider state intact during rollout. Existing Codex/Antigravity
owner-scoped session directories continue to be mounted individually. Never
copy a global Cursor or Claude history into every owner's new home.
