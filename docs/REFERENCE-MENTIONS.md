# Reference mentions

The Composer and the shared Notebooks editor accept category shortcuts:

- `@chats` opens Chats; `@chats Mathe` searches only conversations.
  The existing `@chats:Mathe` syntax is also supported.
- Other shortcuts: `@files`, `@canvases`, `@plans`, `@notes`, `@issues`,
  `@browser`, `@terminals`, `@memories`, `@events`, `@automations`, `@skills`. Each accepts ` search terms` or `:search terms`.
- Names are case-insensitive; singular names and German aliases (Dateien,
  Notizen, Pläne, Erinnerungen) are also recognized. Unknown prefixes stay
  ordinary search text. These are reserved category words, not a new query language.
- Typing into the picker retains the resolved category. Back clears it.
  Existing keyboard selection, composition guards and dismissal remain.
- Keep the raw mention text/range separate from the parsed search scope:
  replacing a selection removes the whole `@category query` or `@category:query`, not only the query.

Use `@skills` to attach an installed, enabled skill to this turn. Search returns
the display name and a short description, not package paths or instructions.
The server checks current account/project settings again on submit and run;
both runners use the registered skill's instructions and do not trust a client
path. In Notebooks, the same picker inserts a link to the skill in Agent Hub.
Deep Research is a mode, so choose it from `/deep-research`, not `@`.

Type `/` at the start of the Composer or use **Add → Commands**. Both pickers
share the list, search field and highlighted-row behavior. Use Up/Down to
navigate, Enter or Tab to select, Backspace on an empty scoped search to go
back, and Escape to dismiss. Search by name or enter a scoped command directly,
e.g. `/model`, `/model-options`, `/access` or `/workspace terminal`. The command
uses the same app controls for agent mode, permissions, model, supported model
options and workspace tabs. It does not send or replace an unrelated draft.

Picker rows use native note/automation glyphs and colors. Project context carries
only its authorized id/name/icon/color/logo revision and renders the shared
NotebookProjectIcon, including uploaded logos. Chat, workspace and issue rows
inherit accessible project context; notes use their own project. Calendar
events show their calendar's name and color, not just a generic event icon.
Missing custom icons keep the existing type fallback. Recheck project access
before returning results, and never expose project instructions/memberships.

Automations are a first-class reference category, with the existing
`automation://ID` link, account-checked preview and normal destination handler.
The editor shares the native page icon picker for glyphs, colors and Unicode
icons. Icons persist as nullable automation metadata; omitted fields preserve
the old choice and null removes it. An icon-only update cannot resume a task,
change a schedule or clear a run claim/error. Legacy rows and old workers
remain compatible with the additive nullable column. See
`tests/reference-appearance.test.ts` for ownership, persistence and upgrade checks.

Long model/account names in composer controls shrink and truncate before
Context/Usage controls. Full identities remain in accessible text and the
operable selection menu; the stored model ID and parameters are unchanged.
The shared ModelPicker also bounds its label and preserves the chevron/pin.

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

Link hover cards are interactive dialogs: the pointer can cross the gap into the
card, Open link (or clicking its non-interactive content) activates the original
anchor exactly once, Arrow Down enters the action and Escape dismisses it.
Editor anchors delegate their hover lifecycle to the same component. Plain,
Ctrl/Cmd and middle clicks on web links in the shared Markdown editor open a new
tab; internal note/file/reference routes keep their existing callbacks and draft
flush boundaries. The link-editing toolbar remains available.

Copied same-origin `/?c=notes#note-...` URLs resolve through the authenticated
note preview/navigation path. Same-origin `/share/notes/<token>` URLs use the
public share grant through `GET /api/shared-notes/<token>?view=preview`, optionally
scoped to a shared descendant. This returns bounded title/icon/description only,
not files, the full tree or private account metadata. Locked shares reveal no
protected title/content; existing signed viewer cookies, password changes,
revocation, archive and live-tree checks remain authoritative. Foreign origins
never resolve local note IDs or share tokens. Public-reader Markdown still does
not inherit account preview APIs or private navigation.

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
