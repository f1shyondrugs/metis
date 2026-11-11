# Protected MCP environment credentials

MCP connection details contain an Environment variables editor for account-owned stdio connections. GET returns variable names and configured indicators only. Password-style replacement fields start blank: blank preserves the saved value; removal is explicit. Concurrent edits use a connection revision and fail rather than overwrite a changed target.

Agents request `mcp_request_credentials({server,fields})` with an existing connection ID and environment names, never secret values. A protected chat form posts directly to the authenticated same-origin input endpoint. Only verified submission status enters the ordinary question transcript. Requests are single-use, expire after 15 minutes, and bind the owner, chat, job and full connection revision. A cancelled, expired, replaced or stopped question cannot submit. MCP configuration is durable; the form's Save encrypted credentials action explicitly persists it.

## Encryption and runtime

Environment values are AES-256-GCM envelopes using the existing configured AI_CHAT_SECRETS_KEY (never regenerate it during upgrade). The shared vault envelope binds owner plus connection ID, kind, command, arguments, cwd, URL and environment field through authenticated associated data. New values are never stored in plaintext registry JSON. Existing plaintext entries remain compatible until their next protected save, which encrypts the whole connection environment. Connection-target edits rebind preserved values after authenticated decryption.

This is account/target binding and at-rest encryption, not OS isolation from root administrators or root-capable agents. The application and gateway require their existing trusted deployment permissions. Browser/console credentials remain in their existing dedicated vault; no values are exported between these kinds.

External stdio children receive operational environment plus their configured values, not the app's whole environment. Child stderr is drained without retaining raw output, which can echo secrets. Configuration writes use a cross-process SQLite lock and atomic JSON replacement. Runtime child cache keys include the complete connection revision: active calls finish on their original transport, subsequent calls connect with the new environment. Idle cleanup skips active calls.

`credential_vault_list` includes MCP connection/field routing metadata. Browser/console-service failure returns explicit partial status rather than hiding otherwise available MCP targets.

## Noninterrupting activation

Existing HTTP MCP sessions are process-local and cannot be migrated. Start and validate a separate loopback gateway, then atomically write a private `active-endpoint.json` in the MCP state directory:

```json
{"version":1,"url":"http://127.0.0.1:8799"}
```

The native provider connection factory reads this only while constructing new connections. Existing transports keep their original URL and session. Keep the old service alive until its users finish; never flip its listening port or restart it during active jobs. Invalid or writable-by-others endpoint files fail closed. Rollback changes the pointer for future connections, not existing transports.

During mixed-version operation use the updated settings/credential path for registry changes; the legacy gateway does not participate in the new registry write lock or understand encrypted replacement values. Existing tools on the old gateway retain old child connections; reconnecting MCP credentials should use a new session on the updated gateway.

See [noninterrupting activation assessment](MCP-NONINTERRUPTING-ACTIVATION.md) for operational constraints and the staged iCloud 401/403 classification patch. Run `pnpm run test:mcp-vault` for focused regression coverage.
