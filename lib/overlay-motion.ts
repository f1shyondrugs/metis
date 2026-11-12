import type { OverlayItem } from "./desktop-overlay";

/** Presentation only: native scene/TTL/history remain authoritative. */
export const OVERLAY_MOTION = {
  draw: 460, dim: 420, highlight: 280, text: 180, card: 220, update: 280, graph: 420,
} as const;
export const motionEase = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const mixMotion = (a: number, b: number, t: number) => a + (b - a) * t;
export function overlayOpacity(item: OverlayItem) {
  return item.opacity ?? (item.type === "spotlight" ? .65 : item.type === "highlight" ? .25 : 1);
}

/** Retarget from the currently painted frame, not the previous command endpoint. */
export function interpolateOverlayItem(from: OverlayItem, to: OverlayItem, t: number): OverlayItem {
  if (t >= 1 || from.type !== to.type) return to;
  const next = { ...to };
  for (const key of ["x", "y", "width", "height"] as const) next[key] = mixMotion(from[key], to[key], t);
  next.opacity = mixMotion(overlayOpacity(from), overlayOpacity(to), t);
  for (const [key, fallback] of [["radius", 0], ["strokeWidth", 2], ["fontSize", 20]] as const) {
    next[key] = mixMotion(from[key] ?? fallback, to[key] ?? fallback, t);
  }
  if (from.points?.length === to.points?.length) {
    next.points = to.points?.map((point, n) => ({
      x: mixMotion(from.points![n].x, point.x, t), y: mixMotion(from.points![n].y, point.y, t),
    }));
  }
  // New holes open from their centers. Removed holes close before being discarded.
  if (to.type === "spotlight") {
    const before = from.holes ?? [], after = to.holes ?? [];
    next.holes = Array.from({ length: Math.max(before.length, after.length) }, (_, n) => {
      const source = before[n], target = after[n], template = target ?? source;
      const collapsed = { ...template, x: template.x + template.width / 2, y: template.y + template.height / 2, width: 0, height: 0 };
      const a = source ?? collapsed, b = target ?? collapsed;
      return { ...template, x: mixMotion(a.x, b.x, t), y: mixMotion(a.y, b.y, t),
        width: mixMotion(a.width, b.width, t), height: mixMotion(a.height, b.height, t),
        radius: mixMotion(a.radius ?? 0, b.radius ?? 0, t) };
    });
  }
  return next;
}

/**
 * Freeze a bounded snapshot of the actually displayed curve when a new command
 * interrupts a morph. No recursively nested evaluator closures on rapid updates.
 * Nonfinite neighbours remain gaps; never interpolate across an asymptote.
 */
export function snapshotCurve(evaluate: (x: number) => number, min: number, max: number) {
  const count = 513, step = (max - min) / (count - 1);
  const values = Array.from({ length: count }, (_, i) => {
    try { return evaluate(min + i * step); } catch { return NaN; }
  });
  return (x: number) => {
    const position = Math.max(0, Math.min(count - 1, (x - min) / step));
    const left = Math.min(count - 2, Math.floor(position)), a = values[left], b = values[left + 1];
    return Number.isFinite(a) && Number.isFinite(b) ? mixMotion(a, b, position - left) : NaN;
  };
}
export function mixCurve(from: number, to: number, t: number) {
  if (t >= 1) return to; // Exact target, including its discontinuities.
  return Number.isFinite(from) && Number.isFinite(to) ? mixMotion(from, to, t) : NaN;
}
