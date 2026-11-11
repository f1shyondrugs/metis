# Noninterrupting MCP activation — bounded assessment

Inspected 2026-11-12 without reading credential configuration. No service changes were performed.

## Observed topology and limits

- `metis-ai-mcp.service` runs `run-service.sh lib/mcp-core/gateway-core.mjs`; observed PID 699 binds loopback port **8798** (allowlisted process environment inspection).
- Port 8787 is an unrelated Python Discord activity proxy, not a standby MCP gateway. Do not use it.
- `run-service.sh` sources the application .env before launching Node. A shell-level MCP_PORT override before calling this wrapper can be overwritten. Apply overrides **after** environment loading.
- Gateway core lines 4181–4256 keep transport sessions and credential fingerprints in process-local Maps; SIGTERM/SIGINT exit immediately. No transferable session store, drain API, or hot module activation was found.
- The inspected nginx ai/metis-ai sites route application traffic to 3100, not directly to the gateway. This is not evidence of a session-aware gateway proxy.
- Shared on-disk state is not session transport state. Starting a second gateway does not migrate a session. Never round-robin requests between instances.

**Conclusion:** no verified transparent activation of changed gateway code for already-running agents. Keep their gateway and endpoint unchanged. New sessions may use a side-by-side endpoint after controlled validation. Existing sessions retain old code until they end. A restart, replacement of the old listener, endpoint-wide flip, or guessed drain timeout violates the no-interruption requirement.

## Operator procedure (recommendations only; not executed)

1. Prepare a reviewed immutable runtime snapshot with dependencies. Audit startup `ensureState()`, registry/child lifecycle, SQLite writes and shared-files concurrency before allowing a second gateway to access production state. A different state directory alone may omit required registry/settings. Do not clone credential files into a scratch snapshot.
2. Select an unused loopback port (8799 is an example, NOT verified free). Check using `ss -ltn`. Keep authentication and trusted-context validation identical to production. A health response alone is not authenticated MCP readiness.
3. Only after the concurrency review, start a distinct unit with the same protected environment loading contract. Suggested unit command below uses the live .env without printing it, then applies overrides. Replace SNAPSHOT with the reviewed absolute runtime root; keep AI_CHAT_ROOT pointing to the intended audited shared data root. Do not use this command before the review gate:

```sh
# Proposed only: no existing service is stopped, reloaded or replaced.
sudo systemd-run --unit=metis-ai-mcp-next --property=WorkingDirectory=/root/metis-ai \
  /bin/bash -c 'set -euo pipefail; set -a; . /root/metis-ai/.env; set +a; \
  export MCP_PORT=8799 MCP_HOST=127.0.0.1 AI_CHAT_ROOT=/root/metis-ai; \
  exec "${METIS_NODE_BIN:?}" /SNAPSHOT/lib/mcp-core/gateway-core.mjs'
curl --fail --silent http://127.0.0.1:8799/health
```

Do not expose a new public listener. Use the existing protected client configuration pathway to direct **new jobs only** to the new endpoint. Do not place tokens in shell arguments/history. Validate authenticated initialize, tools/list, a benign tool call and session continuation using that client. Do not retry writes during validation.

4. Keep existing jobs pinned to 8798 for their full lifetime, including reconnects and DELETE requests. A future session-aware proxy needs an authoritative session-to-backend table populated from initialize responses, consistent routing for every method, and explicit unknown-session failure (never replay a tool call to another backend). Introducing a proxy on the existing occupied port itself needs a separately designed migration; nginx reload cannot manufacture MCP state.
5. Retire the old unit only after authoritative active-agent, child-call and MCP-session counts reach zero and the owner explicitly authorizes retirement. Current health exposes no counts; silence in logs or a finite timeout is not proof. Until then leave it running.

Rollback for **new jobs** means sending subsequent new sessions back to the old endpoint; retain any gateway that still owns sessions. Do not stop the new gateway while its sessions are active either.

## iCloud 0.1.3 classification defect and staged repair

Installed `dist/caldav/client.js:196` maps both 401 and 403 to AUTH_FAILED. Domain errors are serialized by their code; a separate PERMISSION_DENIED code preserves the distinction. A 401 indicates authentication rejection; 403 indicates access/policy denial and does not prove credentials valid or invalid. Do not automatically request a replacement password on 403.

The repository helper is fail-closed, dry-run by default and refuses the entire live integrations tree, resolved symlink escapes, ambiguous source and repeated application. It changes only the reviewed response branch and ErrorCode declaration in a disposable staged package. It never emits response bodies, URLs, credentials or exception details. Static classification messages contain no upstream text. Existing unrelated upstream errors are NOT made universally safe by this narrow patch.

```sh
cd /root/metis-ai
STAGE=$(mktemp -d)
cp -a /root/.local/share/metis-integrations/icloud-calendar/node_modules/icloud-calendar-mcp "$STAGE/package"
python3 scripts/icloud-auth-classification.py "$STAGE/package"                 # DRY_RUN_VALID
python3 scripts/icloud-auth-classification.py "$STAGE/package" --apply-staged  # STAGED_PATCH_APPLIED
python3 tests/icloud-auth-classification.test.py
```

Copy only the package, never its parent integration configuration. Keep the stage private (mktemp default); do not deploy this staged copy or restart the live connector in this task. Prefer upstreaming the equivalent TypeScript change and publishing a versioned connector; runtime/declaration patching is a reproducible interim artifact, not a live install modification. Source maps are not rewritten, and upstream source/build validation remains necessary.

No CalDAV request, authentication attempt, write operation, full application build, service restart or deployment was performed.
