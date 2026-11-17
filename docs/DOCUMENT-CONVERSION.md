# Document conversion and spellcheck

Canvas, Plan and Markdown Note actions share a **Convert to** submenu. It offers the other two types, then an explicit confirmation with the destination. Conversion creates a saved copy: the original, its links, history, sharing settings, issue relationships and child notes stay untouched. It does not silently move, delete or publish the source.

Workspace copies stay in their chat. Notes created from a workspace go to the same project notebook, or No Project. A note converted to Canvas/Plan creates an empty normal chat in that note's project (no message or agent execution). Markdown, including rich block envelopes, is copied verbatim. Destination limits remain 50,000 characters for notes and 100,000 for ordinary workspaces; oversized copies fail without truncation. Research report exceptions do not widen Plan/Note limits.

The account-authenticated POST /api/documents/convert rechecks source access, version, Incognito and the Notes feature flag. Project scope is derived from the source, never a caller-supplied destination. One SQLite transaction persists the destination and account-bound request record. The same request returns the existing saved destination; rebinding a request ID is rejected. Retry after a lost response does not duplicate the copy. A deleted or no-longer-accessible destination is not recreated silently. Sources remain unchanged on all failures. Issuebooks, issue documents, assets and memories are not converted through the Markdown Note menu.

Notes flush the existing live/draft editor before taking a conversion snapshot. Workspace copies include the current visible draft. Conflict/error dialogs remain open and never auto-resend; navigation that wins the race is not replaced by a late conversion result.

Canvas/Plan use the same NotesSpellcheckMenu, account/browser preference and NotesSpellcheckChoice as Notebooks. It applies to titles, block content and Markdown source. Off, browser default and installed dictionary languages are shared immediately in the same tab and across tabs. Browser dictionaries still determine actual suggestions. Public share surfaces gain no conversion or editing controls.

Tests: document-conversion.test.ts (real authenticated APIs and isolated SQLite), document-conversion.browser.tsx and document-conversion.preview.mjs (actual shared menus, editor, spellcheck hook and conversion API on synthetic data). Existing workspace-create/editor tests remain applicable.
