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
import { isWrapper, isBundled, isIOSWrapped, wrapperVersion, shareOut, saveOut, sharedTokens, onShared } from "./platform.js";
import { setLocale, resolveLocale, translateDom, t, LOCALE_CHOICES, currentLocale } from "./i18n.js";
import {
  $, toast, announce, showScreen, riskPill, renderXray, setXrayOpen, renderProof, releaseUrls,
  copyGpsAction, copyImageAction, renderTriage, markTriageRow, renderBatchDone,
} from "./ui.js";

const VERSION = "0.3.0";

globalThis.__sepiaErrors = [];
window.addEventListener("error", (ev) => __sepiaErrors.push(String(ev.message)));
window.addEventListener("unhandledrejection", (ev) => __sepiaErrors.push(String(ev.reason)));
document.addEventListener("securitypolicyviolation", (ev) =>
  __sepiaErrors.push(`csp: ${ev.violatedDirective} ${ev.blockedURI}`),
);

// ------------------------------------------------------------------ state

let session = null;
// Entries are { kind: "file", file } or { kind: "token", token }: shared-in
// images from the wrapper queue exactly like picked files.
let queue = [];
let view = null;
let tool = "ink";
let closeArmed = false;
// "close" | "again" | null. Which trigger button is currently swapped for
// its inline "Discard" confirm; see armDiscard/disarmDiscard below.
let armedFor = null;
let xrayAutoOpened = false;
let lastFormat = null;
// Filled in by runBatchScrub, read by the "Save all" button; cleared on the
// next queue so a stale batch's downloads cannot resurface later. Also
// exposed on window (like __sepiaApi) so e2e can re-verify the exported
// bytes of every batch member outside the app, not just the last one.
let batchResults = [];
function setBatchResults(next) {
  batchResults = next;
  globalThis.__sepiaBatchResults = batchResults;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Discarding work needs an explicit second action, not a decaying timer: a
// screen-reader or motor-impaired user who takes longer than a few seconds
// to find the confirm control must not have the warning vanish under them.
// The trigger button hides and an inline "Discard" button takes its place,
// staying until it is pressed or something disarms it.
function disarmDiscard() {
  if (!armedFor) return;
  armedFor = null;
  closeArmed = false;
  $("btn-close").hidden = false;
  $("btn-close-confirm").hidden = true;
  $("btn-again").hidden = false;
  $("btn-again-confirm").hidden = true;
}

function armDiscard(which) {
  armedFor = which;
  closeArmed = true;
  const extra = queue.length ? t(" {count} queued images will be dropped too.", { count: queue.length }) : "";
  announce(t("Your covers are not exported yet.") + extra);
  const trigger = $(`btn-${which}`);
  const confirm = $(`btn-${which}-confirm`);
  trigger.hidden = true;
  confirm.hidden = false;
  confirm.focus();
}

const app = {
  get state() {
    return {
      screen: ["start", "edit", "done", "triage", "batch"].find((s) => !$(`screen-${s}`).hidden) || "none",
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
    report = { ok: false, analyzed: false, incomplete: true, items: [], counts: { high: 0, medium: 0, low: 0 }, gps: null, thumbnail: null, trailer: null, format: "unknown" };
  }
  let bitmap;
  try {
    bitmap = await decodeBitmap(new Blob([bytes], { type: mime || undefined }));
  } catch {
    const supported = ["jpeg", "png", "webp", "gif", "bmp"].includes(report.format);
    toast(
      supported
        ? t("This file looks damaged or cut short; it could not be opened.")
        : t("Could not open this image. HEIC and RAW files need converting first; sharing from your gallery usually converts automatically."),
      6000,
    );
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
  updateQueueUi();
  view.fit();
  $("canvas").focus({ preventScroll: true });
  // The drawer auto-opens for the first worrying image only: on the 40th
  // photo of a batch it is a speed bump, not news.
  if (report.counts.high > 0 && !xrayAutoOpened) {
    xrayAutoOpened = true;
    setXrayOpen(true);
    announce(t("{count} serious leaks found. The X-ray panel lists them.", { count: report.counts.high }));
  } else {
    setXrayOpen(false);
  }
  scanCodes();
  return true;
}

async function openEntry(entry) {
  try {
    if (entry.kind === "file") {
      return await openBytes(new Uint8Array(await entry.file.arrayBuffer()), entry.file.name, entry.file.type);
    }
    const res = await fetch(`/shared/${entry.token}`);
    if (!res.ok) throw new Error(String(res.status));
    return await openBytes(new Uint8Array(await res.arrayBuffer()), "", res.headers.get("content-type") || "");
  } catch (err) {
    __sepiaErrors.push(`open: ${err}`);
    toast(t("Could not read the shared image."));
    return false;
  }
}

// Opens the next workable entry, skipping ones that fail to decode.
async function advanceQueue() {
  while (queue.length) {
    const entry = queue.shift();
    if (await openEntry(entry)) return true;
  }
  closeSession();
  showScreen("start");
  return false;
}

// Single entry point for every intake path (picked files, drag-drop,
// share-target, the wrapper's share queue). One image goes straight into the
// editor exactly as it always has; more than one stops at triage first, so
// the existing single-image flow never gains a screen it did not have.
async function enterQueue(entries) {
  queue = entries;
  xrayAutoOpened = false;
  setBatchResults([]);
  if (queue.length > 1) {
    showScreen("triage");
    renderTriage(queue);
    return;
  }
  await advanceQueue();
}

async function openFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  if (!images.length) {
    toast(t("That does not look like an image."));
    return;
  }
  await enterQueue(images.map((file) => ({ kind: "file", file })));
}

// Reads one queue entry's bytes without touching session state: used by the
// batch path, which never opens an editing session for the images it scrubs.
async function readEntryBytes(entry) {
  if (entry.kind === "file") {
    const file = entry.file;
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, mime: file.type };
  }
  // Not a network call: same-origin /shared/<token> is the wrapper's local
  // hand-off, served by the Android WebViewAssetLoader (see openEntry
  // above, which does the identical fetch for the single-image path).
  const res = await fetch(`/shared/${entry.token}`);
  if (!res.ok) throw new Error(String(res.status));
  return { bytes: new Uint8Array(await res.arrayBuffer()), name: "", mime: res.headers.get("content-type") || "" };
}

// Metadata-only scrub of one queue entry: decode, re-encode through the same
// bake()/encode() path a hand-edited export uses but with an untouched
// editor (no ops, no crop), then verify the output the same way. Any failure
// at any step fails that file closed (excluded from "clean", never silently
// counted) without aborting the rest of the batch.
async function scrubOne(entry, index) {
  let bytes, name, mime;
  try {
    ({ bytes, name, mime } = await readEntryBytes(entry));
  } catch (err) {
    __sepiaErrors.push(`batch-read ${index}: ${err}`);
    return { name: entry.kind === "file" ? entry.file.name : "", ok: false, reason: t("Could not read this file.") };
  }
  let report;
  try {
    report = await inspectImage(bytes);
  } catch (err) {
    __sepiaErrors.push(`batch-inspect ${index}: ${err}`);
    return { name, ok: false, reason: t("Could not read this file's structure.") };
  }
  let bitmap;
  try {
    bitmap = await decodeBitmap(new Blob([bytes], { type: mime || undefined }));
  } catch {
    return { name, ok: false, reason: t("Could not open this image.") };
  }
  try {
    const editor = createEditor(bitmap.width, bitmap.height);
    const srcIsPng = report.format === "png" || report.format === "gif" || report.format === "bmp";
    const type = srcIsPng ? "image/png" : "image/jpeg";
    const canvas = bake(bitmap, editor);
    const blob = await encode(canvas, type, type === "image/jpeg" ? 0.9 : undefined);
    const outBytes = new Uint8Array(await blob.arrayBuffer());
    const verify = await verifyClean(outBytes);
    return { name, ok: true, outName: scrubbedName(type), blob, verify, type };
  } catch (err) {
    __sepiaErrors.push(`batch-export ${index}: ${err}`);
    return { name, ok: false, reason: t("Could not encode this image.") };
  } finally {
    bitmap?.close?.();
  }
}

async function runBatchScrub() {
  const entries = queue.slice();
  queue = [];
  const results = entries.map(() => null);
  setBatchResults(results);
  $("btn-scrub-all").disabled = true;
  $("btn-triage-each").disabled = true;
  announce(t("Scrubbing {count} images…", { count: entries.length }));
  for (let i = 0; i < entries.length; i++) {
    const result = await scrubOne(entries[i], i);
    results[i] = result;
    markTriageRow(i, result);
  }
  $("btn-scrub-all").disabled = false;
  $("btn-triage-each").disabled = false;
  showScreen("batch");
  renderBatchDone(results, { saveOne: (r) => saveOut(r.blob, r.outName) });
  announce($("batch-title").textContent);
}

async function openDemo() {
  try {
    const res = await fetch("demo/sample.jpg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    xrayAutoOpened = false;
    await openBytes(bytes, "IMG_20260214_093122.jpg", "image/jpeg");
    toast(t("A sample photo with everything wrong with it. This list is what it leaks."), 5000);
  } catch {
    toast(t("The sample image is missing."));
  }
}

function closeSession() {
  if (!session) return;
  session.bitmap?.close?.();
  session = null;
  releaseUrls();
  riskPill(null);
  setXrayOpen(false);
  disarmDiscard();
}

function resetAll() {
  closeSession();
  queue = [];
  xrayAutoOpened = false;
  showScreen("start");
}

// A session left open in a background tab or app is a sensitive image
// sitting on someone's screen whenever they come back. After long enough,
// coming back should show the start screen, not the photo.
const BACKGROUND_CLOSE_MS = 15 * 60 * 1000;
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  if (session && hiddenAt && Date.now() - hiddenAt > BACKGROUND_CLOSE_MS) {
    resetAll();
    toast(t("Closed the image after a long time in the background, for privacy."), 6000);
  }
});

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

