// Redaction editor state. Pure data and geometry: rectangles live in image
// pixel coordinates, the canvas layer renders them, the export step burns
// them. No DOM, no canvas here, so all of it runs under node's test runner.

let nextId = 1;

export function createEditor(width, height) {
  return {
    width,
    height,
    ops: [],
    crop: null,
    undone: [],
  };
}

// Drag rectangles arrive in any direction and can spill off the canvas.
export function normRect(rect, width, height) {
  let { x, y, w, h } = rect;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = Math.max(0, Math.min(x, width));
  const y0 = Math.max(0, Math.min(y, height));
  const x1 = Math.max(0, Math.min(x + w, width));
  const y1 = Math.max(0, Math.min(y + h, height));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const MIN_SIZE = 4;

export function addOp(editor, type, rect) {
  const r = normRect(rect, editor.width, editor.height);
  if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
  const op = { id: nextId++, type, rect: r };
  editor.ops.push(op);
  editor.undone = [];
  return op;
}

export function setCrop(editor, rect) {
  const r = normRect(rect, editor.width, editor.height);
  if (r.w < MIN_SIZE * 4 || r.h < MIN_SIZE * 4) return null;
  editor.undone = [];
  const prev = editor.crop;
  editor.crop = r;
  editor.ops.push({ id: nextId++, type: "crop", rect: r, prev });
  return editor.crop;
}

export function undo(editor) {
  const op = editor.ops.pop();
  if (!op) return false;
  if (op.type === "crop") editor.crop = op.prev ?? null;
  editor.undone.push(op);
  return true;
}

export function redo(editor) {
  const op = editor.undone.pop();
  if (!op) return false;
  if (op.type === "crop") editor.crop = op.rect;
  editor.ops.push(op);
  return true;
}

export function removeOp(editor, id) {
  const idx = editor.ops.findIndex((o) => o.id === id && o.type !== "crop");
  if (idx === -1) return false;
  editor.ops.splice(idx, 1);
  return true;
}

export const paintOps = (editor) => editor.ops.filter((o) => o.type !== "crop");

export function moveOp(editor, id, dx, dy) {
  const op = editor.ops.find((o) => o.id === id && o.type !== "crop");
  if (!op) return false;
  const r = op.rect;
  r.x = Math.max(0, Math.min(editor.width - r.w, r.x + dx));
  r.y = Math.max(0, Math.min(editor.height - r.h, r.y + dy));
  return true;
}

export function resizeOp(editor, id, dw, dh) {
  const op = editor.ops.find((o) => o.id === id && o.type !== "crop");
  if (!op) return false;
  const r = op.rect;
  r.w = Math.max(MIN_SIZE, Math.min(editor.width - r.x, r.w + dw));
  r.h = Math.max(MIN_SIZE, Math.min(editor.height - r.y, r.h + dh));
  return true;
}

export function hitOp(editor, x, y) {
  for (let i = editor.ops.length - 1; i >= 0; i--) {
    const o = editor.ops[i];
    if (o.type === "crop") continue;
    const r = o.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return o;
  }
  return null;
}

// Pixelation cells sized from the region so a big region gets big cells.
// Small cells on text are reversible; the floor keeps every cell chunky and
// the UI still warns that ink is the safe tool for text.
export function pixelCell(rect) {
  return Math.max(16, Math.round(Math.min(rect.w, rect.h) / 8));
}

// What the exported image will be: the crop area, or the full frame.
export function outputRect(editor) {
  return editor.crop ?? { x: 0, y: 0, w: editor.width, h: editor.height };
}
