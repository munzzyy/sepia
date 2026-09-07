// Batch scrub: queue several files, run triage's "Scrub all", and verify the
// rollup the same way e2e_app.mjs verifies a single export: outside the app,
// on the actual exported bytes, with node-side parsers. The app grading its
// own homework is the failure mode this suite exists to rule out, same as
// the single-image path.
//
// Run from the repo root:  node test/e2e_batch.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { inspectImage } from "../app/js/inspect.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8944;
const CDP_PORT = 9345;
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

async function shot(c, name) {
  const s = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(SHOTS, name), Buffer.from(s.result.data, "base64"));
}

async function decodeExportedBlob(c, index) {
  const b64 = await c.evalJs(
    `(async () => { const b = new Uint8Array(await __sepiaBatchResults[${index}].blob.arrayBuffer());
      let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(out); })()`,
    true,
  );
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-e2e-batch-"));
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

    // ---------------------------------------------- queue three plus a corrupt one
    // Negative control for the fail-closed guarantee: a file with valid
    // JPEG magic bytes (so inspectImage/sniffFormat happily produce a
    // report) but no actual frame data, so createImageBitmap's decode step
    // fails. scrubOne must return ok:false for it, and the rollup must
    // never count it as clean. Without this fixture, a regression that made
    // scrubOne fail OPEN (report ok:true on a decode failure) would pass
    // every other check in this suite unnoticed.
    // Under the repo tree, not the tmp profile: CI's chromium cannot read
    // setFileInputFiles paths outside the checkout.
    const corruptPath = path.join(ROOT, "test", "fixtures", "corrupt-e2e.jpg");
    writeFileSync(corruptPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const { root } = (await c.send("DOM.getDocument")).result;
    const input = (await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" })).result;
    await c.send("DOM.setFileInputFiles", {
      nodeId: input.nodeId,
      files: [
        path.join(ROOT, "test", "fixtures", "real-gps.jpg"),
        path.join(ROOT, "test", "fixtures", "clean.jpg"),
        path.join(ROOT, "test", "fixtures", "real-exif.webp"),
        corruptPath,
      ],
    });
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'triage'"), "triage screen");
    const rowCount = await c.evalJs(`document.querySelectorAll('.triage-row').length`);
    check("triage: one row per queued file", rowCount === 4, String(rowCount));
    check("triage: single-image flow untouched (screen exists separately)", await c.evalJs(`!document.getElementById('screen-triage').hidden`));
    await shot(c, "05-triage.png");

    // ----------------------------------------------------- scrub all now
    await c.evalJs(`document.getElementById('btn-scrub-all').click(); 'ok'`);
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'batch'"), "batch screen", 30000);
    const rows = await c.evalJs(`(() => Array.from(document.querySelectorAll('.triage-row')).map((r) => r.className))()`);
    check("triage: rows marked before the screen switch", rows.every((cls) => /clean|leftover|fail/.test(cls)), JSON.stringify(rows));
    check("triage: the corrupt file's row is marked fail, not clean", rows[3].includes("fail") && !rows[3].includes("clean"), rows[3]);
    const batchRows = await c.evalJs(`document.querySelectorAll('.batch-row').length`);
    check("batch: rollup lists all four files", batchRows === 4, String(batchRows));
    const title = await c.evalJs(`document.getElementById('batch-title').textContent`);
    check("batch: verdict count excludes the failed file from clean", /3 of 4/.test(title), title);
    const sub = await c.evalJs(`document.getElementById('batch-sub').textContent`);
    check("batch: subtitle names one skipped file", /1/.test(sub), sub);
    const failVerdictText = await c.evalJs(
      `document.querySelectorAll('.batch-verdict.fail').length === 1 ? document.querySelector('.batch-verdict.fail').textContent : ''`,
    );
    check("batch: exactly one row carries the fail verdict class", failVerdictText.length > 0, failVerdictText);
    check(
      "batch: the fail verdict never carries the clean class too",
      await c.evalJs(`!document.querySelector('.batch-verdict.fail.clean')`),
    );
    await shot(c, "06-batch-done.png");

    // Independent verification: re-read the actual exported bytes for each
    // file through node parsers, the same way the single-image e2e does.
    // The app exposes them on window via a debug hook installed just for
    // this: __sepiaBatchResults, set by runBatchScrub via the same object
    // the "Save all" button iterates.
    const resultsMeta = await c.evalJs(
      `(() => __sepiaBatchResults.map((r) => ({ ok: r.ok, hasVerify: "verify" in r, clean: r.ok ? r.verify.clean : null })))()`,
    );
    check("batch: four results captured", resultsMeta.length === 4, JSON.stringify(resultsMeta));
    check("negative control: the corrupt file's result is ok:false", resultsMeta[3].ok === false, JSON.stringify(resultsMeta[3]));
    check(
      "negative control: a failed result carries no verify object at all, so nothing downstream can read .clean off it",
      resultsMeta[3].hasVerify === false,
      JSON.stringify(resultsMeta[3]),
    );
    check(
      "negative control: the three real fixtures still verified ok and clean",
      resultsMeta.slice(0, 3).every((r) => r.ok === true && r.clean === true),
      JSON.stringify(resultsMeta),
    );
    for (let i = 0; i < resultsMeta.length; i++) {
      if (!resultsMeta[i].ok) continue;
      const bytes = await decodeExportedBlob(c, i);
      const outReport = await inspectImage(bytes);
      check(
        `batch[${i}]: independent parser finds no gps/thumbnail/trailer in export`,
        outReport.gps === null && !outReport.thumbnail && !outReport.trailer,
        JSON.stringify({ i, items: outReport.items.map((it) => it.id) }),
      );
      check(
        `batch[${i}]: independent parser agrees nothing above harmless survived`,
        outReport.counts.high === 0 && outReport.counts.medium === 0,
        JSON.stringify(outReport.items),
      );
    }

    // ------------------------------------------------- single image unaffected
    await c.evalJs(`document.getElementById('btn-batch-again').click(); 'ok'`);
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'start'"), "back to start");
    const input2 = (await c.send("DOM.querySelector", { nodeId: (await c.send("DOM.getDocument")).result.root.nodeId, selector: "#file-input" })).result;
    await c.send("DOM.setFileInputFiles", { nodeId: input2.nodeId, files: [path.join(ROOT, "test", "fixtures", "real-gps.jpg")] });
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "single file skips triage");
    check(
      "single file: triage screen never shown, editor opened directly",
      await c.evalJs(`document.getElementById('screen-triage').hidden`),
    );

    // ------------------------------------------------------- copy button
    await c.evalJs(`document.getElementById('btn-export').click(); 'ok'`);
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'done'"), "single export done");
    const copyVisible = await c.evalJs(`!document.getElementById('btn-copy').hidden`);
    check("proof: copy-image button shows when the Clipboard API supports images", copyVisible);
    await c.evalJs(`document.getElementById('btn-copy').click(); 'ok'`);
    await sleep(300);
    const errsAfterCopy = await c.evalJs("(__sepiaErrors || []).slice(0, 5)");
    check("copy: clicking never throws, success or failure both toast", errsAfterCopy.length === 0, JSON.stringify(errsAfterCopy));
    await shot(c, "07-proof-copy.png");

    const finalErrs = await c.evalJs("(__sepiaErrors || []).slice(0, 8)");
    check("no page errors across the batch run", finalErrs.length === 0, JSON.stringify(finalErrs));

    c.close();
  } finally {
    chromium.kill();
    server.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      rmSync(path.join(ROOT, "test", "fixtures", "corrupt-e2e.jpg"), { force: true });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E BATCH PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
