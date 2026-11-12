import type { Page } from "playwright";

/** Capture the actual page for screenshots and live images in both browser contexts. */
export async function screenshotPage(page: Page, options: { type: "png" } | { type: "jpeg"; quality: number }) {
  return page.screenshot({ ...options, timeout: 15_000 });
}

// Used by DOM result redaction, independently of image capture.
export const BROWSER_CREDENTIAL_SELECTOR='input[type="password"], input[type="email"], input[autocomplete="username"], input[name="username" i], input[id^="username" i], input[name="login" i], input[name="user" i], input[autocomplete*="password"], input[autocomplete="one-time-code"], input[autocomplete^="cc-"], input[name*="token" i], input[name*="secret" i], input[name*="password" i], input[name*="passwd" i], input[name="pwd" i], input[id*="password" i], input[id*="passwd" i], input[id="pwd" i], textarea[autocomplete*="password"], [data-metis-sensitive="true"]';
