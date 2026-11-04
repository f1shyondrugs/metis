# Protected browser and console logins

Metis can request credentials through a protected form in the chat question frame.
The browser sends the values to the protected input endpoint; the model receives
only completion status. Ordinary question forms reject password, token and login
identity requests. After protected input, the waiting agent resumes its original
job, submits the website login when appropriate and checks the actual result.
A completed input request alone does not prove successful authentication.

## Usage and storage

Ask the agent to open an HTTPS login page. `browser_request_login` requests
`password`, `username` or `email` fields, with optional selectors identifying
visible controls. For school/tenant selection or other public preliminary steps,
the private browser returns `protected_browser_ready`. Complete those steps in
that context and request the visible credential fields again.

The form's **Save permanently** choice starts unchecked. Without it, encrypted
values exist only in memory for the same owner, chat and target, for at most
24 hours, ending on broker restart or chat deletion. Selecting it saves an
encrypted record per owner and exact HTTPS origin. Settings → Security →
Credential vault lists saved browser and console entries and supports replacement
and deletion. Changing a login identity does not silently reuse a password bound
to a different identity. Multiple accounts or tenants sharing one login origin
are not separate saved profiles.

The browser-login service keeps its own Chromium context; it does not copy the
ordinary browser's profile, cookies or local storage. A successful login must be
verified there. Rejected credentials stop the login attempt; CAPTCHA and MFA
remain website-controlled steps.

Console credentials use the same protected form and encrypted storage. They bind
to the SSH host, account, authentication method and host key, or to a local PAM
account/method. `console_connect`, `console_authenticate` and
`console_request_password` request protected authentication; ordinary
`console_command` input must never contain a password. The service preserves the
host's existing SSH, sudo and PAM policy.

## Deployment prerequisites

This feature requires a reviewed Linux service deployment; copying the UI alone
is insufficient. The templates under `services/browser-login/` and
`services/secure-console/` document the service topology. Adapt their Node,
release, browser-runtime, working-directory and unit paths to the installation.
They are templates for operator installation, not an automatic installer step.

- Run the browser engine as a dedicated non-root `metis-browser-login` identity.
  Give the console service its separate `metis-console` identity. Keep their
  state directories private and application/release code immutable to agents.
- Provision a 32-byte master key through systemd `LoadCredential=login.key:...`.
  A fresh installation needs a new key; upgrades and rollbacks must retain the
  existing key and encrypted database. Never regenerate an existing key.
- Point `METIS_BROWSER_LOGIN_APP_UNIT` at the actual app systemd unit. The peer
  broker accepts only that unit's current kernel-reported MainPID via
  `SO_PEERCRED`; sharing the Unix group or an MCP bearer does not authorize use.
- Start the real app HTTP engine directly with Node and the TypeScript loader,
  with inspector activation disabled (`--disable-sigusr1`). The included
  `app-start.conf` illustrates this requirement. Keep Linux Yama ptrace
  restrictions enabled; a wrapper process must not become the trusted MainPID.
- Use the public socket `/run/metis-browser-login/client.sock`, or configure
  `METIS_BROWSER_LOGIN_SOCKET` for the app. Only the broker may access the
  private engine socket and encrypted SQLite state.

Native provider isolation is part of this contribution because a provider child
sharing the application's identity must not read its secrets or request a
privileged parent file read. See [NATIVE-RUNTIME-ISOLATION.md](NATIVE-RUNTIME-ISOLATION.md)
for Bubblewrap, immutable code, per-owner writable mounts, gateway edit receipts
and systemd hardening requirements. Linux native execution fails closed when
that boundary cannot be established. This does not establish an equivalent OS
boundary on Windows or macOS. Configure and test the full deployment before
enabling protected credential use.

## Navigation and SSO

The private browser uses a DNS-checked public-network proxy and Chromium sandbox.
Private addresses, unsupported ports, arbitrary JavaScript, downloads, browser
batches and screenshot/image streams are unavailable in protected sessions.
Known secret representations and sensitive form values are redacted from DOM
results. This is not a universal information-flow guarantee against a malicious
login site; the trusted site necessarily receives the credentials it accepts.

HTTPS return origins explicitly declared in the initial login URL may be used
for navigation without forwarding password values. For a reviewed SSO flow that
requires another exact origin, an operator can set
`METIS_BROWSER_LOGIN_RETURN_ORIGINS_FILE` to a root-owned JSON file, for example:

```json
{
  "https://login.example.test": ["https://app.example.test"]
}
```

Every parent directory must also be root-owned and not writable by group/others;
symlinks are rejected. The service snapshots this configuration at startup, so a
reviewed change requires a restart and a fresh private login session. There is no
wildcard, model-supplied override or cross-origin password-forwarding permission.
Redirect hops and embedded frame navigation remain subject to the guard.
Unsupported worker targets are closed rather than resumed; failed inspection
closes the protected context. Pre-login public resources may be replayed locally
from the bounded session cache instead of making new third-party requests after
credential entry.

## Verification and rollback

Run `pnpm run test:protected-login`, `pnpm run typecheck`, the complete test suite
and `pnpm run build` against the contributed tree with isolated test data.
The login regressions exercise private preliminary steps, field readiness,
credential ownership, encrypted v1 compatibility, secret-free job continuation,
SSO redirects and browser form submission. Native isolation and console tests
have additional Linux prerequisites; report unsupported cases explicitly.
Synthetic fixtures do not prove a particular external website's login succeeds.

Roll back app code, browser service code and compatible unit configuration
together. Preserve encrypted databases and the corresponding master key. Private
browser sessions and chat-only credentials are transient; persistent encrypted
records remain reusable when the compatible service returns.
