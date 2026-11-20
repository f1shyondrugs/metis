# Metis client login contract

The configured server's public HTTPS origin is the only destination for
discovery, credentials and the resulting session. Production clients keep
normal certificate verification and never follow credential-bearing redirects.

## Discovery

`GET /api/system/client-compatibility` is unauthenticated and returns:

```json
{"service":"metis","schemaVersion":1,"supportedVersions":[1]}
```

This route only advertises the static wire contract, not the server's health,
release number, URLs, deployment settings or user details. Schema 1 clients
may use protocol 1 when it is explicitly advertised, including alongside
future versions. Unknown schemas or a list with no supported version require
a client/server update; do not send credentials. Servers with no discovery
route (HTTP 404) keep the documented legacy flow. Other errors, redirects and
malformed successful responses are not legacy discovery. An authentication
failure is never used to try a second login endpoint or mode.

## Protocol 1 and legacy

`POST /api/auth` accepts the existing username/password JSON. Success remains
`200 {"ok":true}` plus the first-party Metis cookie. The client validates the
cookie and verifies the session with `GET /api/chats` before accepting login.
`DELETE /api/auth` still logs out as before. Legacy servers use these same
routes and need not return an error code. The client does not translate
arbitrary upstream HTML or response text into trusted error details.

The login endpoint preserves all existing HTTP statuses and human-readable
`error` strings. Its optional `code` field is stable:

| HTTP | Code |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `invalid_credentials` |
| 429 | `rate_limited` (existing `Retry-After` preserved) |
| 500 | `auth_unavailable` |

New codes must be additive. Do not expose whether an account exists. Unknown
or missing codes remain generic client errors. Production logs and client
diagnostics must not include credentials, cookie values or tokens.

## Reverse proxies

Preserve the public HTTPS origin, forward the same paths and methods including
the login POST, and don't strip `Set-Cookie` or the subsequent request cookie.
Configure only actual proxy addresses as trusted peers. Verify the discovery
route, then a real login and chat read with a disposable test account through
the **public** address; a successful discovery response alone does not prove
that login reaches Metis. To distinguish an edge denial from a backend 401,
correlate the request time, path, proxy status and upstream status. If the
request never reached Metis, fix the proxy configuration; clients do not
bypass access policies or weaken TLS.
