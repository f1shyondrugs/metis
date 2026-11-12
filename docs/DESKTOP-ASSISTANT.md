# Desktop Assistant state and message queue

The assistant uses the same `RichComposerInput` as the main composer. It grows to
180 CSS pixels, then scrolls internally; line deletion and width changes shrink or
refit it. Passive voice capture does not acquire keyboard focus when clearing a
sent draft.

The upper-right conversation panel has a lower-left resize handle. Arrow keys
resize it too; the header's Conversation size controls provide width/height ranges
and Reset. The stored preferred size is clamped to the current viewport and the
composer's actual height without overwriting the preference on smaller screens.

## Durable state

Authenticated `GET/PUT /api/desktop-assistant/session` binds state to the account
and its registered, non-revoked device. The lazily initialized SQLite
`desktop_assistant_sessions` table stores chat identity, draft text/context and
panel size. Writes are versioned and serialized by the client. A conflicting
window cannot silently overwrite newer server state; failed saves remain visible
and require an explicit retry. An inaccessible/deleted remembered chat is not
restored. The normal New-chat model defaults remain unchanged.

Session mutations validate the exact browser Origin against the configured public
URL or the canonical request origin. Behind a trusted HTTPS proxy, signed socket
metadata plus Host may establish the external origin; raw forwarded headers never
grant access. Next’s internal loopback Request URL alone is not the browser origin.
Authentication, account/device binding and version checks remain mandatory.

Failed saves show **Not saved**, not a permanent Saving indicator. Matching send
and save errors share one alert. **Retry save** persists the preserved draft and
clears only the matching stale send error on success; it never resends the message.
The Saved indicator reflects the server-acknowledged draft rather than a debounce
sentinel. Keep an unsaved renderer open until its retry succeeds.

Queue entries are the canonical chat `queuedMessages`, not a second assistant
queue. The existing chat PATCH, removal tombstones, upload materialization,
Send now submission and background worker drain own their lifecycle. Consequently
the queue is visible in the ordinary chat and continues while the overlay is
closed. A new follow-up appends after the existing queue. Every explicit queue
submission captures monitors once, before saving; replay does not take fresh
screenshots.

Editing moves the saved queue entry into the assistant's durable draft in one
SQLite transaction. Text appears locally immediately, but send remains locked
until removal is confirmed. Its original registered attachments, references and
device context remain with the draft. Reorder, failed deletion rollback and
Send now preserve canonical queue identities and permission checks.

## Screen-first responses and image transport

The assistant's capture context describes the user's intent and the available passive overlay tools. It asks the model to decide whether a short explanation, an annotation or real interaction is appropriate from meaning and visible evidence. There is no phrase matcher, automatic annotation trigger, forced tool call, model switch or Thinking override. Existing screenshots are first evidence; a fresh Computer Use observation may activate a window and is reserved for missing detail, stale evidence or actual interaction. Device ownership, permission checks, authoritative monitor geometry and freshness still apply.

Codex sends current-turn image attachments through the SDK's typed local-image input when the selected model's discovered/registry capability explicitly confirms vision. The native CLI reads private immutable snapshots in its already mounted account home; regular-file checks reject symlinks, account/chat access is checked, size limits apply and snapshots are removed after success, error or cancellation. Resume keeps native conversation ownership and receives only this turn's images. Unknown/non-vision models receive an explicit unavailable notice, not a claim that image pixels were supplied. Provider-native shell/view-image tools remain disabled.

The canonical MCP read tool inspect_image returns actual image content for authorized current-chat attachment IDs, optionally cropped in original image pixels. Its internal API is run-lease/account/chat bound, rejects missing/foreign images, checks pixel/byte limits, and returns source/crop/preview geometry. It never accepts arbitrary file paths or URLs or creates a fresh desktop input observation.

Monitor uploads enqueue together through the existing bounded upload pump. Results retain capture order regardless of completion order. Cancellation and failure drain all preparation tasks before returning; late tasks cannot start an upload or send an incomplete request. Queued submissions retain their original captures and normal canonical queue behavior.

## Regression coverage

- `tests/desktop-assistant-session.test.ts`: authenticated persistence,
  ownership/device boundaries, compare-and-swap versions and atomic edit.
- `tests/request-origin.test.ts`: exact public/trusted proxy origin validation,
  forged forwarding, null/malformed/cross-site origins, direct installations.
- `tests/desktop-assistant-origin.preview.mjs` serves the actual Assistant fixture
  against a real authenticated session route with internal HTTP/public origin
  mismatch. It verifies blocked-save recovery, preserved draft, truthful status,
  duplicate-alert suppression and explicit one-time send at390/768/1440 pixels.
  Transports/models/screens outside session persistence are synthetic; no real
  provider request or user monitor is captured.
- Existing queue drain/removal/send-now/persistence tests cover background
  execution without an open assistant.
- `tests/desktop-assistant-queue.browser.tsx`: actual React components with
  isolated API fixtures at 390/768/1440 pixels, multiline growth/shrink, queue
  edits/reorder/failure/restart, and keyboard resize.
- `tests/rich-composer-input.browser.tsx` and
  `tests/desktop-assistant.browser.tsx` retain normal composer, voice, model and
  canonical tool rendering checks.
