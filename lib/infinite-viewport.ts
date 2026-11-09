import { pinchDistance, pinchMidpoint, viewAfterZoom, type NotesView } from "./notes-gestures";

type Point = { clientX: number; clientY: number };
type WheelMovement = { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean };

export function viewAfterWheel(view: NotesView, movement: WheelMovement, anchor: { x: number; y: number }, viewportHeight: number, minimumZoom = 0.2): NotesView {
  if (movement.ctrlKey || movement.metaKey) {
    return viewAfterZoom(view, anchor.x, anchor.y, view.zoom * Math.exp(-movement.deltaY * 0.01), minimumZoom);
  }
  const multiplier = movement.deltaMode === 1 ? 16 : movement.deltaMode === 2 ? viewportHeight : 1;
  return { ...view, x: view.x - movement.deltaX * multiplier, y: view.y - movement.deltaY * multiplier };
}

export function viewAfterPinch(origin: NotesView, start: { midpoint: Point; distance: number }, a: Point, b: Point, rect: { left: number; top: number }, minimumZoom = 0.2): NotesView {
  const midpoint = pinchMidpoint(a, b);
  const zoomed = viewAfterZoom(origin, start.midpoint.clientX - rect.left, start.midpoint.clientY - rect.top, origin.zoom * pinchDistance(a, b) / Math.max(1, start.distance), minimumZoom);
  return { ...zoomed, x: zoomed.x + midpoint.clientX - start.midpoint.clientX, y: zoomed.y + midpoint.clientY - start.midpoint.clientY };
}
