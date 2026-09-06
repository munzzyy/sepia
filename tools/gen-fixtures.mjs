// Builds the decodable fixture images: the in-app demo photo and the e2e
// test files. Pixels are rendered by headless Chromium (a canvas is the one
// honest way to get a real JPEG without shipping an encoder); metadata is
// injected by the same builders the unit tests use.
//
// Run from the repo root:  node tools/gen-fixtures.mjs

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  buildTiff,
  sampleExifSpec,
  buildExifSegment,
  buildXmpSegment,
  buildIptcSegment,
  injectJpegSegments,
  injectWebpChunks,
  buildPng,
  concat,
  str,
  SAMPLE_XMP,
} from "../test/fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = 9341;

// The demo scene: bright, obviously fake, with "sensitive" bits worth
// covering (a name tag and a house number), drawn twice: full frame for the
// hidden thumbnail, "cropped" for the main shot, so the X-ray teaches the
// thumbnail lesson with a real example.
const DRAW = `
function scene(ctx, w, h, cropped) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, "#7fb2d9");
  sky.addColorStop(1, "#cfe3ef");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.6);
  ctx.fillStyle = "#f2d06b";
  ctx.beginPath();
  ctx.arc(w * 0.82, h * 0.18, 40, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#9fbf6e";
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.fillStyle = "#b0713a";
  ctx.fillRect(w * 0.12, h * 0.3, w * 0.3, h * 0.35);
  ctx.fillStyle = "#7a4a22";
  ctx.beginPath();
  ctx.moveTo(w * 0.09, h * 0.31);
  ctx.lineTo(w * 0.27, h * 0.14);
  ctx.lineTo(w * 0.45, h * 0.31);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(w * 0.17, h * 0.38, w * 0.08, h * 0.1);
  ctx.fillStyle = "#3b2a18";
  ctx.font = "bold " + Math.round(h * 0.06) + "px sans-serif";
  ctx.fillText("214", w * 0.3, h * 0.45);
  ctx.fillStyle = "#e3b08c";
  ctx.beginPath();
  ctx.arc(w * 0.66, h * 0.52, h * 0.055, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#4a688e";
  ctx.fillRect(w * 0.6, h * 0.57, w * 0.12, h * 0.28);
  ctx.fillStyle = "#fff";
  ctx.fillRect(w * 0.6, h * 0.62, w * 0.12, h * 0.05);
  ctx.fillStyle = "#222";
  ctx.font = "bold " + Math.round(h * 0.035) + "px sans-serif";
  ctx.fillText("RILEY", w * 0.615, h * 0.657);
  if (!cropped) {
    ctx.fillStyle = "#c94f3f";
    ctx.fillRect(w * 0.78, h * 0.5, w * 0.2, h * 0.35);
    ctx.fillStyle = "#fff";
    ctx.font = "bold " + Math.round(h * 0.04) + "px sans-serif";
    ctx.fillText("SOLD", w * 0.82, h * 0.6);
  }
}
async function make(w, h, cropped, type, q) {
  const c = new OffscreenCanvas(w, h);
  scene(c.getContext("2d"), w, h, cropped);
  const blob = await c.convertToBlob({ type, quality: q });
  const buf = await blob.arrayBuffer();
  return btoa(Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(""));
}
`;

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
  return {
    send,
    open: new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    }),
    close: () => ws.close(),
  };
}

async function evalAsync(c, expression) {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function main() {
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-fixtures-"));
  const chromium = spawn(
    "chromium",
    ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    let tab = null;
    for (let i = 0; i < 60 && !tab; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
        tab = await res.json();
      } catch {
        await sleep(300);
      }
    }
    const c = connect(tab.webSocketDebuggerUrl);
    await c.open;
    await c.send("Runtime.enable");
    await evalAsync(c, DRAW + "globalThis.__make = make; 'ok'");

    const b64 = (expr) => evalAsync(c, expr);
    const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

    const mainShot = fromB64(await b64(`__make(1280, 960, true, "image/jpeg", 0.85)`));
    const thumbShot = fromB64(await b64(`__make(160, 120, false, "image/jpeg", 0.6)`));
    const webpShot = fromB64(await b64(`__make(320, 240, true, "image/webp", 0.85)`));

    // Demo: everything wrong at once, including a fake motion-photo trailer.
    const demo = concat(
      injectJpegSegments(mainShot, [
        buildExifSegment(buildTiff(sampleExifSpec(thumbShot))),
        buildXmpSegment(SAMPLE_XMP),
        buildIptcSegment(),
      ]),
      str("\0\0\0\x18ftypmp42"),
      new Uint8Array(2048),
    );
    mkdirSync(path.join(ROOT, "app", "demo"), { recursive: true });
    writeFileSync(path.join(ROOT, "app", "demo", "sample.jpg"), demo);

    // E2E fixtures: decodable files with known metadata.
    const fixDir = path.join(ROOT, "test", "fixtures");
    mkdirSync(fixDir, { recursive: true });
    writeFileSync(
      path.join(fixDir, "real-gps.jpg"),
      injectJpegSegments(mainShot, [buildExifSegment(buildTiff(sampleExifSpec(thumbShot)))]),
    );
    writeFileSync(
      path.join(fixDir, "real-text.png"),
      buildPng({ width: 64, height: 48, text: [["Author", "Jordan Sample"]], time: true }),
    );
    writeFileSync(
      path.join(fixDir, "real-exif.webp"),
      injectWebpChunks(webpShot, { exif: buildTiff(sampleExifSpec()) }),
    );
    writeFileSync(path.join(fixDir, "clean.jpg"), mainShot);

    console.log("fixtures written: app/demo/sample.jpg, test/fixtures/{real-gps.jpg,real-text.png,real-exif.webp,clean.jpg}");
    c.close();
  } finally {
    chromium.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
