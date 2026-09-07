// The editor surface: one canvas, a view transform, and pointer/keyboard
// handling. Rectangles live in image coordinates; only this file converts
// between screen and image space.

import { addOp, hitOp, moveOp, resizeOp, removeOp, paintOps, normRect } from "./editor.js";
import { t } from "./i18n.js";

// focusedSuggestion is declared near the keyboard section below; render()
// reads it to draw the focused code outline solid and thick.

const HANDLE_PX = 12;
const INK = "#0e0c0a";

export function createCanvasView(host) {
  const { canvas, wrap } = host;
  const ctx = canvas.getContext("2d");
  const view = { scale: 1, tx: 0, ty: 0 };
  let selected = null;
  let cropDraft = null;
  let raf = 0;

  const dpr = () => Math.min(3, window.devicePixelRatio || 1);

  function sizeCanvas() {
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr()));
    const h = Math.max(1, Math.round(r.height * dpr()));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function fit() {
    const bmp = host.getBitmap();
    if (!bmp) return;
    sizeCanvas();
    const r = wrap.getBoundingClientRect();
    const pad = 12;
    const scale = Math.min((r.width - pad * 2) / bmp.width, (r.height - pad * 2) / bmp.height);
    view.scale = Math.min(scale, 4);
    view.tx = (r.width - bmp.width * view.scale) / 2;
    view.ty = (r.height - bmp.height * view.scale) / 2;
    requestRender();
  }

  const toImage = (sx, sy) => ({
    x: (sx - view.tx) / view.scale,
    y: (sy - view.ty) / view.scale,
  });

  function zoomAt(sx, sy, factor) {
    const before = toImage(sx, sy);
    view.scale = Math.max(0.02, Math.min(12, view.scale * factor));
    view.tx = sx - before.x * view.scale;
    view.ty = sy - before.y * view.scale;
    requestRender();
  }

  function requestRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  function drawRectPx(r) {
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  function render() {
    const bmp = host.getBitmap();
    sizeCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bmp) return;
    const d = dpr();
    ctx.setTransform(view.scale * d, 0, 0, view.scale * d, view.tx * d, view.ty * d);
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(bmp, 0, 0);

    const editor = host.getEditor();
    const mosaic = host.getMosaic();
    for (const op of paintOps(editor)) {
      const r = op.rect;
      if (op.type === "ink") {
        ctx.fillStyle = INK;
        drawRectPx(r);
      } else {
        if (mosaic) {
          const prev = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(mosaic, r.x / 16, r.y / 16, r.w / 16, r.h / 16, r.x, r.y, r.w, r.h);
          ctx.imageSmoothingEnabled = prev;
        } else {
          ctx.fillStyle = "rgba(20,20,20,0.85)";
          drawRectPx(r);
        }
      }
    }

    const px = 1 / view.scale;

    for (const s of host.getSuggestions()) {
      const dash = s === focusedSuggestion ? [] : [6 * px, 4 * px];
      const width = (s === focusedSuggestion ? 5 : 3) * px;
      // A single orange stroke reads at maybe 1.5:1 against a mid-tone
      // photo; a wider dark casing under it holds 3:1 against any content
      // the way route lines do on a map.
      ctx.setLineDash(dash);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = width + 2 * px;
      ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      ctx.strokeStyle = "#d98d4a";
      ctx.lineWidth = width;
      ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      ctx.setLineDash([]);
    }

    if (editor.crop) {
      dimOutside(editor.crop, bmp, px, "rgba(0,0,0,0.55)");
    }
    if (cropDraft) {
      const r = normRect(cropDraft, editor.width, editor.height);
      dimOutside(r, bmp, px, "rgba(0,0,0,0.35)");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    if (gesture?.kind === "draw" && gesture.draft) {
      const r = normRect(gesture.draft, editor.width, editor.height);
      ctx.fillStyle = host.getTool() === "ink" ? "rgba(14,12,10,0.75)" : "rgba(90,90,90,0.55)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#d98d4a";
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    if (selected && !selected.gone) {
      const r = selected.rect;
      ctx.strokeStyle = "#d98d4a";
      ctx.lineWidth = 2.5 * px;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#d98d4a";
      for (const [hx, hy] of handlePoints(r)) {
        const s = HANDLE_PX * px;
        ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
      }
    }
  }

  function dimOutside(r, bmp, px, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(0, 0, bmp.width, bmp.height);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  const handlePoints = (r) => [
    [r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y],
    [r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2],
    [r.x, r.y + r.h], [r.x + r.w / 2, r.y + r.h], [r.x + r.w, r.y + r.h],
  ];

  function handleAt(ix, iy) {
    if (!selected) return -1;
    const tol = (HANDLE_PX * 1.2) / view.scale;
    const pts = handlePoints(selected.rect);
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i][0] - ix) <= tol && Math.abs(pts[i][1] - iy) <= tol) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------- pointers

  const pointers = new Map();
  let gesture = null;

  function localPoint(ev) {
    const r = wrap.getBoundingClientRect();
    return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    focusedSuggestion = null;
    const { sx, sy } = localPoint(ev);
    pointers.set(ev.pointerId, { sx, sy });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        kind: "pinch",
        dist: Math.hypot(a.sx - b.sx, a.sy - b.sy),
        cx: (a.sx + b.sx) / 2,
        cy: (a.sy + b.sy) / 2,
      };
      return;
    }
    const p = toImage(sx, sy);
    const tool = host.getTool();
    const editor = host.getEditor();

    const hi = handleAt(p.x, p.y);
    if (hi >= 0) {
      gesture = { kind: "resize", handle: hi, start: { ...selected.rect }, px: p.x, py: p.y };
      return;
    }
    const suggestion = host.getSuggestions().find(
      (s) => p.x >= s.rect.x && p.x <= s.rect.x + s.rect.w && p.y >= s.rect.y && p.y <= s.rect.y + s.rect.h,
    );
    if (suggestion) {
      host.acceptSuggestion(suggestion);
      requestRender();
      return;
    }
    if (tool === "crop") {
      gesture = { kind: "crop", x0: p.x, y0: p.y };
      cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      return;
    }
    const hit = hitOp(editor, p.x, p.y);
    if (hit) {
      selected = hit;
      gesture = { kind: "move", px: p.x, py: p.y };
      host.onSelect(hit);
      requestRender();
      return;
    }
    selected = null;
    host.onSelect(null);
    gesture = { kind: "draw", x0: p.x, y0: p.y, draft: null };
    requestRender();
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const { sx, sy } = localPoint(ev);
    pointers.set(ev.pointerId, { sx, sy });
    if (gesture?.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const cx = (a.sx + b.sx) / 2;
      const cy = (a.sy + b.sy) / 2;
      if (gesture.dist > 0) zoomAt(cx, cy, dist / gesture.dist);
      view.tx += cx - gesture.cx;
      view.ty += cy - gesture.cy;
      gesture.dist = dist;
      gesture.cx = cx;
      gesture.cy = cy;
      requestRender();
      return;
    }
    if (!gesture) return;
    const p = toImage(sx, sy);
    const editor = host.getEditor();
    if (gesture.kind === "draw") {
      gesture.draft = { x: gesture.x0, y: gesture.y0, w: p.x - gesture.x0, h: p.y - gesture.y0 };
      requestRender();
      return;
    }
    if (gesture.kind === "crop") {
      cropDraft = { x: gesture.x0, y: gesture.y0, w: p.x - gesture.x0, h: p.y - gesture.y0 };
      host.onCropDraft(normRect(cropDraft, editor.width, editor.height));
      requestRender();
      return;
    }
    if (gesture.kind === "move" && selected) {
      moveOp(editor, selected.id, p.x - gesture.px, p.y - gesture.py);
      gesture.px = p.x;
      gesture.py = p.y;
      requestRender();
      return;
    }
    if (gesture.kind === "resize" && selected) {
      applyResize(gesture, p, editor);
      requestRender();
    }
  });

  // Handle indexes: 0 1 2 across the top, 3 4 the sides, 5 6 7 the bottom.
  function applyResize(g, p, editor) {
    const s = g.start;
    const dx = p.x - g.px;
    const dy = p.y - g.py;
    const left = [0, 3, 5].includes(g.handle);
    const right = [2, 4, 7].includes(g.handle);
    const top = [0, 1, 2].includes(g.handle);
    const bottom = [5, 6, 7].includes(g.handle);
    let { x, y, w, h } = selected.rect;
    if (right) w += dx;
    if (bottom) h += dy;
    if (left) {
      x += dx;
      w -= dx;
    }
    if (top) {
      y += dy;
      h -= dy;
    }
    if (w >= 4 && h >= 4) {
      const r = normRect({ x, y, w, h }, editor.width, editor.height);
      selected.rect.x = r.x;
      selected.rect.y = r.y;
      selected.rect.w = r.w;
      selected.rect.h = r.h;
    }
    g.px = p.x;
    g.py = p.y;
  }

  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    if (!gesture) return;
    const editor = host.getEditor();
    if (gesture.kind === "draw" && gesture.draft) {
      const op = addOp(editor, host.getTool(), gesture.draft);
      if (op) {
        selected = op;
        host.onSelect(op);
        host.onChange();
        host.announce(t("{tool} box added", { tool: host.getTool() === "ink" ? t("Ink") : t("Pixelate") }));
      }
    }
    if (gesture.kind === "move" || gesture.kind === "resize") host.onChange();
    gesture = null;
    requestRender();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const { sx, sy } = localPoint(ev);
      zoomAt(sx, sy, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false },
  );

  canvas.addEventListener("dblclick", () => fit());

  // ---------------------------------------------------------- keyboard

  // Where a rect sits, in words a screen reader can place.
  function describeRect(r) {
    const editor = host.getEditor();
    const pct = (v, total) => Math.round((v / total) * 100);
    return t("{x}% across, {y}% down, covering {w}% by {h}%", {
      x: pct(r.x, editor.width),
      y: pct(r.y, editor.height),
      w: pct(r.w, editor.width),
      h: pct(r.h, editor.height),
    });
  }

  // Tab cycles code suggestions first, then boxes, so nothing on the canvas
  // is pointer-only. Focus is the module's selected/focusedSuggestion pair.
  let focusedSuggestion = null;

  // Returns false when the cycle walks off either end, so Tab can leave
  // the canvas instead of trapping keyboard focus on it forever.
  function cycleFocus(dir) {
    const editor = host.getEditor();
    const suggestions = host.getSuggestions();
    const ops = paintOps(editor);
    const ring = [...suggestions.map((s) => ({ kind: "s", item: s })), ...ops.map((o) => ({ kind: "o", item: o }))];
    if (!ring.length) return false;
    const at = ring.findIndex(
      (e) => (e.kind === "s" && e.item === focusedSuggestion) || (e.kind === "o" && e.item === selected),
    );
    const nextIdx = at === -1 ? (dir === 1 ? 0 : ring.length - 1) : at + dir;
    if (nextIdx >= ring.length || nextIdx < 0) {
      selected = null;
      focusedSuggestion = null;
      host.onSelect(null);
      requestRender();
      return false;
    }
    const next = ring[nextIdx];
    focusedSuggestion = next.kind === "s" ? next.item : null;
    selected = next.kind === "o" ? next.item : null;
    const idx = ring.indexOf(next) + 1;
    if (next.kind === "s") {
      host.announce(
        t("Code suggestion {n} of {total}: {where}. Press Enter to cover it.", {
          n: idx,
          total: ring.length,
          where: describeRect(next.item.rect),
        }),
      );
    } else {
      const label = next.item.type === "ink" ? t("Ink") : t("Pixelate");
      host.announce(
        t("{tool} box {n} of {total}: {where}", { tool: label, n: idx, total: ring.length, where: describeRect(next.item.rect) }),
      );
    }
    host.onSelect(selected);
    requestRender();
    return true;
  }

  let announceTimer = 0;
  function announceSelected() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (selected) host.announce(describeRect(selected.rect));
      else if (cropDraft) host.announce(t("Keeping {where}", { where: describeRect(normRect(cropDraft, host.getEditor().width, host.getEditor().height)) }));
    }, 350);
  }

  canvas.addEventListener("keydown", (ev) => {
    const editor = host.getEditor();
    const step = ev.ctrlKey ? 1 : Math.max(2, Math.round(8 / view.scale));
    const key = ev.key;
    if (key === "Tab") {
      // Only consumed while there is something to cycle to; at the ends
      // (and on an empty canvas) focus moves on normally.
      if (cycleFocus(ev.shiftKey ? -1 : 1)) ev.preventDefault();
      return;
    }
    if (key === "Enter" && focusedSuggestion) {
      host.acceptSuggestion(focusedSuggestion);
      focusedSuggestion = null;
      requestRender();
      ev.preventDefault();
      return;
    }
    if (key === "b" || key === "B") {
      if (host.getTool() === "crop") {
        // Seed a centered crop draft the arrow keys can then shape.
        const w = editor.width * 0.8;
        const h = editor.height * 0.8;
        cropDraft = { x: (editor.width - w) / 2, y: (editor.height - h) / 2, w, h };
        host.onCropDraft(normRect(cropDraft, editor.width, editor.height));
        host.announce(
          t("Crop draft covers the middle {pct}% of the image. Arrows move it, Shift and arrows resize, then Apply crop.", { pct: 80 }),
        );
        requestRender();
      } else {
        addKeyboardBox();
      }
      ev.preventDefault();
      return;
    }
    if ((key === "Delete" || key === "Backspace") && selected) {
      removeOp(editor, selected.id);
      selected = null;
      host.onChange();
      host.onSelect(null);
      host.announce(t("Box removed"));
      requestRender();
      ev.preventDefault();
      return;
    }
    if (key === "Escape") {
      selected = null;
      focusedSuggestion = null;
      host.onSelect(null);
      host.announce(t("Selection cleared"));
      requestRender();
      return;
    }
    if (key === "+" || key === "=") {
      const r = wrap.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, 1.25);
      return;
    }
    if (key === "-") {
      const r = wrap.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, 0.8);
      return;
    }
    if (key === "0") {
      fit();
      return;
    }
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[key]) {
      const [dx, dy] = dirs[key];
      if (host.getTool() === "crop" && cropDraft) {
        if (ev.shiftKey) {
          cropDraft.w += dx * step * 4;
          cropDraft.h += dy * step * 4;
        } else {
          cropDraft.x += dx * step * 4;
          cropDraft.y += dy * step * 4;
        }
        host.onCropDraft(normRect(cropDraft, editor.width, editor.height));
        announceSelected();
        requestRender();
      } else if (selected) {
        if (ev.shiftKey) resizeOp(editor, selected.id, dx * step, dy * step);
        else moveOp(editor, selected.id, dx * step, dy * step);
        host.onChange();
        announceSelected();
        requestRender();
      } else {
        // Nothing selected: arrows pan the view, which zoom needs anyway.
        view.tx -= dx * 60;
        view.ty -= dy * 60;
        requestRender();
      }
      ev.preventDefault();
    }
  });

  function addKeyboardBox() {
    const editor = host.getEditor();
    const bmp = host.getBitmap();
    if (!bmp) return;
    const r = wrap.getBoundingClientRect();
    const center = toImage(r.width / 2, r.height / 2);
    const w = Math.round(editor.width / 5);
    const h = Math.round(editor.height / 8);
    const tool = host.getTool() === "crop" ? "ink" : host.getTool();
    const op = addOp(editor, tool, { x: center.x - w / 2, y: center.y - h / 2, w, h });
    if (op) {
      selected = op;
      host.onSelect(op);
      host.onChange();
      host.announce(
        t("Cover box added at the center. Arrow keys move it, Shift and arrows resize, Delete removes."),
      );
      requestRender();
    }
  }

  const ro = new ResizeObserver(() => {
    sizeCanvas();
    requestRender();
  });
  ro.observe(wrap);

  return {
    fit,
    render: requestRender,
    clearSelection() {
      selected = null;
      focusedSuggestion = null;
      host.onSelect(null);
      requestRender();
    },
    getSelected: () => selected,
    deleteSelected() {
      if (!selected) return;
      removeOp(host.getEditor(), selected.id);
      selected = null;
      host.onChange();
      host.onSelect(null);
      host.announce(t("Box removed"));
      requestRender();
    },
    setCropDraft(r) {
      cropDraft = r;
      requestRender();
    },
    getCropDraft: () => (cropDraft ? normRect(cropDraft, host.getEditor().width, host.getEditor().height) : null),
    addKeyboardBox,
    destroy() {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
