// Boot and flow. One session at a time: bytes in, X-ray, edit, bake, verify,
// hand back. Image data lives in RAM only; closing a session closes the
// bitmaps and releases every object URL.

import { inspectImage } from "./inspect.js";
import { createEditor, undo, redo, setCrop, addOp, paintOps } from "./editor.js";
import { bake, encode, makeMosaic } from "./render.js";
import { verifyClean } from "./verify.js";
import { scrubbedName, nameLeaks } from "./names.js";
import { findCodes, codesSupported } from "./barcodes.js";
import { createCanvasView } from "./canvasview.js";
import { isWrapper, wrapperVersion, shareOut, saveOut, sharedToken, onShared } from "./platform.js";
import { setLocale, resolveLocale, translateDom, t } from "./i18n.js";
import { $, toast, announce, showScreen, riskPill, renderXray, setXrayOpen, renderProof, copyGpsAction } from "./ui.js";

const VERSION = "0.1.0";

globalThis.__sepiaErrors = [];
window.addEventListener("error", (ev) => __sepiaErrors.push(String(ev.message)));
window.addEventListener("unhandledrejection", (ev) => __sepiaErrors.push(String(ev.reason)));
document.addEventListener("securitypolicyviolation", (ev) =>
  __sepiaErrors.push(`csp: ${ev.violatedDirective} ${ev.blockedURI}`),
);

// ------------------------------------------------------------------ state

let session = null;
let queue = [];
let view = null;
let tool = "ink";
let closeArmed = false;

const app = {
  get state() {
    return {
      screen: ["start", "edit", "done"].find((s) => !$(`screen-${s}`).hidden) || "none",
      hasSession: !!session,
      ops: session ? paintOps(session.editor).length : 0,
      report: session?.report ?? null,
      queue: queue.length,
      wrapper: isWrapper(),
      version: VERSION,
    };
  },
  openBytes,
  session: () => session,
};
globalThis.__sepiaApi = app;

// ------------------------------------------------------------------ intake

async function decodeBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // Some formats decode through an element but not createImageBitmap.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function openBytes(bytes, name = "", mime = "") {
  closeSession();
  let report;
  try {
    report = await inspectImage(bytes);
  } catch (err) {
    __sepiaErrors.push(`inspect: ${err}`);
    report = { ok: false, items: [], counts: { high: 0, medium: 0, low: 0 }, gps: null, thumbnail: null, trailer: null, format: "unknown" };
  }
  let bitmap;
  try {
    bitmap = await decodeBitmap(new Blob([bytes], { type: mime || undefined }));
  } catch {
    toast(t("Could not open this image. HEIC and RAW files need converting first; sharing from your gallery usually converts automatically."), 6000);
    return false;
  }
  session = {
    bytes,
    name,
    report,
    bitmap,
    mosaic: makeMosaic(bitmap),
    editor: createEditor(bitmap.width, bitmap.height),
    suggestions: [],
    exported: null,
  };
  showScreen("edit");
  riskPill(report);
  renderXray(report, { copyGps: copyGpsAction });
  updateUndoRedo();
  view.fit();
  $("canvas").focus({ preventScroll: true });
  if (report.counts.high > 0) {
    setXrayOpen(true);
    announce(t("{count} serious leaks found. The X-ray panel lists them.", { count: report.counts.high }));
  } else {
    setXrayOpen(false);
  }
  scanCodes();
  return true;
}

async function openFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  if (!images.length) {
    toast(t("That does not look like an image."));
    return;
  }
  queue = images.slice(1);
  const first = images[0];
  await openBytes(new Uint8Array(await first.arrayBuffer()), first.name, first.type);
}

