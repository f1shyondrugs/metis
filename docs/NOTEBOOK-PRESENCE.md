# Notebook presence and following

The notebook header keeps Live editing status and account avatars outside the document scroll container. Participants are also marked beside their current file in the active file tree. The header includes visible participants in other accessible notebooks, even when they are reading a different note.

Hover, click or keyboard-open an avatar to see the saved profile image, display name, account username and current note. Follow starts location following for that notebook window, including authorized note changes, normalized scroll position and short click markers. Profile colors come from the saved image/crop; GIF color uses its first frame. Avatar framing and animated image bytes are retained.

Following shows an inset border and a Following/avatar/username pill in the sampled profile color. Stop, Escape, an own document click, typing, wheel/touch interaction or explicit notebook navigation ends it. Moving the mouse or opening a participant card alone keeps it active. Escape is consumed so it does not dismiss an outer workspace or trigger an unrelated shortcut.

Before changing notes, following uses the existing NoteDocument flush path. An unconfirmed save or conflict keeps the local document/draft and stops following with a message. Pending navigations carry a cancellation predicate: a late response cannot reopen a followed note after the viewer stops, navigates elsewhere or the leader changes A → B → A before earlier requests finish.

## Transport and permissions

- Location presence uses authenticated `/ws/notes?presence=1` over the existing notes WebSocket proxy path. Document updates remain on the existing Hocuspocus channel.
- The server derives identity from the account/session and saved profile. Notes are validated for sender and recipient; outgoing data rechecks session/project access. Private, archived and unavailable notes are not announced. An unauthorized follower is stopped without disclosure of the target ID/title.
- Presence is in memory only, removed on disconnect or heartbeat timeout. It carries note identity/title, scroll fraction and bounded click coordinates. It records no document text, clipboard contents, keystrokes or activity history.
- `/api/notes/presence/avatar/[userId]` reuses existing project-peer profile visibility and rechecks access before conditional 304 responses.
- Connections/messages are bounded, view updates go to followers, metadata/profile refreshes are coalesced, and mutual follow cycles are rejected.

Older clients need a fresh browser load to announce notebook-wide presence. Following synchronizes location; document edits retain the existing authorized collaborative editor.

## Implementation owners

`lib/notebook-presence.ts` defines the wire contract. `notebook-presence-server.ts` owns authentication and visibility. `note-participant.ts` owns profile projection and bounded/cached color sampling. `components/notes/use-notebook-presence.ts` owns cancellation and synchronization; the presence bar/context keep draft persistence independent.

## Verification

`tests/notebook-presence.test.ts` uses real WebSockets with isolated accounts/notes. It covers cross-note discovery, canonical profiles/colors, followed views, private transitions, revoked access, protected/conditional images, spoofing, origin/auth checks, cycles, malformed inputs and cropped image color.

Existing collaboration regressions retain concurrent/offline merges, durable save confirmation and revoked-write/outgoing-data protection. The two-account browser fixture uses actual NotesWorkspace, authenticated API handlers, Hocuspocus and the presence server with synthetic profiles. Production data is not used.
