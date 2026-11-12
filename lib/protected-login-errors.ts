// Only these fixed diagnostics may cross the private-browser boundary.
// Never expose Playwright exceptions, selectors, URLs, request bodies or values.
const messages = {
  isolation_required: "Protected logins are unavailable until an operator configures the Linux credential services in isolated or trusted-root mode. Never enter credentials through ordinary chat or ask_user.",
  session_unavailable: "The protected browser session is unavailable. Close the browser, open the intended HTTPS login page again, then request a new protected login.",
  credential_exists: "A login already exists for this website. Edit the existing entry instead.",
  console_credential_exists: "A login already exists for this console target. Edit the existing entry instead.",
  console_target_unavailable: "Could not check this console target. Check the host, port and account, and ensure the protected console service is available.",
  credential_target_changed: "The console target or SSH host key changed. Check the target again before saving.",
  credential_unavailable: "This saved login is no longer available. Refresh the vault and try again.",
  navigation_blocked: "The protected login could not complete a safe website navigation. Close this browser tab, reopen the original website and try again.",
  protected_action_unavailable: "This action is unavailable in the protected login browser. Use page controls, or close the protected tab before opening another website.",
  screenshot_unavailable: "Browser image could not be captured. Try again after the page finishes loading.",
  session_limit: "The protected browser session limit has been reached. Close an unused protected browser and retry.",
  page_unavailable: "The protected login page could not be opened. Check the website and retry.",
  https_required: "Protected login requires an HTTPS website without URL credentials or a nonstandard port.",
  invalid_fields: "Choose valid credential fields and inspect their selectors with browser_form_state.",
  field_not_visible: "Requested credential fields are not visible. Complete the preceding login steps in the protected browser and retry.",
  field_ambiguous: "Multiple credential fields match. Inspect the protected form and supply a selector for one visible field.",
  unsafe_target: "The credential field or form destination is unsafe. Credentials were not entered.",
  protected_login_unavailable: "Protected login could not be prepared. Inspect the protected form and retry. Never request credentials through ordinary chat or ask_user.",
} as const;

export type ProtectedLoginCode = keyof typeof messages;
function knownCode(code: unknown): ProtectedLoginCode {
  return typeof code === "string" && Object.hasOwn(messages, code)
    ? code as ProtectedLoginCode : "protected_login_unavailable";
}
export class ProtectedLoginError extends Error {
  readonly code: ProtectedLoginCode;
  constructor(code?: unknown) {
    const safeCode = knownCode(code);
    super(messages[safeCode]);
    this.name = "ProtectedLoginError";
    this.code = safeCode;
  }
}
export function protectedLoginFailure(error: unknown) {
  const safe = error instanceof ProtectedLoginError ? error : new ProtectedLoginError();
  return { error: safe.message, code: safe.code };
}
