/** Keep at most one live stream Blob URL, even when image loads are superseded. */
export function replaceBrowserFrameUrl(
  previous: string | null,
  blob: Blob,
  image: Pick<HTMLImageElement, "src" | "onload" | "onerror"> | null,
): string | null {
  if (!image) {
    if (previous) URL.revokeObjectURL(previous);
    return null;
  }
  let next: string | null = null;
  try {
    next = URL.createObjectURL(blob);
    image.onload = null;
    image.onerror = null;
    image.src = next;
    return next;
  } catch (error) {
    if (next) URL.revokeObjectURL(next);
    throw error;
  } finally {
    // Waiting for onload leaks the older URL if another frame replaces its handler.
    if (previous) URL.revokeObjectURL(previous);
  }
}
