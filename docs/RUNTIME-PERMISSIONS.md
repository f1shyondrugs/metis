# Runtime permission changes

Agent mode (Agent / Plan / Ask / custom modes) and runtime permissions are independent.
The existing `request_mode_change({modeId, reason})` controls the former.
`request_runtime_mode_change({runtimeMode, reason})` requests one of:

| ID | Runtime approval behavior |
| --- | --- |
| approval-required | Confirm file writes and terminal commands |
| auto-accept-edits | Accept file writes; confirm commands |
| auto | Automatic writes/commands within the configured workspace |
| full-access | No runtime approval prompts; other security policies still apply |

The new tool opens the normal in-chat form, with server-generated current/target
labels, the requested reason, and Accept / Keep current permissions. There is no
default approval. Only a submitted exact typed approval applies the captured
target. Denial, custom prose, dismissal, disconnect, stopped/expired leases and
stale forms do not elevate. The endpoint uses the persisted run owner/chat and
lease, rejects automation/delegated requests, and changes only this chat's
`runtimeMode`. It never widens capability manifests or Remote Device policy.

The authenticated user-input gate refreshes runtime policy on every subsequent
tool call, so fresh HTTP/stdio sessions cannot retain stale permissions from a
signed token. Native provider sandbox settings refresh on the next provider run;
canonical gateway approvals change during the current run.

## Host tool rules

Host administrators can open **Settings → Admin → Security & permissions** to
inherit existing rules, require one-time approval, or block two groups of
first-party tools: terminal/services (`execute_command`, `service_control`,
`verify_work`) and file changes (`write_file`, `edit_file`, `delete_file`).
This includes remote targets of those exact tools, but does not administer
native processes, interactive remote terminals, third-party MCPs, or operator
sessions outside a Metis run. It is not an OS sandbox.

Both groups initially inherit. The server checks the admin's account role and
request origin on writes, rejects stale revisions, and stores the policy in the
existing server database. A lease-authorized gateway reads it before dispatch.
Blocking never broadens mode or capability rules. Host-required approval ignores
standing chat grants, applies to one exact action, and is rejected in unattended
automations. A revision change while an action awaits approval requires a retry.
Existing OS and Remote Device permissions still apply.

Ship the updated app and participating gateways together before enabling a rule.
Older gateways that use the user-answer gate are rejected while a non-default
policy is configured. No server restart is needed to change a rule once the
matching app and gateways are installed. Settings do not modify `.env`,
systemd, or any existing user's saved runtime mode.

## Codex boundary

Codex's `approvalPolicy: "never"` avoids a second interactive provider approval
system, but alone rejects non-read-only MCP tools under workspace-write.
Only the first-party Metis MCP server is configured with
`default_tools_approval_mode: "approve"`; Metis still enforces all actual
runtime/mode/capability/account approvals. Do not mark writes as read-only or
extend this delegation to arbitrary third-party MCPs.

## Verification and activation

- `tests/runtime-permission-change.test.ts`: all levels, confirmation/denial,
  custom answers, cancellation, ownership, stale choices, Stop and fresh contexts.
- `tests/codex-mcp-approval.test.ts`: a real Codex CLI and local synthetic
  Responses/MCP servers reproduce the old failure and verify all four mappings.
  No real model request, credentials or production data are used.
- Existing runtime-mode, user-question, capability and provider tests remain relevant.

Shipping requires the normal web/worker/gateway rollout: existing processes do
not acquire new tool definitions or prompts merely because source files changed.
Do not restart live Metis services as test cleanup.
