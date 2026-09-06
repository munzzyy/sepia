import test from "node:test";
import assert from "node:assert/strict";
import {
  createEditor,
  addOp,
  setCrop,
  undo,
  redo,
  removeOp,
  moveOp,
  resizeOp,
  hitOp,
  paintOps,
  pixelCell,
  outputRect,
  normRect,
} from "../app/js/editor.js";

test("rects normalize from any drag direction and clamp to the frame", () => {
  const r = normRect({ x: 90, y: 80, w: -50, h: -30 }, 100, 100);
  assert.deepEqual(r, { x: 40, y: 50, w: 50, h: 30 });
  const clamped = normRect({ x: -20, y: -20, w: 300, h: 300 }, 100, 100);
  assert.deepEqual(clamped, { x: 0, y: 0, w: 100, h: 100 });
});

test("tiny accidental drags are rejected", () => {
  const ed = createEditor(100, 100);
  assert.equal(addOp(ed, "ink", { x: 10, y: 10, w: 2, h: 2 }), null);
  assert.equal(ed.ops.length, 0);
});

test("undo and redo cover ops and crop", () => {
  const ed = createEditor(200, 200);
  addOp(ed, "ink", { x: 10, y: 10, w: 50, h: 20 });
  setCrop(ed, { x: 0, y: 0, w: 100, h: 100 });
  assert.deepEqual(outputRect(ed), { x: 0, y: 0, w: 100, h: 100 });
  undo(ed);
  assert.equal(ed.crop, null);
  assert.deepEqual(outputRect(ed), { x: 0, y: 0, w: 200, h: 200 });
  redo(ed);
  assert.deepEqual(ed.crop, { x: 0, y: 0, w: 100, h: 100 });
  undo(ed);
  undo(ed);
  assert.equal(paintOps(ed).length, 0);
  assert.equal(undo(ed), false);
});

test("a new op clears the redo stack", () => {
  const ed = createEditor(200, 200);
  addOp(ed, "ink", { x: 10, y: 10, w: 50, h: 20 });
  undo(ed);
  addOp(ed, "pixelate", { x: 0, y: 0, w: 30, h: 30 });
  assert.equal(redo(ed), false);
});

test("move and resize stay inside the frame", () => {
  const ed = createEditor(100, 100);
  const op = addOp(ed, "ink", { x: 80, y: 80, w: 15, h: 15 });
  moveOp(ed, op.id, 50, 50);
  assert.deepEqual(op.rect, { x: 85, y: 85, w: 15, h: 15 });
  resizeOp(ed, op.id, 100, 100);
  assert.deepEqual(op.rect, { x: 85, y: 85, w: 15, h: 15 });
  resizeOp(ed, op.id, -100, -100);
  assert.equal(op.rect.w, 4);
});

test("hit testing prefers the op drawn last", () => {
  const ed = createEditor(100, 100);
  const a = addOp(ed, "ink", { x: 10, y: 10, w: 40, h: 40 });
  const b = addOp(ed, "pixelate", { x: 30, y: 30, w: 40, h: 40 });
  assert.equal(hitOp(ed, 35, 35).id, b.id);
  assert.equal(hitOp(ed, 12, 12).id, a.id);
  assert.equal(hitOp(ed, 90, 10), null);
  removeOp(ed, b.id);
  assert.equal(hitOp(ed, 35, 35).id, a.id);
});

test("pixel cells stay chunky even for small regions", () => {
  assert.equal(pixelCell({ w: 40, h: 20 }), 16);
  assert.equal(pixelCell({ w: 800, h: 400 }), 50);
});
