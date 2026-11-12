# Passkeys

Sign in with a password first, then open **Settings → Security → Passkeys**. Add a named passkey using the browser or device's own authenticator. The login form offers **Sign in with Passkey** without requiring a username. Password sign-in remains available; removing a passkey does not remove the account.

## Scope and verification

- WebAuthn is handled by SimpleWebAuthn server/browser, not custom signature parsing.
- Credentials are bound to the exact relying-party hostname. Use HTTPS and the same hostname on the web and in the desktop app. Localhost is supported for development; arbitrary insecure LAN origins are not.
- Registration requires an authenticated account, a discoverable credential and user verification. Its five-minute challenge is tied to the issuing HTTP session and an HttpOnly, SameSite=Strict browser cookie.
- Authentication also requires user verification, a matching user handle, origin, RP hash, challenge, valid signature and authenticator counter. Challenges are consumed atomically before verification. Successful assertions use the existing session/cookie contract.
- Management is account-scoped; only public credential material and metadata are stored. A private key never leaves the authenticator.
- Mutations require an explicit origin validated against configured, direct or authenticated proxy network metadata. No caller-controlled forwarded header or Origin establishes authority.
- Password recovery remains the normal account recovery path. Passkeys are not automatically created, imported, paired or synced by Metis.

Tables are additive and created on first use: account_passkeys and passkey_ceremonies. Back up the normal application database.

Tests: passkeys.test.ts covers cryptographic assertions and negative boundaries; the isolated assistant-passkeys preview plus native Electron fixture exercises registration/sign-in using a virtual authenticator and synthetic account only. A real owner's fingerprint/PIN ceremony is not automated.
