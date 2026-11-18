# Native calendar

Calendar is an authenticated, account-owned page between Notebooks and Automations. It provides month/week views, calendar filters, event creation/editing/deletion, all-day events, recurring series and native connection settings. Public shares and Incognito do not expose calendar tools.

## Navigation

Calendar is a primary workspace at `/?c=calendar`, alongside `/?c=notes` and
`/?c=automations`, not an account subpage. The URL determines visibility and
sidebar selection, including direct links, reloads and Back/Forward. Account
page dismissal cannot close it or load `calendar` as a chat ID. The last chat
and its saved snapshot remain available when returning; chat composer, drop
handling and browser streams stay inactive while Calendar is shown. The compact
workspace header names the current destination (Calendar, Notebooks or
Automations). Account headers likewise show their page name beside an icon-only
Back to chat button, with an accessible label and tooltip; desktop headers share
the 48px height and mobile headers retain 44px touch targets. The workspace title
is the page's single visible h1: panels do not repeat the area name or add a
generic introductory tagline. Action toolbars, period labels, subsection
headings, user-authored content and necessary state/error/help text remain.

## Time zones

Calendar time zone defaults to **Device time zone**, detected in the browser,
not the server. The selector can override it with a named IANA zone. This
display-only preference is stored per account on this browser/device; it does
not rewrite events or another device's preference. Automatic mode resolves the
device zone again on focus/visibility changes. Invalid stored values return to
automatic mode. If detection is unavailable, the selector discloses UTC fallback;
blocked storage leaves a usable session-only override.

FullCalendar v6 uses the matching `@fullcalendar/luxon3` connector for named
zones and DST rather than UTC coercion. Date clicks use FullCalendar's
offset-aware `dateStr`; all-day dates never pass through device-local Date
getters. Changing the view zone leaves existing event instants untouched.

New events start in the effective display zone (device by default). Existing
events retain their stored zone. In the event editor, changing Time zone
converts the displayed start/end while preserving their instants; the user can
then edit local times if needed. Existing explicit offsets are preserved for
ambiguous fall-back times, and nonexistent spring-forward local times are
rejected. Date-only all-day events retain their dates across zone changes.
Saving still uses canonical Metis writes and native provider synchronization.

All-day End is exclusive and must be after Start. Switching a same-day timed
draft to all day, or moving Start past End, advances End to the following date.
The end picker also prevents same/earlier dates, with a pre-submit guard; a
one-day all-day event is still supported. Date arithmetic uses UTC date-only
values so DST cannot skip or duplicate a date.

ICS export uses current bundled VTIMEZONE data from timezones-ical-library.
If its release differs from runtime ICU, the existing compatibility definitions
may be used only when they reproduce the requested instant exactly. The end
instant is validated too. Requested IANA aliases retain matching TZIDs.
Imported definitions are never silently replaced; recurrence exceptions and
alarms remain intact. The exact round-trip guard still rejects unsupported or
ambiguous definitions rather than shifting saved events.

## Event references

The shared @/Add context picker includes Calendar events. Use `@events query`
(or `@calendar query`, `@kalender query`, and colon forms). Each result identifies
the event/series once, never one entry for every occurrence. The server
rehydrates selected event context from the authenticated account; submitted
titles/content cannot grant access. Deleted, foreign and Incognito references
are omitted. Notes uses the same picker and native link.

Saved events use `calendar-event://EVENT_ID` Markdown links. Hover/focus loads
bounded, private/no-store details and the current calendar color. Links open
`/?c=calendar#event-EVENT_ID`, reveal the relevant calendar, move to the resolved
date and outline just that occurrence. Series resolve from the start of today
in the viewer's display zone, respecting canonical recurrence exceptions and
cancellations. Sparse series use bounded year windows (up to ten years); an
exhausted or unsupported series never gets an invented next occurrence.

Successful `calendar_create_event` / `calendar_update_event` results render
a compact live event card below the tool group, even while it is collapsed.
Deferred payloads are resolved only near the viewport, retaining only the
saved ID. Failed/pending tools and input-only IDs do not render saved cards.
For an explicit embed, use a `calendar-event` fenced block with
`{"id":"EVENT_ID"}`. Public shares keep event links/cards private and inert;
they never inherit a visitor's authenticated calendar preview.

Tests: `calendar-references.test.ts` covers ACLs, context rehydration,
recurrences and acknowledged tool results. `calendar-event-references.preview.mjs`
serves real components and authenticated APIs on isolated synthetic data;
its browser fixture also executes the extracted real AppShell navigation
handler. No external provider writes or owner events are used.