function updateQueueUi() {
  const skip = $("btn-skip");
  skip.hidden = queue.length === 0;
  if (queue.length) skip.textContent = t("Skip ({count} left)", { count: queue.length });
}

// Every editor mutation lands here: an export made before this moment no
// longer matches the canvas, so it must not stay shareable through history
// navigation or a slow in-flight encode.
function editorChanged() {
  if (session) session.exported = null;
  exportGen++;
  updateUndoRedo();
  updateDeleteChip();
}

// A button that disables itself under the keyboard user's focus strands
// them on an unfocusable element.
function rescueFocus() {
  if (document.activeElement?.disabled) $("canvas").focus({ preventScroll: true });
}

// Touch users cannot press Delete; a selected box gets a visible remove
// control instead.
function updateDeleteChip() {
  $("btn-del-box").hidden = !view?.getSelected();
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
  const type = session.exported?.type || lastFormat || (srcIsPng ? "image/png" : "image/jpeg");
  if (await reExport(type, Number($("q-slider").value) / 100)) {
    showScreen("done");
    announce($("done-title").textContent);
  }
}

// Serialized by generation: a slower encode finishing after a newer one
// must not overwrite the export the user actually asked for last.
let exportGen = 0;

async function reExport(type, quality) {
  const gen = ++exportGen;
  const btn = $("btn-export");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t("Scrubbing…");
  announce(t("Scrubbing…"));
  let blob;
  let bytes;
  try {
    const canvas = bake(session.bitmap, session.editor);
    blob = await encode(canvas, type, type === "image/jpeg" ? quality : undefined);
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (err) {
    __sepiaErrors.push(`export: ${err}`);
    toast(t("Could not encode this image. It may be too large for this device; try cropping first."), 6000);
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
  if (gen !== exportGen || !session) return false;
  const verify = await verifyClean(bytes);
  if (gen !== exportGen || !session) return false;
  const name = scrubbedName(type);
  session.exported = { blob, bytes, verify, name, type };
  lastFormat = type;
  renderProof({
    report: session.report,
    editor: session.editor,
    verify,
    blob,
    name,
    origName: nameLeaks(session.name) ? session.name : "",
  });
  document.querySelector(`input[name="fmt"][value="${type}"]`).checked = true;
  $("q-wrap").hidden = type !== "image/jpeg";
  return true;
}

// ------------------------------------------------------------------ boot

function stripWebOnly() {
  for (const node of document.querySelectorAll(".web-only")) node.remove();
  $("about-site").hidden = false;
}

// The intake hint should describe this device, not a desktop. The iOS
// wrapper gets its own line: it has no share-sheet intake (no bridge for
// it), so it must not promise the Android wrapper's "share to Sepia".
function fitHintToDevice() {
  if (isWrapper()) {
    $("drop-hint").textContent = t("or share a photo to Sepia from any app");
  } else if (isIOSWrapped()) {
    $("drop-hint").textContent = t("or pick one from your photos");
  } else if (navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches) {
    $("drop-hint").textContent = t("or share an image to Sepia once installed");
  }
}

function buildLocalePicker() {
  const select = $("locale-pick");
  for (const { id, label } of LOCALE_CHOICES) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    select.append(opt);
  }
  let pref = "auto";
  try {
    pref = localStorage.getItem("sepia-locale") || "auto";
  } catch {}
  select.value = pref;
  select.addEventListener("change", () => {
    try {
      localStorage.setItem("sepia-locale", select.value);
    } catch {}
    setLocale(resolveLocale(select.value));
    translateDom();
    fitHintToDevice();
    updateQueueUi();
  });
}

function wireEvents() {
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("pointerdown", () => dropzone.classList.add("press"));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
    dropzone.addEventListener(ev, () => dropzone.classList.remove("press"));
  }
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

  const kbdHint = $("kbd-hint");
  $("canvas").addEventListener("focus", () => {
    kbdHint.hidden = false;
  });
  $("canvas").addEventListener("blur", () => {
    kbdHint.hidden = true;
  });

  $("btn-close").addEventListener("click", () => {
    if (session && session.editor.ops.length > 0 && !closeArmed) {
      armDiscard("close");
      return;
    }
    disarmDiscard();
    resetAll();
  });
  $("btn-close-confirm").addEventListener("click", () => {
    disarmDiscard();
    resetAll();
  });

  $("btn-skip").addEventListener("click", async () => {
    if (!(await advanceQueue())) toast(t("No more images in the queue."));
  });

  $("btn-scrub-all").addEventListener("click", runBatchScrub);
  $("btn-triage-each").addEventListener("click", () => advanceQueue());
  $("btn-triage-cancel").addEventListener("click", () => {
    queue = [];
    showScreen("start");
  });
  $("btn-batch-again").addEventListener("click", () => {
    setBatchResults([]);
    resetAll();
  });
  $("btn-batch-save-all").addEventListener("click", async () => {
    for (const r of batchResults) {
      if (!r.ok) continue;
      await saveOut(r.blob, r.outName);
      // A burst of same-tick downloads gets throttled or blocked by some
      // browsers; a small gap between saves keeps each one landing.
      await sleep(250);
    }
  });

  $("btn-del-box").addEventListener("click", () => {
    view.deleteSelected();
  });

  $("btn-undo").addEventListener("click", () => {
    announce(undo(session.editor) ? t("Undone") : t("Nothing to undo"));
    editorChanged();
    view.clearSelection();
    rescueFocus();
  });
  $("btn-redo").addEventListener("click", () => {
    announce(redo(session.editor) ? t("Redone") : t("Nothing to redo"));
    editorChanged();
    view.render();
    rescueFocus();
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
    editorChanged();
    announce(t("Crop applied. Everything outside the bright area will be removed on export."));
  });
  $("btn-crop-cancel").addEventListener("click", () => {
    view.setCropDraft(null);
    setTool("ink");
  });

  $("btn-xray").addEventListener("click", () => setXrayOpen($("xray").hidden));
  $("btn-xray-close").addEventListener("click", () => {
    setXrayOpen(false);
    $("btn-xray").focus();
  });
  $("btn-xray-export").addEventListener("click", () => {
    setXrayOpen(false);
    runExport();
  });

  $("btn-export").addEventListener("click", runExport);

  const reExportAnnounced = async (type) => {
    if (await reExport(type, Number($("q-slider").value) / 100)) {
      announce(
        t("Re-exported as {fmt}, {size}. {verdict}", {
          fmt: type === "image/png" ? "PNG" : "JPEG",
          size: $("done-size").textContent,
          verdict: $("done-title").textContent,
        }),
      );
    }
  };
  for (const radio of document.querySelectorAll('input[name="fmt"]')) {
    radio.addEventListener("change", () => reExportAnnounced(radio.value));
  }
  $("q-slider").addEventListener("change", () => reExportAnnounced("image/jpeg"));

  $("btn-share").addEventListener("click", async () => {
    if (!session?.exported) return;
    const ok = await shareOut(session.exported.blob, session.exported.name);
    if (ok) return;
    const how = await saveOut(session.exported.blob, session.exported.name);
    if (how === "download") toast(t("Sharing is not available here, so it downloaded instead."));
    else if (how === "unsupported") toast(t("This build cannot hand the file to another app yet. Update Sepia, or use the web version."), 6000);
  });
  $("btn-copy").addEventListener("click", () => {
    if (session?.exported) copyImageAction(session.exported.blob);
  });
  $("btn-save").addEventListener("click", async () => {
    if (!session?.exported) return;
    const how = await saveOut(session.exported.blob, session.exported.name);
    // The wrapper's own share sheet reports the real outcome for "gallery";
    // a second, blind "saved!" from here would sometimes be a lie.
    if (how === "download") toast(t("Downloaded"));
    else if (how === "handoff") toast(t("Choose where to save it"));
    else if (how === "unsupported") toast(t("This build cannot hand the file to another app yet. Update Sepia, or use the web version."), 6000);
  });

  $("btn-again").addEventListener("click", () => {
    if (queue.length && !closeArmed) {
      armDiscard("again");
      return;
    }
    disarmDiscard();
    resetAll();
  });
  $("btn-again-confirm").addEventListener("click", () => {
    disarmDiscard();
    resetAll();
  });
  $("btn-next").addEventListener("click", () => advanceQueue());

  document.addEventListener("keydown", (ev) => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
    const onEdit = session && !$("screen-edit").hidden;
    const onDone = session?.exported && !$("screen-done").hidden;
    if (armedFor && ev.key === "Escape") {
      const was = armedFor;
      disarmDiscard();
      $(`btn-${was}`).focus();
      return;
    }
    if (onEdit && (ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      runExport();
      return;
    }
    // The canvas has its own Escape (clear the current selection) and must
    // keep it; this only takes over when focus is not there, so it can
    // never steal focus off the canvas mid-edit just because the drawer
    // happens to be open.
    if (onEdit && ev.key === "Escape" && !$("xray").hidden && document.activeElement !== $("canvas")) {
      setXrayOpen(false);
      $("btn-xray").focus();
      return;
    }
    if (onDone && (ev.key === "s" || ev.key === "S")) {
      $("btn-save").click();
      return;
    }
    if (onDone && (ev.key === "n" || ev.key === "N") && queue.length) {
      advanceQueue();
      return;
    }
    if (!onEdit) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo(session.editor);
      else undo(session.editor);
      editorChanged();
      view.clearSelection();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      redo(session.editor);
      editorChanged();
      view.render();
    }
  });

  window.addEventListener("popstate", () => {
    const hash = location.hash;
    if (hash === "#edit" && session) showScreen("edit");
    else if (hash === "#done" && session?.exported) showScreen("done");
    else if (session && !$("screen-edit").hidden && session.editor.ops.length > 0 && !closeArmed) {
      // The back gesture gets the same second-chance as the close button.
      history.pushState(null, "", "#edit");
      armDiscard("close");
    } else if (session && location.hash === "") {
      disarmDiscard();
      resetAll();
    } else if (session) {
      showScreen("edit");
    } else {
      resetAll();
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
  let pref = "auto";
  try {
    pref = localStorage.getItem("sepia-locale") || "auto";
  } catch {}
  setLocale(resolveLocale(pref));
  translateDom();
  buildLocalePicker();

  if (isBundled()) {
    stripWebOnly();
  } else if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  fitHintToDevice();
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
      editorChanged();
      announce(t("Code covered with ink"));
    },
    onChange: editorChanged,
    onSelect: updateDeleteChip,
    onCropDraft: () => {},
    announce,
  });

  wireEvents();
  setTool("ink");
  showScreen("start");

  // Installed-PWA "open with Sepia" from a file manager.
  globalThis.launchQueue?.setConsumer?.(async (params) => {
    const files = [];
    for (const handle of params.files || []) {
      try {
        files.push(await handle.getFile());
      } catch {}
    }
    if (files.length) await openFiles(files);
  });

  onShared(async (tokens) => {
    if (!tokens.length) return;
    await enterQueue(tokens.map((token) => ({ kind: "token", token })));
  });
  const tokens = sharedTokens();
  if (tokens.length) {
    await enterQueue(tokens.map((token) => ({ kind: "token", token })));
  }

  // A share_target launch lands with ?share-target=1; the worker parked the
  // files in the cache for exactly one pickup. On every other boot the same
  // entries are purged unread, so a crashed pickup cannot leave a shared
  // image parked in browser storage.
  if ("caches" in globalThis) {
    try {
      const cache = await caches.open("sepia-share");
      const isPickup = new URLSearchParams(location.search).has("share-target");
      const keys = await cache.keys();
      const parked = keys.filter((req) => new URL(req.url).pathname.startsWith("/share-incoming"));
      const files = [];
      for (const req of parked) {
        if (isPickup) {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            files.push(new File([blob], "", { type: res.headers.get("content-type") || "image/*" }));
          }
        }
        await cache.delete(req);
      }
      if (files.length) await openFiles(files);
      if (isPickup) history.replaceState(null, "", location.pathname);
    } catch (err) {
      __sepiaErrors.push(`share-target: ${err}`);
    }
  }
}

boot();
