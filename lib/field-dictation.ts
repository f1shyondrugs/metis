/** Insert at the selected range without normalizing unrelated user text. */
export function insertFieldTranscript(value: string, spoken: string, start = value.length, end = start, maxLength = 100_000) {
  const text = spoken.trim();
  if (!text) return value;
  const from = Math.max(0, Math.min(value.length, start));
  const to = Math.max(from, Math.min(value.length, end));
  const left = value.slice(0, from), right = value.slice(to);
  const prefix = left && !/\s$/.test(left) ? " " : "";
  const suffix = right && !/^\s/.test(right) ? " " : "";
  const room = Math.max(0, maxLength - left.length - right.length - prefix.length - suffix.length);
  if (!room) return value;
  return left + prefix + text.slice(0, room) + suffix + right;
}

/** Metadata only: never inspect a field's value to decide eligibility. */
export function dictationAllowed(type = "text", metadata = "", autoComplete = "") {
  if (!["text", "textarea"].includes(type.toLowerCase())) return false;
  if (/username|email|password|one-time-code|cc-|webauthn/i.test(autoComplete)) return false;
  return !/(?:e[ _-]?mail|login|user[ _-]?name|benutzername|nutzername|anmeldename|password|passwort|kennwort|passphrase|api[ _-]?key|access[ _-]?token|secret|credential|credit[ _-]?card|security[ _-]?code|verification[ _-]?code|otp|cvv|iban)/i.test(metadata);
}