## Connections and mapping

The owner explicitly connects iCloud with an app-specific password or Google with OAuth. Secrets are encrypted at rest and target/account-bound, never returned by calendar APIs or agent tools. Disconnect clears saved credentials and stops sync without deleting local or remote events.

Calendars with normalized equal names are paired. Missing writable counterparts are created; read-only calendars remain separate. Existing same-provider duplicate names require renaming before sync. A missing previously linked calendar stops writes instead of inferring that all its events were deleted.

Google requires a **web application OAuth client**, Calendar API and CalDAV API, and this exact registered redirect:
`<public Metis origin>/api/calendar/oauth/callback`.
Configure `METIS_GOOGLE_CALENDAR_CLIENT_ID` / `METIS_GOOGLE_CALENDAR_CLIENT_SECRET` using protected operator settings, or enter a per-account client in Calendar → Connections → Google setup. Google consent requests offline access. Testing-mode apps must allow the owner as a test user; Google's consent/verification requirements still apply. No application credentials are bundled.

The iCloud "Use existing connection" migration accepts only this account's encrypted, bound `icloud-calendar-personal` environment fields. It does not expand legacy placeholders or follow arbitrary credential paths. Google MCP token files are deliberately not imported: reconnect through native OAuth. Existing MCP connections are not disabled automatically. Remove them only after verifying the native import and both directions with the owner.

## Sync contracts

The normal web server starts a dedicated bounded calendar worker thread; no MCP server or agent turn is needed. It polls every 30 seconds, observes a durable 60-second per-connection minimum, and backs off five minutes after errors. Manual Sync now bypasses backoff. Per-account durable leases prevent overlapping writers across processes.

Adapters use iCloud/Google CalDAV RFC6578 incremental tokens, ETags and maintained ICS parsing. Google calendar discovery/creation uses Calendar REST because Google CalDAV does not implement MKCALENDAR. Pulls validate the whole source batch atomically before advancing its token or inferring snapshot deletions. Expired tokens trigger one fresh snapshot. Provider response bodies and credentials are never exposed in user-facing errors.

Canonical events, tombstones, per-source acknowledgements and stable UID-derived remote paths are the durable outbox. Unknown write results reconcile by GET/hash before retry. Unknown calendar creation is recorded and is not blindly retried. Local/remote concurrent changes create reviewable conflicts and hold all linked writes until resolved with a reviewed-version CAS. Event writes and deletion use version CAS; create retries use an account-bound stable idempotency key.

Raw ICS retains exceptions, alarms and unknown properties. New cross-provider copies strip scheduling identities to avoid sending invitations; updates retain the target's scheduling metadata. Provider transformations that lose supported semantic fields are reported, not silently acknowledged. Cross-provider invitations/RSVP management and per-occurrence editing are not offered. The editor changes/deletes the entire series. Calendar renames, cross-calendar moves and calendar deletion are not exposed by this UI.

Timed input requires an explicit offset and a valid IANA zone. Export includes VTIMEZONE and preserves recurrence wall time across daylight-saving transitions. Floating/all-day events follow viewer wall dates. Queries are capped at 370 days; bounded item, ICS size, expansion and HTTP limits fail explicitly rather than silently truncating.

## Agent tools

`calendar_list_calendars`, `calendar_list_events`, `calendar_get_event`, `calendar_create_event`, `calendar_update_event`, `calendar_delete_event` call the canonical Metis store through an owner/chat/job/active-lease-bound internal API. Agents do not receive provider credentials and never write a second cloud copy. A local save does not prove remote synchronization has completed.

## Validation and rollout

`pnpm test:calendar` covers canonical CRUD/idempotency/CAS/owner boundaries, OAuth metadata/state, actual gateway-to-leased API dispatch, native adapter transport mocks, import/mirroring/conflicts/deletions, partial failures, DST and navigation callbacks. It is included in the standard shared test suite.

`tests/calendar.preview.mjs` serves real UI/API components with isolated synthetic data on loopback; `tests/calendar.browser.tsx` checks responsive month/week/edit/connect behavior. It performs no external provider writes. These tests do not establish that an owner's real accounts are connected.

Rollout must preserve the actual current live source, running worker/gateways and unrelated dirty work. Activate a new web build only with restart approval. Existing gateways need a separately staged calendar-capable endpoint for new runs; keep gateways serving running jobs. Real account import and reverse-sync validation remain distinct from a successful build. Never delete or disable old connectors before that validation.
