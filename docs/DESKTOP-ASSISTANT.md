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

## Regression coverage

- `tests/desktop-assistant-session.test.ts`: authenticated persistence,
  ownership/device boundaries, compare-and-swap versions and atomic edit.
- Existing queue drain/removal/send-now/persistence tests cover background
  execution without an open assistant.
- `tests/desktop-assistant-queue.browser.tsx`: actual React components with
  isolated API fixtures at 390/768/1440 pixels, multiline growth/shrink, queue
  edits/reorder/failure/restart, and keyboard resize.
- `tests/rich-composer-input.browser.tsx` and
  `tests/desktop-assistant.browser.tsx` retain normal composer, voice, model and
  canonical tool rendering checks.
