# Security notes

Metis AI can execute tools that affect files, processes, containers, services,
and connected desktop devices. Treat a deployment as privileged infrastructure.

## Public deployment checklist

1. Set a unique `CHAT_PASSWORD` and `MCP_BEARER_TOKEN` outside Git.
2. Keep the MCP gateway bound to localhost or put it behind an authenticated,
   trusted network boundary.
3. Leave `MCP_ALLOW_REMOTE_ADMIN=false` unless remote administration is
   explicitly required and separately protected.
4. Review every registered child MCP server and its environment variables.
   Optional and remote child MCP servers are disabled by default; enable them
   explicitly with `MCP_ENABLE_OPTIONAL_SERVERS` or `MCP_ENABLE_REMOTE_SERVERS`.
5. Keep `data/`, `.env*`, chat databases, logs, and generated artifacts out of
   the repository.
6. Rotate credentials if they were ever committed, logged, or shared.
7. Before publishing a repository, scan the complete Git history, not only the
   working tree.
8. Keep the application-level login and share-password rate limits enabled, and
   add a distributed proxy/WAF rate limit for multi-instance deployments. Trust
   forwarding headers only from peers explicitly listed in
   `AI_CHAT_TRUSTED_PROXIES` (IPs/CIDRs). With no trusted proxies, the custom
   server uses the socket peer. It walks XFF right-to-left to the first untrusted
   hop and ignores X-Real-IP. Account/share budgets also span client addresses.
9. Do not rely on the legacy `x-chat-password` / `x-chat-username` headers.

Authentication failures use generic responses and are rate-limited by client
address and username. Share passwords are accepted only in request bodies;
they are never read from GET query parameters. Internal bearer tokens are
validated with fixed-length, timing-safe comparisons.

Chat ownership is assigned during SQLite migration. Authenticated chat
lookups require an explicit matching `owner_id`; ownerless legacy rows are not
available through authenticated routes.

The default MCP listener binds to `127.0.0.1`. That is a network boundary, **not
authentication**. Unauthenticated callers are rejected even on localhost.
Require `MCP_BEARER_TOKEN` or a signed Metis session. Keep
`MCP_ALLOW_REMOTE_ADMIN=false` unless remote administration is explicitly
required.

Remaining production issues are tracked in
[`docs/PRODUCTION-AUDIT.md`](./docs/PRODUCTION-AUDIT.md).

## First-run and execution isolation

Run the supported custom server (`pnpm start`). Before accepting HTTP requests
it creates a 256-bit setup token in `CHAT_DATA_DIR/setup-token` with private
operator permissions (0600 on Unix, restricted DACL on Windows). Read the file
locally and enter it in first-run setup, or configure a random
`AI_CHAT_SETUP_TOKEN` of 32–1024 characters. The token is never served or logged.
SQLite consumes it atomically with the first account. Logout revokes the current
server session; signing in rotates a presented session. Password changes revoke
all sessions for that account.

Root agents default to disabled, including root installations. Explicit
`AI_CHAT_ALLOW_ROOT_AGENTS=true` permits only Host-Admin root execution within
its root home. Install native services from a dedicated unprivileged account.
Nonadmins require unprivileged OS identities and user-owned workspaces that do
not overlap across OS identities. Linux permits group read/search at the workspace
root, but not group writes or access by others. Creation, mapping changes and
every execution reject unsafe mappings,
shared service identities, privileged groups and access to other workspaces or
service secrets/data. Unix checks effective filesystem access under the target
UID/GID, including ACLs. Existing unsafe mappings fail closed. Windows nonadmin
agent execution is blocked until restricted tokens and SID/ACL isolation can be
verified. Containers must provide separate OS identities too; a shared process
UID is not isolation.

Browser-stream WebSockets require a non-null exact allowed Origin, before cookie
authentication. Same-origin and `AI_CHAT_PUBLIC_URL` are allowed; explicit extra
origins use `AI_CHAT_BROWSER_ALLOWED_ORIGINS`. The unused `/api/process-a` route
was removed. See [fix verification](docs/SECURITY-FIXES-2026-10-09.md).
