/** Horizontal scrollers own their gesture, including when already at either edge. */
export function ignoresNavigationSwipe(target: Element | null, boundary: Element) {
  if (!target) return true;
  if (target.closest("input, textarea, button, a, select, [contenteditable='true'], [data-swipe-ignore]")) return true;
  for (let node: Element | null = target; node && node !== boundary; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    if (/^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}
