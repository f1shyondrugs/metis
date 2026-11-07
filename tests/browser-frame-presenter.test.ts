import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserFramePresenter } from "../lib/browser-frame-presenter";

function harness() {
  const listeners = new Map<string, EventListener>();
  const jobs = new Map<number, FrameRequestCallback>();
  const live = new Set<string>(), created: Blob[] = [], assigned: string[] = [];
  let id = 0, current = "", rendered = 0, maxLive = 0, rejectSource = false;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { assert.ok(blob instanceof Blob); created.push(blob); const url = "blob:" + created.length; live.add(url); maxLive = Math.max(maxLive, live.size); return url; };
  URL.revokeObjectURL = url => { assert.ok(live.delete(url), "only revoke owned URLs once"); };
  const image = {
    set src(value: string) { if (rejectSource) throw new Error("Image unavailable"); current = value; assigned.push(value); }, get src() { return current; },
    onload: null, onerror: null,
    addEventListener(type: string, fn: EventListenerOrEventListenerObject) { listeners.set(type, fn as EventListener); },
    removeEventListener(type: string) { listeners.delete(type); },
    removeAttribute() { current = ""; },
  };
  const presenter = createBrowserFramePresenter(image as unknown as HTMLImageElement, () => rendered++,
    fn => { const next = ++id; jobs.set(next, fn); return next; }, next => { jobs.delete(next); });
  return {
    presenter, jobs, live, created, assigned, rejectSource() { rejectSource = true; }, get maxLive() { return maxLive; }, get rendered() { return rendered; },
    flush() { const batch = [...jobs.values()]; jobs.clear(); batch.forEach(fn => fn(0)); },
    settle(type = "load") { listeners.get(type)?.(new Event(type)); },
    restore() { presenter.dispose(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; },
  };
}
test("slow decoding coalesces thousands of frames into the latest instead of accumulating work", () => {
  const h = harness();
  try {
    h.presenter.push(new Blob(["first"])); h.flush();
    const latest = new Blob(["latest"]);
    for (let i = 0; i < 18000; i++) h.presenter.push(i === 17999 ? latest : new Blob([String(i)]));
    h.flush();
    assert.equal(h.created.length, 1);
    assert.equal(h.jobs.size, 0);
    h.settle(); assert.equal(h.jobs.size, 1); h.flush();
    assert.equal(h.created.length, 2); assert.equal(h.created[1], latest);
    h.settle(); assert.equal(h.rendered, 2); assert.equal(h.live.size, 1);
  } finally { h.restore(); }
  assert.equal(h.live.size, 0);
});
test("long sessions retain bounded Blob URLs and cleanup cancels scheduled work", () => {
  const h = harness();
  try {
    for (let i = 0; i < 18000; i++) { h.presenter.push(new Blob([String(i)])); h.flush(); h.settle(); assert.equal(h.live.size, 1); }
    assert.ok(h.maxLive <= 2);
    h.presenter.push(new Blob(["cancel"])); h.presenter.dispose(); h.flush(); h.settle();
    assert.equal(h.created.length, 18000); assert.equal(h.live.size, 0); assert.equal(h.jobs.size, 0);
    h.presenter.push(new Blob(["after dispose"])); h.flush(); assert.equal(h.created.length, 18000);
  } finally { h.restore(); }
});
test("failed frames release the decoder and static action screenshots use the same queue", () => {
  const h = harness();
  try {
    h.presenter.push(new Blob(["bad"])); h.flush();
    h.presenter.push("data:image/jpeg;base64,fixture"); h.settle("error"); h.flush();
    assert.equal(h.rendered, 0); assert.equal(h.assigned.at(-1), "data:image/jpeg;base64,fixture"); assert.equal(h.live.size, 0);
    h.settle(); assert.equal(h.rendered, 1);
  } finally { h.restore(); }
});

test("frame acknowledgements wait for decoding and settle once on load or failure", () => {
  const h = harness(), settled: number[] = [];
  try {
    h.presenter.push(new Blob(["one"]), () => settled.push(1)); h.flush();
    assert.equal(settled.length, 0);
    h.settle(); h.settle("error");
    assert.deepEqual(settled, [1]);
    h.presenter.push(new Blob(["two"]), () => settled.push(2)); h.flush();
    h.settle("error"); h.settle();
    assert.deepEqual(settled, [1, 2]);
    assert.equal(h.rendered, 1);
  } finally { h.restore(); }
});
test("superseded pending images release their own acknowledgement without accumulating callbacks", () => {
  const h = harness(), settled: number[] = [];
  try {
    h.presenter.push(new Blob(["one"]), () => settled.push(1)); h.flush();
    h.presenter.push(new Blob(["two"]), () => settled.push(2));
    h.presenter.push("data:image/jpeg;base64,action", () => settled.push(3));
    assert.deepEqual(settled, [2]);
    h.settle(); h.flush(); h.settle();
    assert.deepEqual(settled, [2, 1, 3]);
  } finally { h.restore(); }
});
test("disposing drops pending callbacks and late loads cannot acknowledge a closed stream", () => {
  const h = harness(); let acknowledgements = 0;
  try {
    h.presenter.push(new Blob(["one"]), () => acknowledgements++); h.flush();
    h.presenter.push(new Blob(["two"]), () => acknowledgements++);
    h.presenter.dispose(); h.settle(); h.flush();
    assert.equal(acknowledgements, 0);
    assert.equal(h.live.size, 0);
  } finally { h.restore(); }
});
test("an image assignment failure releases the frame and every owned URL exactly once", () => {
  const h = harness(); let acknowledgements = 0;
  try {
    h.presenter.push(new Blob(["old"])); h.flush(); h.settle();
    h.rejectSource();
    h.presenter.push(new Blob(["invalid"]), () => acknowledgements++); h.flush();
    assert.equal(acknowledgements, 1);
    assert.equal(h.live.size, 0);
    h.presenter.dispose();
  } finally { h.restore(); }
});
