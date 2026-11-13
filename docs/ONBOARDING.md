# Guided first-run setup and client introduction

## Two separate state owners

Server bootstrap remains in `SetupWizard`, `/api/setup` and the existing setup database record. An empty instance opens directly at one admin form in both browser and desktop WebContentsView: username, password, and the required protected operator token. There is no welcome detour, extra-user creation, OS-user chooser, provider connection or separate success screen in server setup. Acknowledged bootstrap is followed immediately by authenticated completion and entry into the ordinary UI. Operator verification, first-admin-only transaction, token consumption, session cookie, authorization and execution guards stay unchanged. Client progress cannot grant access.

After authentication, `/api/status` exposes only the current authenticated user's stable ID. AppShell mounts `ClientOnboarding` keyed by that ID after server setup. Completion is **not** a server-wide or account-wide setting: localStorage is scoped to this origin/browser profile and the account ID. Native clients additionally use a random installation ID from their local userData profile, exposed through a main-frame-only current-server IPC. Each other account, browser profile, server origin and desktop profile therefore gets a separate guide. Updates retain the ID and v1 record; completing one client does not complete another. A new tab in the same browser profile is not a new client.

Only version/phase/tourIndex are persisted. The small workspace tour has been removed: valid legacy v1 tour records resolve directly to done (without replaying welcome), and fresh flows finish after the app/device page. The v1 key/schema remains compatible; account state, drafts, pairing and provider settings are not changed. Unknown fields and malformed records are discarded. Passwords, setup tokens, pairing codes and provider credentials never enter this progress record. Old global provider-onboarding flags do not suppress another account's introduction. Storage events synchronize the same account/client across tabs; asynchronous native replies are cancelled on user changes. When browser storage is blocked, a per-session in-memory record is used and the guide explains that limitation.

## Minimal account setup and recovery

Only one admin is created during setup. More users, provider connections and OS execution identity management remain available in normal Settings. Legacy welcome/people/provider/ready browser records cannot revive removed steps: server account existence determines admin creation versus authenticated completion. Completion failures preserve the acknowledged account and clear secrets; Retry/Continue only repeats completion, never bootstrap. Conflicting account creation offers sign-in recovery. Duplicate submits are guarded synchronously.

Safe inferred OS mappings remain as before. If the inferred identity is root and root execution is explicitly disabled, account setup may finish with no execution mapping; agent execution remains blocked until explicitly configured. An explicit disallowed root mapping still fails. Authorized root defaults are preserved, and the root policy is never toggled.

## Web and desktop paths

Web: welcome and optional app install offer, then directly into the existing workspace. Navigation is linear: Continue and Back, with Finish on the app/device page; Escape pauses without losing progress. The offer suggests the detected OS without guessing CPU architecture; Windows, macOS and Linux remain selectable in one compact platform dropdown rather than a row of action buttons. iPad desktop-mode is recognised as iOS. iOS and Android are explicitly **In development**, with no download or store link. The authenticated downloads endpoint reuses the existing official Metis-Apps release resolver and only lists its available architectures. Failed lookups show retry or an unconfirmed-availability state, never a fabricated release.

Native: a fresh profile with no saved server and no existing paired server starts in the local sandboxed welcome/domain screen. A valid existing server configuration keeps the existing direct-load behavior. Entered addresses use the canonical HTTPS/localhost policy. The real server page then determines sign-in versus first-instance bootstrap; the native launcher does not duplicate bootstrap or authenticate by scraping a page. Once signed in, the introduction shows device setup rather than offering another app installer. Local account sign-in and remote-device pairing remain separate.

Full device controls remain in the existing DesktopClientSettings and local pairing window, not in the introduction. The device step has one unchecked optional checkbox, Set up computer access now. Only after opting in does Continue pause the guide and open the existing authenticated Settings → Devices → Remote Clients pane, without automatically creating a token or choosing an access mode. Getting started resumes the same saved device step. Access mode, pairing ownership and Windows elevation checks remain authoritative. No automatic pairing, permission prompts, autostart change or privilege escalation occurs. If optional installation-identity storage fails, the existing configured app still loads using its already-isolated local browser profile; onboarding metadata must never stop the background client. New native APIs for context, changing server and reviewing OS permissions validate WebContents, exact main frame and current configured origin. Child frames and foreign origins cannot call them. Installation identity is metadata only; credentials remain private.

## Appearance and concise presentation

New accounts and empty profiles default to Midnight with its existing neutral dark surfaces. The pure-black-and-white Metis preset has been removed. Saved selections of that retired preset resolve to Midnight on read, including account records and pre-paint bootstrap, without discarding custom themes or changing account revisions. Every other explicit preset/custom selection is preserved.

AppearanceSettings remains in normal Settings; the welcome screen contains no separate Appearance, provider, skip or dismissal action. Preset selection, custom JSON editing/import/export and account persistence use the canonical appearance provider, not separate onboarding state. The native offline domain launcher starts black/white; after connecting, the web view uses the account theme. Native launcher colors are not a separate editable theme store. Core onboarding copy is one short sentence per purpose, with decorative icons and accessible labels on compact controls. Detailed operator-token instructions remain available on demand. Device onboarding presents only the optional access choice; ordinary settings retain all device details. The native footer contains progress dots only, with no explanatory text or visible step-label row.

## Motion and tour

