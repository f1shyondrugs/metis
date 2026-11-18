# Electron multi-window and passive desktop feedback

Use when extending the unified desktop app with additional windows or pointer-reactive overlays. Resolve the owning Apps repository from project context rather than editing a staged copy in the server repository.

## Window ownership

- `ipcMain.handle` is process-global. Install each channel once and dispatch to its owning live window, then retain the handler's exact WebContents/main-frame/local-file or configured-origin checks. Register ownership before loading the local shell; remove global handlers only after the last owner is gone. A first-run frameless-to-framed handoff changes the local BrowserWindow, so ownership must resolve the current host rather than retain the retired one.
- Separate each window's server, navigation, view, generation guards and menu callbacks. Share only the intended history/session policy and the single device runtime/tray. An application menu is global on macOS; on Windows/Linux, resetting it can overwrite individual window menus, so restore the per-window menus after choosing the active application menu.
- Distinguish an explicit second launch/New Window action from ordinary OS activation and the legacy fixed show-window signal. The signal remains presentation-only, never a URL/command transport. Keep original WebContents alive when opening another window. A late load in a background window must not focus it or steal focus from a newer window.
- When opening an assistant/notification chat, retain the source server alongside the chat ID. Do not navigate whichever window happens to be active on another server. A device identity paired to one origin must not become screen-context authority for another origin.

## Pointer feedback without input interception

- Reuse the existing input-hook owner instead of installing another hook just for animation. Observe primary mouse-down only; do not alter native hit testing, synthesize input, activate the overlay, log positions or send them to a server. Release the added listener with its owner.
- Coordinate spaces differ: Windows hook coordinates are physical screen pixels, while Electron display/window bounds are DIP. Convert once with `screen.screenToDipPoint`, choose the display, then subtract the overlay's **actual `getContentBounds()` origin**. macOS may adjust a requested overlay position around system UI; requested display bounds and returned native window bounds need not be identical. Tests must not select an overlay by exact requested x/y equality.
- Keep click pulses short-lived and bounded, respect reduced motion, and drop feedback while hidden or capture-suspended. Coalesce bursts; a single pending click-feedback slot separate from coalesced cursor/state updates prevents frequent cursor messages from erasing every click pulse. Preserve click-through, NoActivate, capture visibility and cancellation behavior.

## Verification details

Exercise real simultaneous windows, retained drafts, shared intended sign-in, foreign frames/contents, second processes, individual close and last-window background behavior. Test pulse routing with negative display origins, mixed-DPI conversion, OS-adjusted content bounds, a busy renderer, hide/capture suspension and reduced motion. Validate rendering on all target operating systems rather than weakening an invariant for CI.

For native Quit/update fixtures on Windows, mirror the production `window-all-closed` owner. Verify a drained child through actual OS liveness rather than assuming its queued Node `exit` event has already run. Do not recursively delete Electron's current Chromium profile inside `will-quit`: locked profile files can stall shutdown even after all assertions pass. Let the isolated parent runner create the temporary profile and remove it only after Electron exits; retain phase output and a child timeout to distinguish drain, handoff and cleanup failures.

Installed-window probes must recognize the actual server-qualified workspace title while excluding device-settings/helper windows, and stay scoped to the tested PID. Windows PowerShell 5 fixtures without a BOM should express non-ASCII title characters through escapes/code points, not locale-dependent literal source text.

For installed Windows ASAR checks, use platform-native paths (`path.join`) with `@electron/asar.extractFile`. Git checkouts may use CRLF on Windows: compare exact normalized source text/hashes when verifying source equivalence, rather than treating line-ending-only differences as different product code. Keep artifact version, fresh process and restored original device connection as separate evidence; inventory metadata alone is not installation proof.
