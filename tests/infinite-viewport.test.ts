import assert from "node:assert/strict";
import test from "node:test";
import { viewAfterWheel, viewAfterPinch } from "../lib/infinite-viewport";
import { viewAfterZoom } from "../lib/notes-gestures";

const wheel = { deltaX: 60, deltaY: 120, deltaMode: 0, ctrlKey: false, metaKey: false };
test("wheel pans both axes without bounding the infinite surface or changing zoom", () => {
  assert.deepEqual(viewAfterWheel({ x: -1e6, y: 1e6, zoom: 2 }, wheel, { x: 10, y: 20 }, 500), { x: -1000060, y: 999880, zoom: 2 });
});
test("line and page wheel events use viewport units", () => {
  const initial = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(viewAfterWheel(initial, { ...wheel, deltaX: 1, deltaY: 2, deltaMode: 1 }, { x: 0, y: 0 }, 500), { x: -16, y: -32, zoom: 1 });
  assert.deepEqual(viewAfterWheel(initial, { ...wheel, deltaX: 0, deltaY: 1, deltaMode: 2 }, { x: 0, y: 0 }, 500), { x: 0, y: -500, zoom: 1 });
});
test("Control and Command wheel zoom around the pointer after arbitrary panning", () => {
  const initial = { x: -80, y: 35, zoom: 1.3 }, anchor = { x: 120, y: 70 };
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const next = viewAfterWheel(initial, { ...wheel, [modifier]: true }, anchor, 500);
    assert.ok(next.zoom < initial.zoom);
    assert.ok(Math.abs((anchor.x - next.x) / next.zoom - (anchor.x - initial.x) / initial.zoom) < 1e-9);
    assert.ok(Math.abs((anchor.y - next.y) / next.zoom - (anchor.y - initial.y) / initial.zoom) < 1e-9);
  }
});
test("extreme wheel zoom is clamped while preserving its content anchor", () => {
  assert.equal(viewAfterWheel({ x: 0, y: 0, zoom: 1 }, { ...wheel, ctrlKey: true, deltaY: -1e6 }, { x: 100, y: 100 }, 500).zoom, 3);
  assert.equal(viewAfterWheel({ x: 0, y: 0, zoom: 1 }, { ...wheel, ctrlKey: true, deltaY: 1e6 }, { x: 100, y: 100 }, 500).zoom, 0.2);
});
test("diagram zoom can fit below the unchanged notebook minimum", () => {
  const movement = { ...wheel, ctrlKey: true, deltaY: 1000 };
  const diagram = viewAfterWheel({ x: 0, y: 0, zoom: 1 }, movement, {x:200,y:100}, 400, 0.01);
  assert.equal(diagram.zoom, 0.01);
  assert.equal(viewAfterWheel({ x: 0, y: 0, zoom: 1 }, movement, {x:200,y:100}, 400).zoom, 0.2);
});

test("pinch combines zoom and two-finger translation inside an offset workspace", () => {
  const origin = { x: -40, y: 20, zoom: 1 };
  const start = { midpoint: { clientX: 1050, clientY: 200 }, distance: 100 };
  const next = viewAfterPinch(origin, start, { clientX: 970, clientY: 220 }, { clientX: 1170, clientY: 220 }, { left: 900, top: 100 });
  const anchored = viewAfterZoom(origin, 150, 100, 2);
  assert.deepEqual(next, { zoom: 2, x: anchored.x + 20, y: anchored.y + 20 });
});