async function openDemo() {
  try {
    const res = await fetch("demo/sample.jpg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    await openBytes(bytes, "IMG_20260214_093122.jpg", "image/jpeg");
    toast(t("A sample photo with everything wrong with it. Open the X-ray."), 5000);
  } catch {
    toast(t("The sample image is missing."));
  }
}

async function openSharedToken(token) {
  try {
    const res = await fetch(`/shared/${token}`);
    if (!res.ok) throw new Error(String(res.status));
    const bytes = new Uint8Array(await res.arrayBuffer());
    await openBytes(bytes, "", res.headers.get("content-type") || "");
  } catch (err) {
    __sepiaErrors.push(`shared: ${err}`);
    toast(t("Could not read the shared image."));
  }
}

function closeSession() {
  if (!session) return;
  session.bitmap?.close?.();
  session = null;
  riskPill(null);
  setXrayOpen(false);
}

// ------------------------------------------------------------------ codes

async function scanCodes() {
  if (!session) return;
  $("btn-codes").hidden = !codesSupported();
  if (!codesSupported()) return;
  const { codes } = await findCodes(session.bitmap);
  if (!session) return;
  session.suggestions = codes.map((c) => ({
    rect: {
      x: Math.max(0, c.rect.x - 6),
      y: Math.max(0, c.rect.y - 6),
      w: c.rect.w + 12,
      h: c.rect.h + 12,
    },
    format: c.format,
  }));
  if (codes.length) {
    toast(t("{count} scannable code(s) found. Tap the outline to cover one.", { count: codes.length }), 5000);
    announce(t("{count} scannable code(s) found and outlined on the image.", { count: codes.length }));
  }
  view.render();
}

// ------------------------------------------------------------------ editor

function updateUndoRedo() {
  if (!session) return;
  $("btn-undo").disabled = session.editor.ops.length === 0;
  $("btn-redo").disabled = session.editor.undone.length === 0;
}

function setTool(next) {
  tool = next;
  for (const btn of document.querySelectorAll(".tool[data-tool]")) {
    const active = btn.dataset.tool === next;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  $("pixelate-note").hidden = next !== "pixelate";
  $("crop-bar").hidden = next !== "crop";
}

// ------------------------------------------------------------------ export

async function runExport() {
  if (!session) return;
  const srcIsPng = session.report.format === "png" || session.report.format === "gif" || session.report.format === "bmp";
  const type = session.exported?.type || (srcIsPng ? "image/png" : "image/jpeg");
  await reExport(type, Number($("q-slider").value) / 100);
  showScreen("done");
  announce($("done-title").textContent);
}

async function reExport(type, quality) {
  const canvas = bake(session.bitmap, session.editor);
  const blob = await encode(canvas, type, type === "image/jpeg" ? quality : undefined);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const verify = await verifyClean(bytes);
  const name = scrubbedName(type);
  session.exported = { blob, bytes, verify, name, type };
  renderProof({
    report: session.report,
    opsCount: paintOps(session.editor).length,
    cropUsed: !!session.editor.crop,
    verify,
    blob,
    name,
    origName: nameLeaks(session.name) ? session.name : "",
  });
  document.querySelector(`input[name="fmt"][value="${type}"]`).checked = true;
  $("q-wrap").hidden = type !== "image/jpeg";
}

// ------------------------------------------------------------------ boot

function stripWebOnly() {
  for (const node of document.querySelectorAll(".web-only")) node.remove();
  $("about-site").hidden = false;
  // Phones have no Ctrl+V and no desktop drag; the everyday path is the
  // share sheet.
  $("drop-hint").textContent = t("or share a photo to Sepia from any app");
}

function wireEvents() {
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) openFiles(fileInput.files);
    fileInput.value = "";
  });
  for (const [enter, cls] of [["dragover", true], ["dragleave", false], ["drop", false]]) {
    document.addEventListener(enter, (ev) => {
      if (enter !== "dragleave" && ![...(ev.dataTransfer?.types || [])].includes("Files")) return;
      ev.preventDefault();
      dropzone.classList.toggle("dragging", cls);
      if (enter === "drop" && ev.dataTransfer.files.length) openFiles(ev.dataTransfer.files);
    });
  }
  document.addEventListener("paste", (ev) => {
    const files = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      ev.preventDefault();
      openFiles(files);
    }
  });
  $("btn-demo").addEventListener("click", openDemo);

  $("btn-close").addEventListener("click", () => {
    if (session && paintOps(session.editor).length > 0 && !closeArmed) {
      closeArmed = true;
      toast(t("Your covers are not exported yet. Tap close again to discard them."), 4000);
      setTimeout(() => {
        closeArmed = false;
      }, 4000);
      return;
    }
    closeArmed = false;
    closeSession();
    queue = [];
    showScreen("start");
  });

  $("btn-undo").addEventListener("click", () => {
    undo(session.editor);
    updateUndoRedo();
    view.clearSelection();
  });
  $("btn-redo").addEventListener("click", () => {
    redo(session.editor);
    updateUndoRedo();
    view.render();
  });

  for (const btn of document.querySelectorAll(".tool[data-tool]")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  }
  $("btn-codes").addEventListener("click", scanCodes);

  $("btn-crop-apply").addEventListener("click", () => {
    const draft = view.getCropDraft();
    if (!draft || !setCrop(session.editor, draft)) {
      toast(t("Drag across the image first to choose what to keep."));
      return;
    }
    view.setCropDraft(null);
    setTool("ink");
    updateUndoRedo();
    announce(t("Crop applied. Everything outside the bright area will be removed on export."));
  });
  $("btn-crop-cancel").addEventListener("click", () => {
    view.setCropDraft(null);
    setTool("ink");
  });

  $("btn-xray").addEventListener("click", () => setXrayOpen($("xray").hidden));
  $("btn-xray-close").addEventListener("click", () => setXrayOpen(false));

  $("btn-export").addEventListener("click", runExport);

  for (const radio of document.querySelectorAll('input[name="fmt"]')) {
    radio.addEventListener("change", () => reExport(radio.value, Number($("q-slider").value) / 100));
  }
  $("q-slider").addEventListener("change", () => reExport("image/jpeg", Number($("q-slider").value) / 100));

  $("btn-share").addEventListener("click", async () => {
    const ok = await shareOut(session.exported.blob, session.exported.name);
    if (!ok) {
      await saveOut(session.exported.blob, session.exported.name);
      toast(t("Sharing is not available here, so it downloaded instead."));
    }
  });
  $("btn-save").addEventListener("click", async () => {
    const how = await saveOut(session.exported.blob, session.exported.name);
    toast(how === "gallery" ? t("Saved to your photos") : t("Downloaded"));
  });

  $("btn-again").addEventListener("click", () => {
    closeSession();
    queue = [];
    showScreen("start");
  });
  const nextBtn = $("btn-next");
  nextBtn.addEventListener("click", async () => {
    const file = queue.shift();
    if (file) await openBytes(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  });

  window.addEventListener("popstate", () => {
    const hash = location.hash;
    if (hash === "#edit" && session) showScreen("edit");
    else if (hash === "#done" && session?.exported) showScreen("done");
    else {
      closeSession();
      showScreen("start");
    }
  });
}

