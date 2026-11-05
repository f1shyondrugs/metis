/** Copy text with the existing selection fallback, including controls inside modal focus scopes. */
export async function copyText(raw: string, control?: HTMLInputElement | HTMLTextAreaElement | null) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(raw); return; }
  } catch { /* Browsers can deny the async clipboard while allowing a user-initiated copy. */ }
  const previous = document.activeElement as HTMLElement | null;
  const owned = !control || control.value !== raw;
  const area = owned ? document.createElement("textarea") : control!;
  if (owned) {
    area.value = raw;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
  }
  try {
    area.focus(); area.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
  } finally {
    if (owned) area.remove();
    previous?.focus();
  }
}