The web server setup, sign-in, client guide and native launcher share the dot/wave visual language. The web asset `public/metis-onboarding-motion.js` and the desktop copy `desktop/ui/onboarding-motion.js` must remain byte-identical when maintained across repositories. It contains presentation only: no network or native bridge. The perimeter path is invisible geometry for positioning only; the wave mask clips sharp white dots and a separate white glow layer. Only the glow is Gaussian-blurred (8px, 22% opacity), leaving dots crisp and Reduce Motion static. There is no hard continuous outline or flat gray band; the soft white edge glow intentionally remains. The controller pauses for document visibility/reduced-motion changes and disposes RAF/observers/listeners on unmount. CSS entrances also respect prefers-reduced-motion.

No small product-tour cards, target highlights or tour-driven workspace navigation are mounted. Getting started in the account menu reopens only the full-screen introduction. Finish records completion directly; it does not open a new chat, navigate away, select a device or create an account. Native optional computer-access setup still opens the existing Settings pane only after an explicit checkbox and action.

## Loading and step transitions

The shared motion controller waits for page load and font readiness, with a bounded 1800ms fallback so a missing asset never traps the UI. Reduced Motion shows the final state immediately. The `metis:onboarding-ready` presentation event starts content and a 1000ms opacity/scale edge entrance together; only then does the wave RAF run. Visibility changes and live Reduced Motion cancel the entrance, and unmount removes listeners/timers/animations.

`OnboardingTransition` is painting state, not a second onboarding state machine. Its 180ms outgoing fade retains the old scene inert, then mounts the latest target for a 420ms entrance. Same-step typing and error updates remain immediate. Stable client stages keep one edge controller across Continue/Back. Server setup and the full-screen client guide use the same transition wrapper. A live motion-preference change commits the exact target immediately. Pending timers and old account content cannot reappear after unmount; keyboard focus is preserved/restored without stealing focus from an already focused new form.

The native local domain launcher uses the same timing constants and readiness event. It makes the new scene interactive before focusing its URL input. A ready remote view still replaces the launcher immediately and disposes its motion controller. No authentication, bootstrap, pairing or system-permission action waits on an animation.

## Clean launcher and consistent navigation

Native fresh-profile setup uses a frameless, menu-free host with a draggable header. The logo, title and short description replace the old desktop eyebrow and right-hand feature checklist. On the first successful server load, the same authorized WebContentsView transfers to the regular framed app window without a page reload. Configured installations still open directly in their normal window; closing a retired splash cannot dispose the workspace. No pairing, authentication, permissions or autostart state changes as part of this presentation.

Except for the native first-launch welcome hero, account setup, client guide use one bottom navigation row: progress dots on the left and Continue (Finish on the last app/device page) at the far right, with Back immediately before it. Forms use their original submit handlers through associated footer buttons. Provider connection now lives solely in the ordinary UI, not in first-instance setup; its standalone dialog and existing settings controls remain available. The footer stays on one row on small viewports. Full-screen dots/glow retain their existing motion behavior.

## First-launch hero and click response

A fresh native profile presents the centered canonical wordmark, Welcome to Metis, a short line and Start. Edge dots fade in with a 1000ms entrance; logo, title, description and controls settle in a coordinated 1500ms presentation. Start is never gated by the animation. Configured profiles still load directly. Reduced Motion shows final states immediately.

Pointer presses inside full-screen onboarding add bounded, spatial wave impulses (at most four, expiring after 1800ms). The controller reads coordinates only, never field values, sends no data and changes no permissions. Hidden/reduced/unmounted stages do not start new impulses; disposal removes the document listener. There are no small tour cards.

## Windows administrator connection

Windows OS elevation and the server-selected pairing mode are separate requirements. Local Device Settings shows the real process token and the device-host token. A genuine Administrator pairing code is still required; an existing User grant is never rewritten or silently upgraded.

Desktop 1.7.18 keeps the desktop UI in Standard user mode and enables a separate UAC-approved background device host from the trusted local settings frame. The launch passes only a fixed executable/role, nonce and parent PID; no code, URL or credential is passed in arguments. UAC is requested before an Administrator pairing code is consumed, cancellation retains the normal primary and any existing User connection, and the utility independently checks its own real token before connecting. A User pairing is never upgraded implicitly; a new Administrator code is required.

One shared tray owns both components. Closing windows leaves background device access running; Quit stops both, and losing the authenticated private channel stops the High host. Normal reopens only reveal the existing desktop without UAC. The channel verifies exact process identity, Windows account/session and elevation, with generation-scoped messages and identification-only token queries. Global UAC and pairing policy remain unchanged. See the Metis-Apps `desktop/ADMIN-ACCESS.md` for the native lifecycle and protocol.

## Verification

- `tests/client-onboarding.test.ts`: platform detection and per-account/client state parsing.
- `tests/onboarding-downloads.test.ts`: real isolated authentication, platform allowlist and official release projections.
- `tests/setup-onboarding.test.ts`: existing bootstrap security and server resume regressions.
- `tests/onboarding.browser.tsx` with `node tests/onboarding.preview.mjs`: actual components against synthetic HTTP/IPC, multi-account/device resume, stale replies, downloads, direct completion and legacy tour-record migration, real bootstrap form and responsive layout.
- Metis-Apps: `desktop/tests/client-context.test.cjs` and `desktop/tests/onboarding.cjs` cover fresh/existing installation, local domain UI, stable context, main-frame guards and native reduced-motion rendering. The latter is an isolated Electron test; it never changes an owner's device permissions.