function updateNextButton() {
  const nextBtn = $("btn-next");
  nextBtn.hidden = queue.length === 0;
  if (queue.length) nextBtn.textContent = t("Next image ({count} left)", { count: queue.length });
}

// Re-render the queue button whenever the done screen shows.
new MutationObserver(updateNextButton).observe($("screen-done"), {
  attributes: true,
  attributeFilter: ["hidden"],
});

async function boot() {
  setLocale(resolveLocale(localStorage.getItem("sepia-locale") || "auto"));
  translateDom();

  if (isWrapper()) {
    stripWebOnly();
  } else if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const ver = $("ver");
  if (ver) ver.textContent = `v${VERSION}${isWrapper() ? ` · app ${wrapperVersion()}` : ""}`;

  view = createCanvasView({
    canvas: $("canvas"),
    wrap: $("canvas-wrap"),
    getBitmap: () => session?.bitmap ?? null,
    getMosaic: () => session?.mosaic ?? null,
    getEditor: () => session?.editor ?? createEditor(1, 1),
    getTool: () => tool,
    getSuggestions: () => session?.suggestions ?? [],
    acceptSuggestion: (s) => {
      session.suggestions = session.suggestions.filter((x) => x !== s);
      addOp(session.editor, "ink", s.rect);
      updateUndoRedo();
      announce(t("Code covered with ink"));
    },
    onChange: updateUndoRedo,
    onSelect: () => {},
    onCropDraft: () => {},
    announce,
  });

  wireEvents();
  setTool("ink");
  showScreen("start");

  onShared((token) => openSharedToken(token));
  const token = sharedToken();
  if (token) await openSharedToken(token);

  // A share_target launch lands with ?share-target=1; the worker parked the
  // file in the cache for exactly one pickup.
  if (new URLSearchParams(location.search).has("share-target")) {
    try {
      const cache = await caches.open("sepia-share");
      const res = await cache.match("/share-incoming");
      if (res) {
        await cache.delete("/share-incoming");
        const bytes = new Uint8Array(await res.arrayBuffer());
        await openBytes(bytes, "", res.headers.get("content-type") || "");
      }
    } catch (err) {
      __sepiaErrors.push(`share-target: ${err}`);
    }
    history.replaceState(null, "", location.pathname);
  }
}

boot();
