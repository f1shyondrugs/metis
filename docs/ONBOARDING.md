# Guided first-run setup and client introduction

## Two separate state owners

Server bootstrap remains in `SetupWizard`, `/api/setup` and the existing setup database record. An empty instance is detected before sign-in, in both the browser and the desktop WebContentsView. Operator-token verification, first-admin creation, OS-user choice, provider authentication and setup completion keep their existing backend contracts. Client progress cannot complete server setup or grant computer permissions.

After authentication, `/api/status` exposes only the current authenticated user's stable ID. AppShell mounts `ClientOnboarding` keyed by that ID after server setup. Completion is **not** a server-wide or account-wide setting: localStorage is scoped to this origin/browser profile and the account ID. Native clients additionally use a random installation ID from their local userData profile, exposed through a main-frame-only current-server IPC. Each other account, browser profile, server origin and desktop profile therefore gets a separate guide. Updates retain the ID and v1 record; completing one client does not complete another. A new tab in the same browser profile is not a new client.

Only version/phase/tourIndex are persisted. Unknown fields and malformed records are discarded. Passwords, setup tokens, pairing codes and provider credentials never enter this progress record. Old global provider-onboarding flags do not suppress another account's introduction. Storage events synchronize the same account/client across tabs; asynchronous native replies are cancelled on user changes. When browser storage is blocked, a per-session in-memory record is used and the guide explains that limitation.

## Web and desktop paths

Web: welcome, optional app offer, optional six-part live workspace tour. The offer suggests the detected OS without guessing CPU architecture; Windows, macOS and Linux remain manually selectable. iPad desktop-mode is recognised as iOS. iOS and Android are explicitly **In development**, with no download or store link. The authenticated downloads endpoint reuses the existing official Metis-Apps release resolver and only lists its available architectures. Failed lookups show retry or an unconfirmed-availability state, never a fabricated release.

Native: a fresh profile with no saved server and no existing paired server starts in the local sandboxed welcome/domain screen. A valid existing server configuration keeps the existing direct-load behavior. Entered addresses use the canonical HTTPS/localhost policy. The real server page then determines sign-in versus first-instance bootstrap; the native launcher does not duplicate bootstrap or authenticate by scraping a page. Once signed in, the introduction shows device setup rather than offering another app installer. Local account sign-in and remote-device pairing remain separate.

Device settings reuse DesktopClientSettings and the existing local pairing window. Access mode, pairing ownership and Windows elevation checks remain authoritative. No automatic pairing, permission prompts, autostart change or privilege escalation occurs. If optional installation-identity storage fails, the existing configured app still loads using its already-isolated local browser profile; onboarding metadata must never stop the background client. New native APIs for context, changing server and reviewing OS permissions validate WebContents, exact main frame and current configured origin. Child frames and foreign origins cannot call them. Installation identity is metadata only; credentials remain private.

## Motion and tour

The web server setup, sign-in, client guide and native launcher share the dot/wave visual language. The web asset `public/metis-onboarding-motion.js` and the desktop copy `desktop/ui/onboarding-motion.js` must remain byte-identical when maintained across repositories. It contains presentation only: no network or native bridge. The controller pauses for document visibility/reduced-motion changes and disposes RAF/observers/listeners on unmount. CSS entrances also respect prefers-reduced-motion.

The product tour uses a small non-modal card and actual app navigation callbacks for Chat, Projects, Notebooks, Workspace, Agent Hub and Settings. Advancing a card does not create projects, send messages, select a device or navigate automatically. Show actions are explicit. Highlights follow visible in-app anchors and do not intercept workspace input. Continue later/Escape pauses at the saved position. Getting started in the account menu can resume or restart the introduction. Completing or skipping the tour does not overwrite user settings.

## Verification

- `tests/client-onboarding.test.ts`: platform detection and per-account/client state parsing.
- `tests/onboarding-downloads.test.ts`: real isolated authentication, platform allowlist and official release projections.
- `tests/setup-onboarding.test.ts`: existing bootstrap security and server resume regressions.
- `tests/onboarding.browser.tsx` with `node tests/onboarding.preview.mjs`: actual components against synthetic HTTP/IPC, multi-account/device resume, stale replies, downloads, tour actions, real bootstrap form and responsive layout.
- Metis-Apps: `desktop/tests/client-context.test.cjs` and `desktop/tests/onboarding.cjs` cover fresh/existing installation, local domain UI, stable context, main-frame guards and native reduced-motion rendering. The latter is an isolated Electron test; it never changes an owner's device permissions.
