// Drives the real app in headless Chromium over CDP: open a fixture that is
// provably dirty, redact with real pointer input, export, then verify the
// output OUTSIDE the app: node-side parsers on the exported bytes, exiftool
// when installed, and pixel probes on the redacted region. The app grading
// its own homework is the failure mode this suite exists to rule out.
//
// Run from the repo root:  node test/e2e_app.mjs

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { inspectImage } from "../app/js/inspect.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8941;
const CDP_PORT = 9342;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const SHOTS = path.join(ROOT, "test", "screenshots");

const fails = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name} ${detail}`);
    fails.push(name);
  }
}

async function waitFor(fn, desc, timeout = 20000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = String(err);
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${desc}; last: ${JSON.stringify(last)}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.result?.exceptionDetails) {
      throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails)}`);
    }
    return r.result?.result?.value;
  };
  return {
    send,
    evalJs,
    open: new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    }),
    close: () => ws.close(),
  };
}

async function newTab() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const c = connect(tab.webSocketDebuggerUrl);
  await c.open;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("DOM.enable");
  return c;
}

async function drag(c, from, to) {
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await c.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
      button: "left",
    });
    await sleep(20);
  }
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left" });
  await sleep(120);
}

async function canvasBox(c) {
  return c.evalJs(`(() => { const r = document.getElementById("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
}

async function shot(c, name) {
  const s = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(SHOTS, name), Buffer.from(s.result.data, "base64"));
}

let hasExiftool = true;
try {
  execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
} catch {
  hasExiftool = false;
  console.log("  !!   exiftool NOT INSTALLED: the external cross-check will NOT run");
  if (process.env.CI) {
    console.error("CI requires exiftool so the cross-check cannot silently vanish");
    process.exit(1);
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-e2e-"));
  const server = spawn("node", [path.join(ROOT, "test", "serve_local.mjs"), String(HTTP_PORT)], { stdio: "ignore" });
  const chromium = spawn(
    "chromium",
    ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(async () => {
      const [a, b] = await Promise.all([
        fetch(`${BASE}/index.html`).then((r) => r.ok).catch(() => false),
        fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false),
      ]);
      return a && b;
    }, "server and devtools up");

    const c = await newTab();
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: BASE + "/" });
    await waitFor(() => c.evalJs("!!window.__sepiaApi && __sepiaApi.state.screen === 'start'"), "start screen");

    // ------------------------------------------------------------- boot
    const boot = await c.evalJs(`(() => ({
      webOnly: document.querySelectorAll(".web-only").length,
      landing: !!document.getElementById("landing-app"),
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check("web boot: landing present", boot.webOnly > 0 && boot.landing);
    check("web boot: console clean", boot.errs.length === 0, JSON.stringify(boot.errs));
    await shot(c, "01-start.png");

    // ------------------------------------------------- open dirty fixture
    // Through the real file input, the way a person would.
    const { root } = (await c.send("DOM.getDocument")).result;
    const input = (await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" })).result;
    await c.send("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [path.join(ROOT, "test", "fixtures", "real-gps.jpg")],
    });
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "editor open");

    const report = await c.evalJs("__sepiaApi.state.report");
    check("x-ray: gps found", !!report.gps);
    check("x-ray: hidden thumbnail found", report.items.some((i) => i.id === "thumbnail"));
    check("x-ray: serial number found", report.items.some((i) => i.id === "exif:Body serial number"));
    check("negative control: fixture is provably dirty", report.counts.high >= 4, JSON.stringify(report.counts));
    const drawerOpen = await c.evalJs("!document.getElementById('xray').hidden");
    check("x-ray drawer auto-opens on serious leaks", drawerOpen === true);

    // The hidden attribute must actually hide: display classes were once
    // defeating it, so assert computed styles, not just the attribute.
    const vis = await c.evalJs(`(() => {
      const gone = (id) => getComputedStyle(document.getElementById(id)).display === "none";
      return { cropBar: gone("crop-bar"), codes: typeof BarcodeDetector === "function" || gone("btn-codes"), note: gone("pixelate-note") };
    })()`);
    check("hidden really hides: crop bar, codes button, pixelate note", vis.cropBar && vis.codes && vis.note, JSON.stringify(vis));
    await shot(c, "02-editor-xray.png");
    await c.evalJs("document.getElementById('btn-xray-close').click(); 'ok'");

    // ------------------------------------------------------ redact + crop
    const box = await canvasBox(c);
    // Ink over the name tag area (center-right of the image).
    await drag(
      c,
      { x: box.x + box.w * 0.55, y: box.y + box.h * 0.55 },
      { x: box.x + box.w * 0.75, y: box.y + box.h * 0.75 },
    );
    check("ink op lands from a pointer drag", (await c.evalJs("__sepiaApi.state.ops")) === 1);

    await c.evalJs("document.getElementById('tool-pixelate').click(); 'ok'");
    await drag(
      c,
      { x: box.x + box.w * 0.2, y: box.y + box.h * 0.2 },
      { x: box.x + box.w * 0.35, y: box.y + box.h * 0.35 },
    );
    check("pixelate op lands", (await c.evalJs("__sepiaApi.state.ops")) === 2);
    const noteShown = await c.evalJs("!document.getElementById('pixelate-note').hidden");
    check("pixelate honesty note shows", noteShown === true);
    await shot(c, "03-redacted.png");

    // ---------------------------------------------------------- export
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'done' && !!__sepiaApi.session().exported"), "done screen");
    const done = await c.evalJs(`(() => ({
      badge: document.getElementById("done-badge").textContent,
      warn: document.getElementById("done-badge").classList.contains("warn"),
      title: document.getElementById("done-title").textContent,
      removed: document.getElementById("done-removed").children.length,
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check("proof: clean badge", done.badge === "✓" && !done.warn, JSON.stringify(done));
    check("proof: removal list is specific", done.removed >= 5, String(done.removed));
    check("proof: console clean", done.errs.length === 0, JSON.stringify(done.errs));
    await shot(c, "04-proof.png");

    // Independent verification of the exported bytes, outside the app.
    const b64 = await c.evalJs(
      `(async () => { const s = __sepiaApi.session(); const b = new Uint8Array(await s.exported.blob.arrayBuffer());
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
      true,
    );
    const exported = new Uint8Array(Buffer.from(b64, "base64"));
    const outReport = await inspectImage(exported);
    check("independent: node parsers find no gps in output", outReport.gps === null);
    check("independent: no thumbnail, no trailer in output", !outReport.thumbnail && !outReport.trailer);
    check(
      "independent: nothing above harmless left",
      outReport.counts.high === 0 && outReport.counts.medium === 0,
      JSON.stringify(outReport.items),
    );
    if (hasExiftool) {
      const outFile = path.join(profile, "exported.jpg");
      writeFileSync(outFile, exported);
      const meta = JSON.parse(
        execFileSync("exiftool", ["-j", "-n", outFile], { encoding: "utf8" }),
      )[0];
      const leaky = ["GPSLatitude", "Make", "Model", "Artist", "SerialNumber", "DateTimeOriginal", "OwnerName"].filter(
        (k) => k in meta,
      );
      check("independent: exiftool sees no identifying fields", leaky.length === 0, leaky.join(","));
    }

    // Pixels: the inked region is ink, an untouched corner is not.
    const px = await c.evalJs(
      `(async () => { const s = __sepiaApi.session();
        const bmp = await createImageBitmap(s.exported.blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const at = (fx, fy) => Array.from(ctx.getImageData(Math.round(bmp.width * fx), Math.round(bmp.height * fy), 1, 1).data);
        return { inked: at(0.65, 0.65), corner: at(0.02, 0.02), w: bmp.width, h: bmp.height }; })()`,
      true,
    );
    const dark = (p) => p[0] < 40 && p[1] < 40 && p[2] < 40;
    check("pixels: inked area is actually ink", dark(px.inked), JSON.stringify(px.inked));
    check("pixels: untouched area is untouched", !dark(px.corner), JSON.stringify(px.corner));

    // Fractional drag rects must not leave a sub-pixel strip of covered
    // content along any edge: probe just inside all four borders.
    const edges = await c.evalJs(
      `(async () => { const s = __sepiaApi.session();
        const op = s.editor.ops.find((o) => o.type === "ink");
        const bmp = await createImageBitmap(s.exported.blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const r = op.rect;
        const at = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        return [at(r.x + 0.6, cy), at(r.x + r.w - 0.6, cy), at(cx, r.y + 0.6), at(cx, r.y + r.h - 0.6)]; })()`,
      true,
    );
    check("pixels: every redaction edge is covered to the border", edges.every(dark), JSON.stringify(edges));

    // ------------------------------------------- format switch re-exports
    await c.evalJs(`document.querySelector('input[name="fmt"][value="image/png"]').click(); 'ok'`);
    await waitFor(() => c.evalJs("__sepiaApi.session().exported.type === 'image/png'"), "png re-export");
    const pngB64 = await c.evalJs(
      `(async () => { const b = new Uint8Array(await __sepiaApi.session().exported.blob.arrayBuffer());
        let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(out); })()`,
      true,
    );
    const pngReport = await inspectImage(new Uint8Array(Buffer.from(pngB64, "base64")));
    check("png re-export: clean and really png", pngReport.format === "png" && pngReport.counts.high === 0 && pngReport.counts.medium === 0);

    // ------------------------------------------------------------- crop
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'start'"), "back to start");
    // Feed the real bytes through fetch to keep the eval payload small.
    await c.evalJs(
      `(async () => { const r = await fetch("/shared/x"); const b = new Uint8Array(await r.arrayBuffer());
        await __sepiaApi.openBytes(b, "IMG_20260214_093122.jpg", "image/jpeg"); })()`,
      true,
    );
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "editor open again");
    const dims = await c.evalJs("(() => { const s = __sepiaApi.session(); return { w: s.editor.width, h: s.editor.height }; })()");
    await c.evalJs("document.getElementById('tool-crop').click(); 'ok'");
    const box2 = await canvasBox(c);
    await drag(
      c,
      { x: box2.x + box2.w * 0.3, y: box2.y + box2.h * 0.3 },
      { x: box2.x + box2.w * 0.7, y: box2.y + box2.h * 0.7 },
    );
    await c.evalJs("document.getElementById('btn-crop-apply').click(); 'ok'");
    await c.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'done'"), "cropped export");
    const cropOut = await c.evalJs(
      `(async () => { const bmp = await createImageBitmap(__sepiaApi.session().exported.blob); return { w: bmp.width, h: bmp.height }; })()`,
      true,
    );
    check("crop: output is smaller than the source", cropOut.w < dims.w && cropOut.h < dims.h, JSON.stringify({ cropOut, dims }));

    // ------------------------------------------------- keyboard operability
    await c.evalJs("document.getElementById('btn-again').click(); 'ok'");
    await c.evalJs(
      `(async () => { const r = await fetch("/shared/x"); const b = new Uint8Array(await r.arrayBuffer());
        await __sepiaApi.openBytes(b, "", "image/jpeg"); })()`,
      true,
    );
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "editor for keyboard test");
    await c.evalJs("document.getElementById('canvas').focus(); 'ok'");
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", text: "b" });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB" });
    await sleep(150);
    check("keyboard: B places a cover box", (await c.evalJs("__sepiaApi.state.ops")) === 1);
    const announced = await c.evalJs("document.getElementById('sr-live').textContent");
    check("keyboard: action announced to screen readers", announced.includes("Cover box"), announced);
    check("keyboard: hint bar appears with canvas focus", await c.evalJs("!document.getElementById('kbd-hint').hidden"));
    // Deselect first: the fresh box is selected, and Tab past the last
    // element deliberately releases focus instead of trapping it.
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await sleep(100);
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    await sleep(150);
    const cycled = await c.evalJs("document.getElementById('sr-live').textContent");
    check("keyboard: Tab cycles to the box and announces position", /box 1 of 1/.test(cycled), cycled);
    check("keyboard: delete chip appears for the selected box", await c.evalJs("!document.getElementById('btn-del-box').hidden"));
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    await sleep(100);
    check("keyboard: Tab past the last element releases the cycle (no trap)", await c.evalJs("document.getElementById('btn-del-box').hidden"));

    // ----------------------------------------------- demo + clean fixture
    // One close click arms the discard guard while covers exist; the second
    // click within the window actually closes. Both behaviors are asserted.
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await sleep(200);
    check("close guard: first tap does not discard covers", (await c.evalJs("__sepiaApi.state.screen")) === "edit");
    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'start'"), "back to start for demo");
    await c.evalJs("document.getElementById('btn-demo').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "demo open");
    const demoReport = await c.evalJs("__sepiaApi.state.report");
    check("demo: trailer warning present", demoReport.items.some((i) => i.id === "trailer"), "no trailer item");
    check("demo: iptc present", demoReport.items.some((i) => i.id === "iptc"));

    await c.evalJs("document.getElementById('btn-close').click(); 'ok'");
    const input2 = (await c.send("DOM.querySelector", { nodeId: (await c.send("DOM.getDocument")).result.root.nodeId, selector: "#file-input" })).result;
    // Fed from the repo tree: CI runners' chromium cannot always read files
    // living in another process's temp directory.
    await c.send("DOM.setFileInputFiles", { nodeId: input2.nodeId, files: [path.join(ROOT, "test", "fixtures", "clean.jpg")] });
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "clean fixture open");
    const cleanReport = await c.evalJs("__sepiaApi.state.report");
    check("negative control: clean input reports no serious leaks", cleanReport.counts.high === 0 && cleanReport.counts.medium === 0, JSON.stringify(cleanReport.counts));

    const finalErrs = await c.evalJs("(__sepiaErrors || []).slice(0, 8)");
    check("no page errors across the whole run", finalErrs.length === 0, JSON.stringify(finalErrs));

    c.close();
  } finally {
    chromium.kill();
    server.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E APP PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
