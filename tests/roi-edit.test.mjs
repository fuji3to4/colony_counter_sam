import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_R, hitTest, circleFromBox, circleFromCenter, resizeFromHandle, moveRoi, handlePoints,
} from "../js/roi-edit.mjs";

const roi = { cx: 100, cy: 100, r: 50 };

test("hitTest: no roi means create", () => {
  assert.deepEqual(hitTest(null, 10, 10, 8), { kind: "create" });
});

test("hitTest: handles take priority, within tolerance", () => {
  assert.deepEqual(hitTest(roi, 150, 100, 8), { kind: "handle", dir: "e" });
  assert.deepEqual(hitTest(roi, 47, 103, 8), { kind: "handle", dir: "w" });
  assert.deepEqual(hitTest(roi, 100, 55, 8), { kind: "handle", dir: "n" });
  assert.deepEqual(hitTest(roi, 100, 156, 8), { kind: "handle", dir: "s" });
});

test("hitTest: inside is move, outside is create", () => {
  assert.deepEqual(hitTest(roi, 110, 90, 8), { kind: "move" });
  assert.deepEqual(hitTest(roi, 200, 200, 8), { kind: "create" });
});

test("handlePoints returns the four compass points", () => {
  assert.deepEqual(handlePoints(roi), {
    n: [100, 50], e: [150, 100], s: [100, 150], w: [50, 100],
  });
});

test("circleFromBox: inscribed in drag box using the longer side, anchored at start corner", () => {
  assert.deepEqual(circleFromBox(0, 0, 100, 60), { cx: 50, cy: 50, r: 50 });
  assert.deepEqual(circleFromBox(100, 100, 0, 40), { cx: 50, cy: 50, r: 50 });
});

test("circleFromBox: enforces minimum radius", () => {
  assert.equal(circleFromBox(10, 10, 11, 11).r, MIN_R);
});

test("circleFromCenter: radius is distance to pointer", () => {
  assert.deepEqual(circleFromCenter(10, 10, 13, 14), { cx: 10, cy: 10, r: MIN_R });
  assert.deepEqual(circleFromCenter(0, 0, 30, 40), { cx: 0, cy: 0, r: 50 });
});

test("resizeFromHandle keeps the opposite handle fixed", () => {
  assert.deepEqual(resizeFromHandle(roi, "e", 170, 999), { cx: 110, cy: 100, r: 60 });
  assert.deepEqual(resizeFromHandle(roi, "w", 70, 0), { cx: 110, cy: 100, r: 40 });
  assert.deepEqual(resizeFromHandle(roi, "s", 0, 190), { cx: 100, cy: 120, r: 70 });
  assert.deepEqual(resizeFromHandle(roi, "n", 0, 30), { cx: 100, cy: 90, r: 60 });
});

test("resizeFromHandle clamps instead of flipping past the fixed side", () => {
  const r = resizeFromHandle(roi, "e", 0, 100);
  assert.equal(r.r, MIN_R);
  assert.equal(r.cx - r.r, 50); // west edge stays fixed
});

test("moveRoi translates without changing radius", () => {
  assert.deepEqual(moveRoi(roi, -20, 5), { cx: 80, cy: 105, r: 50 });
});
