// Canvas pipeline. Everything here draws; nothing here decides. The export
// path re-encodes through a canvas, which is what actually strips metadata:
// the encoder never sees the original file, only pixels.

import { paintOps, outputRect, pixelCell } from "./editor.js";

export const INK = "#0e0c0a";

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Reads the region back out of the target canvas so pixelation composes with
// whatever was drawn before it (base image, earlier ink).
export function pixelateRegion(ctx, canvas, rect, cell) {
  const cols = Math.max(1, Math.ceil(rect.w / cell));
  const rows = Math.max(1, Math.ceil(rect.h / cell));
  const small = makeCanvas(cols, rows);
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, cols, rows);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cols, rows, rect.x, rect.y, rect.w, rect.h);
  ctx.imageSmoothingEnabled = prev;
}

// The finished output: cropped frame, ops burned in, in image resolution.
export function bake(bitmap, editor) {
  const out = outputRect(editor);
  const canvas = makeCanvas(Math.round(out.w), Math.round(out.h));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, -out.x, -out.y);
  for (const op of paintOps(editor)) {
    const r = {
      x: Math.round(op.rect.x - out.x),
      y: Math.round(op.rect.y - out.y),
      w: Math.round(op.rect.w),
      h: Math.round(op.rect.h),
    };
    if (r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= canvas.width || r.y >= canvas.height) continue;
    if (op.type === "ink") {
      ctx.fillStyle = INK;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (op.type === "pixelate") {
      const clipped = {
        x: Math.max(0, r.x),
        y: Math.max(0, r.y),
        w: Math.min(canvas.width, r.x + r.w) - Math.max(0, r.x),
        h: Math.min(canvas.height, r.y + r.h) - Math.max(0, r.y),
      };
      if (clipped.w > 0 && clipped.h > 0) {
        pixelateRegion(ctx, canvas, clipped, pixelCell(op.rect));
      }
    }
  }
  return canvas;
}

export async function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality);
  });
}

// A 1/16-scale copy used to preview pixelation cheaply while editing.
export function makeMosaic(bitmap) {
  const w = Math.max(1, Math.round(bitmap.width / 16));
  const h = Math.max(1, Math.round(bitmap.height / 16));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}
