# Metis UI/UX consistency audit — 9 November 2026

Baseline: `d877427`. Scope: the web application, not the native Remote Client or the public website. This audit preserves the existing theme system, English product text and user-authored Markdown. No deployment is part of this change.

## Findings and implemented corrections

| ID | Priority | Evidence and user problem | Cause | Canonical correction |
| --- | --- | --- | --- | --- |
| UI-01 | P1 | A long confirmation on a 390×844 viewport extended above and below the screen; its title, close control and actions could be unreachable. Dialog, Sheet and public-preview dismissal targets also differed. | The default DialogContent had no viewport height bound. Each overlay defined its own close button. | Bounded, scrollable DialogContent; ConfirmDialog keeps a scrollable description separate from visible actions. Dialog, Sheet and SharedPreviewDialog reuse OverlayCloseButton. Button exposes action/icon-action sizes with mobile and coarse-pointer minimum targets. |
| UI-02 | P1 | A rejected asynchronous confirmation produced an unhandled rejection and no error inside the dialog. Recently deleted swallowed its rejection and closed the dialog even when permanent deletion failed. | ConfirmDialog used try/finally without catch; one caller independently consumed the exception. | ConfirmDialog prevents duplicate submissions, disables dismissal while pending, shows an inline error, retains the dialog and permits retry. RecentlyDeletedChats propagates its rejection to that common handler. |
| UI-03 | P1 | An archive request returning HTTP 503 rendered “No archived chats.” Shared chats could show their empty state while still loading. Usage errors lacked a nearby explicit Retry action. | Archive/shared reads retained no error state; several independently styled feedback blocks drifted. | A distinct loading/error/empty sequence for archive and shared lists. LoadError supplies the same named retry interaction in Settings, Usage, Devices, note sharing and Recently deleted. Error summaries no longer report a misleading zero count. |
| UI-04 | P2 | Canvas/Plan cards exposed up to four opening targets: title, header icon, raw workspace URI and footer action. Long titles were truncated; long previews were clipped. Hard-coded blue/violet decoration and nested surfaces differed from the product tokens. | Two independent card implementations contained the same frame, copy lifecycle and opening UI, with different labels and decoration. | WorkspaceCard owns the frame, wrapping title, one opening action, copy feedback with cleanup, focusable scrolling preview and token colors. Canvas keeps diagram/graph/chart metadata. Plan keeps progress, compact mode, Build, Parallel and disabled behavior. |
| UI-05 | P2 | Settings category metadata was maintained in the mobile list, desktop list/search and a separately hard-coded tablet selector. Current destinations matched, but adding/removing a category required parallel edits. | Several inventories for the same navigation task. | visibleSettingsTabs is the shared role-aware inventory for category navigation, the tablet selector and search. Admin remains hidden for ordinary accounts. This corrects redundant implementation rather than claiming an existing route was broken. |

Primary source owners: [WorkspaceCard](../components/workspace-card.tsx), [ConfirmDialog](../components/confirm-dialog.tsx), [Dialog](../components/ui/dialog.tsx), [OverlayCloseButton](../components/ui/overlay-close-button.tsx), [LoadError](../components/load-error.tsx), [SettingsPanel](../components/settings-panel.tsx), and [settings-navigation](../lib/settings-navigation.ts).

The scoped duplicate-body scanner examined 222 component files and found zero exact function-body groups at baseline. That result does **not** mean there was no duplicated behavior: the Canvas and Plan copy functions differ in resource-specific text, and their duplicated JSX is outside that scanner's exact-body comparison.

## Verification

- 88 focused Node regression tests pass. Coverage includes card contracts, public workspace allowlists, shared exports, chat-trash ownership, settings navigation, editor lifecycle/references, drafts, composer caret behavior and queue behavior.
- Type checking and the final optimized production build pass. ESLint passes for the configured changed TS/JS modules; the browser fixture JSX and CSS are compiled by esbuild/PostCSS and exercised in the browser rather than claimed to be covered by an unconfigured ESLint parser.
- 288 browser assertions pass: 48 assertions for each combination of 390×844, 768×1024 and 1440×900 with the existing Paper and Midnight themes.
- The browser matrix renders the real components with synthetic fetch data for cards, the notebook editor, Composer input/Add menu, Settings, Usage, Devices, sharing and confirmation dialogs. It checks overflow, opening callbacks, keyboard-scroll affordances, public sharing controls, pending/failed/retried confirmations, failed permanent deletion and explicit data-load recovery.
- Measured contrast for sampled changed card headings, metadata and error messages is at least 5.02:1 in Paper and 5.48:1 in Midnight. This is a measurement of those rendered samples, not certification of every theme or every application control.
- Direct keyboard testing in the shared editor confirms that typing followed by Ctrl+Z restores the original paragraph while preserving its headings, task list and link.
- Before/after screenshots were captured in the visible Metis browser. A critique pass reduced preview heading density and retained the permanent-delete confirmation on failure.

### Reproduce the component checks

From the repository, with its installed dependencies:

```sh
node scripts/ui-audit-preview.mjs --port=3248
```

Open the returned loopback URL through Metis's in-app browser. Choose the viewport with the browser tools, select Paper/Midnight with `?theme=light` or `?theme=dark`, and click **Run checks**. The preview uses synthetic data and never starts a browser, worker, provider job or production API. Reports are written to `output/ui-audit-preview/results.json`. `--build-only` compiles the fixture without listening.

## Preserved differences

- Canvas and Plan share presentation. Plan still has task progress and executable Build/Parallel callbacks; Canvas still has visual-content counts. Consolidation does not grant a missing callback or create opening/build permissions in a read-only view.
- Notes, Canvas and Plans already use NotesBlockEditor. Composer remains a draft-oriented input; it is not replaced with the document editor. Markdown storage, selection/undo, autosave and conflict logic are unchanged.
- Private editing, public read-only preview, chat sharing and note-subtree sharing retain their separate access/data policies. Their reusable controls and overlay presentation are shared, not their authorization.
- Compact desktop action sizes remain available. The new action sizes expand on narrow screens and coarse-pointer devices; dense editor controls are not globally resized.

## Remaining candidates and limits

1. Full-shell end-to-end verification remains open. Automatic tool approval rejected the local full application test-server start as “Detached browser automation.” The accepted fallback uses static previews of the actual components through the existing visible Metis browser. It does not prove complete AppShell navigation, production API behavior or all combinations of nested overlays.
2. The notebook file-tree actions in `NotesWorkspace.nodeView` still use compact size-7 targets; selected-desktop controls also have their own compact layout. These are source-level follow-up candidates for a full-shell touch/keyboard pass, not visually confirmed defects in this component audit.
3. Real provider authentication, live quotas/credits, actual remote desktop transport, multiplayer concurrency and physical touch hardware were not exercised. No real provider run, credit consumption or device-control request was sent. Existing relevant boundary tests remain part of the regression set.
4. Only Paper and Midnight were measured. Imported/custom themes and every preset need their own contrast audit. This work preserves saved theme choices instead of silently rewriting them.
5. AppShell remains large. Further extraction should follow specific navigation/lifecycle boundaries and behavioral tests; file size alone is not evidence that two behaviors can safely be merged.

The live app, worker, gateway, Vault and Remote Client were not restarted or replaced.
