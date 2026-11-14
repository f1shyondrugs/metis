# Reference mentions

The Composer and the shared Notebooks editor accept category shortcuts:

- `@chats` opens Chats; `@chats:Mathe` searches only conversations.
- Other shortcuts: `@files`, `@canvases`, `@plans`, `@notes`, `@issues`,
  `@browser`, `@terminals`, `@memories`. Each accepts `:search terms`.
- Names are case-insensitive; singular names and German aliases (Dateien,
  Notizen, Pläne, Erinnerungen) are also recognized. Unknown prefixes stay
  ordinary search text. These are reserved category words, not a new query language.
- Typing into the picker retains the resolved category. Back clears it.
  Existing keyboard selection, composition guards and dismissal remain.
- Keep the raw mention text/range separate from the parsed search scope:
  replacing a selection removes the whole `@category:query`, not only the query.

Saved user references render through `ReferenceLink` in both the message text
and its reference chips. They are real anchors with a kind icon, dotted
underline, hover/focus preview and normal Enter activation. Chats have a real
`/?c=...` target for native Ctrl/Cmd/middle-click and copy/open-in-new-tab.
Browser references have an HTTP(S) destination. Other internal references use
their canonical Metis URI and the normal authenticated destination handlers;
modifier/middle clicks must never launch an arbitrary custom URI externally.

Document previews reuse the authenticated internal preview API, including
loading/unavailable states and current note icons. Other categories show only
the metadata already attached to the saved reference; terminal snapshots or
other raw content are not included in hover cards. These metadata cards are
not a live permission or existence check. Destination APIs retain access checks.
Public-share rendering remains inert and cannot inherit private navigation.

HTTP(S) link icons in chat, citations, the shared Notes/Canvas/Plan editor,
browser references and profile links use the destination origin’s `/favicon.ico`.
Images load lazily without a referrer. Until loaded, or if missing, blocked or
invalid, the existing icon remains. Transparent favicons replace rather than
overlay that icon. Internal Metis destinations keep their type/note icons;
this display-only behavior never edits Markdown, labels or link navigation.
No third-party favicon service or per-link server-side page fetch is involved.
Sites that only advertise a nonstandard icon path currently retain the fallback.

Favicon browser regression: run `node tests/favicon-links.preview.mjs` and open
`http://127.0.0.1:3278` with the in-app browser. The isolated fixture uses only
synthetic local assets and saves reports under `output/favicon-links-ui`.
It covers successful transparent images, missing/invalid images, source changes,
editor serialization/undo, navigation, citations and browser references. Some
automated browser environments reject `/favicon.ico` requests; reports distinguish
that fallback path from successful image decoding rather than treating them as
successful website-icon loads.
Unknown labels, emails and partial label matches never gain a reference target.

Owners: `lib/reference-query.ts`, `components/reference-picker.tsx`,
`components/reference-link.tsx`, `components/rich-user-text.tsx`.
Focused regression: `tests/reference-mentions.test.tsx` (in `test:shared`).
Browser fixture: run `node tests/reference-mentions.preview.mjs` with Node22+
and open port3265 at `?width=390|768|1440`. Uses an isolated synthetic database
and account, real shared components and authenticated reference/preview routes;
it does not log into or mutate production accounts.
