# Metis AI deployment notes

Keep deployment-specific URLs, credentials, host paths, and tokens **outside**
the repository. Use the private deployment environment to provide:

- `AI_CHAT_SECRETS_KEY`
- `CHAT_PASSWORD`
- `MCP_BEARER_TOKEN`
- `AI_CHAT_ROOT`
- `AI_CHAT_MCP_STATE_DIR`
- `AGENT_CWD`

Cursor credentials are configured per user in Settings → Providers and are
stored encrypted with `AI_CHAT_SECRETS_KEY`. Cursor uses its SDK connection
directly; there is no global Cursor API-key fallback or configurable base URL.

Build and run the application with the package manager configured for the
deployment (`pnpm`).

## MCP gateway

The gateway module is `packages/mcp-gateway/`.

`.env.example` defaults: `MCP_PORT=8787`, bind localhost. A live host may use a
different `MCP_PORT`.

**Do not treat localhost as authentication.** Unauthenticated requests,
including from `127.0.0.1`, are rejected. Callers need `MCP_BEARER_TOKEN` or a
signed Metis session. `upsert` / `set_mcp_server_enabled` /
`provision_registry_server` require `userId`. See
[PRODUCTION-AUDIT.md](./PRODUCTION-AUDIT.md) and [SECURITY.md](../SECURITY.md).

Set `MCP_PORT`, `MCP_PUBLIC_URL`, and `MCP_BEARER_TOKEN` only in the private
environment.

## Security checklist

- Never commit `.env`, tokens, chat passwords, databases, logs, or `data/`.
- Rotate any credential that was ever present in a repository or log.
- Review shell, filesystem, Docker, systemd, and remote desktop tools before
  enabling them in a public deployment.
- Optional and remote MCP servers are disabled by default.
- Configure `AI_CHAT_TRUSTED_PROXIES` with only controlled reverse-proxy peer
  IPs/CIDRs (for local Nginx: `127.0.0.1,::1`). Otherwise forwarding headers are
  ignored and login/share limits use the actual socket peer. Exclude direct
  public access to the backend and make the proxy overwrite forwarding headers.
- The legacy `x-chat-password` / `x-chat-username` path is off unless
  `CHAT_LEGACY_HEADER_AUTH=true`.

## WebSocket browser server

The production start command is `pnpm start`, which runs `tsx server.mjs` so
the browser preview can use the authenticated WebSocket endpoint at
`/api/browser/stream`. If systemd starts Next directly, point `ExecStart` at
the package start command (or `tsx <install-dir>/server.mjs`) before reloading
the service. Do not expose the WebSocket endpoint without the same
authenticated reverse-proxy boundary as the application.

The generic Nginx template is `deploy/nginx/metis-ai.conf.template`. Replace
`YOUR_DOMAIN` and `YOUR_PORT` for the local deployment; never copy a host's
systemd unit or Nginx file unchanged to another machine.

## Live note editing

Notebooks use the same authenticated custom server for live editing at
`/api/notes/collaboration`. Forward WebSocket upgrades for this path through
the existing app proxy. Start with `pnpm start`, not `next start`.

Opening a note joins its live document automatically. Accepted members of its
shared project can edit together; private notes remain account-only and public
share links remain read-only. Presence and cursors show current participants.
Both Blocks and Markdown modes edit the same Yjs document. The server validates
and atomically stores updates with canonical Markdown in SQLite before broadcasting.
Local IndexedDB drafts merge after reconnect. External tool/API content replacements
start a new document generation; stale editors stop and offer draft download and
reconnect instead of overwriting the replacement. Back up the database, including
the `note_collaboration` table, to retain live editing history.

File options → Spellcheck selects a browser dictionary language or Off. The
choice is local to the signed-in account on that browser. Available spelling
suggestions depend on the browser's installed dictionaries.

## systemd

Live units (`metis-ai`, `metis-ai-worker`, `metis-ai-mcp`) must **not** be
stopped as a side effect of a test or docs change. Restart only on explicit
operator request. P1-5 cgroup limits are live since 11 Sep 2026 16:33 CEST:
app 2G/512, worker 6G/1024, mcp 1G/256.

## Secure first-run and upgrades

Read `CHAT_DATA_DIR/setup-token` locally for the first account. No token is
returned by HTTP or printed in logs. An explicit random `AI_CHAT_SETUP_TOKEN`
may be supplied instead. Existing accounts do not need a new bootstrap token.
If all accounts are deleted after bootstrap, the consumed token remains invalid;
restore/recover accounts through operator access rather than reopening setup.

Native Unix installers and the runtime default to `AI_CHAT_ALLOW_ROOT_AGENTS=true`.
The first admin can bind the root OS user to a workspace inside its home without
an additional installer prompt or flag. `--deny-root-agents` disables root
execution; `--allow-root-agents` enables it again. Both flags override the previous
setting during an upgrade; without either flag, the existing setting survives.
Use separate OS users with private workspaces for untrusted app users.
Review old mappings before upgrading: unsafe nonadmin mappings now reject
creation/updates/execution; Windows nonadmin runs fail closed. An app role alone
does not provide an OS sandbox.

Use `pnpm start`/`tsx server.mjs` for socket identity and WebSockets. Direct
`next dev`/`next start` cannot provide authenticated socket metadata and use a
conservative shared rate-limit bucket. For multiple app processes add a shared
proxy/WAF limiter; the in-process counters are bounded but are not distributed.
