// Exports and a batch scrub in headless Firefox over WebDriver BiDi, re-checked in node.
// Run from the repo root:  node test/e2e_firefox.mjs

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { inspectImage } from "../app/js/inspect.js";
import { verifyClean } from "../app/js/verify.js";
import { scanPng, PNG_BENIGN } from "../app/js/pngscan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIREFOX = process.env.FIREFOX || "firefox";

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

// Fixed ports collide here: adb can hold 9471 and the other suites hold 894x and 934x.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function bidi(wsUrl) {
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
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, (msg) => (msg.type === "error" ? reject(new Error(`${method}: ${msg.error} ${msg.message}`)) : resolve(msg.result)));
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

// Values cross as JSON text; nothing here needs BiDi's live object references.
function pageEval(c, context) {
  return async (expression) => {
    const r = await c.send("script.evaluate", {
      expression: `(async () => JSON.stringify(await (${expression})))()`,
      target: { context },
      awaitPromise: true,
    });
    if (r.type === "exception") throw new Error(`page threw: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
}

const B64 = `(b) => { let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(out); }`;
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const extraChunks = (bytes) => scanPng(bytes).chunks.map((ch) => ch.type).filter((t) => !PNG_BENIGN.has(t) && t !== "iCCP");

async function main() {
  try {
    console.log(`  ${execFileSync(FIREFOX, ["--version"], { encoding: "utf8" }).trim()}`);
  } catch {
    console.log("  !!   firefox NOT INSTALLED: the Firefox export suite did NOT run");
    process.exit(process.env.CI ? 1 : 0);
  }
  const httpPort = await freePort();
  const bidiPort = await freePort();
  const base = `http://127.0.0.1:${httpPort}`;
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-e2e-ff-"));
  const server = spawn("node", [path.join(ROOT, "test", "serve_local.mjs"), String(httpPort)], { stdio: "ignore" });
  const firefox = spawn(FIREFOX, ["--headless", "--no-remote", "--profile", profile, `--remote-debugging-port=${bidiPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ffLog = "";
  const listening = new Promise((resolve) => {
    const onData = (d) => {
      ffLog += d;
      const m = ffLog.match(/WebDriver BiDi listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    };
    firefox.stdout.on("data", onData);
    firefox.stderr.on("data", onData);
  });
  let c = null;
  try {
    const wsBase = await Promise.race([
      listening,
      sleep(30000, undefined, { ref: false }).then(() => {
        throw new Error(`firefox never opened BiDi: ${ffLog.slice(-400)}`);
      }),
    ]);
    await waitFor(() => fetch(`${base}/index.html`).then((r) => r.ok).catch(() => false), "server up");
    c = bidi(`${wsBase}/session`);
    await c.open;
    await c.send("session.new", { capabilities: {} });
    // script.evaluate on the initial context fails with "System access is required".
    const { context } = await c.send("browsingContext.create", { type: "tab" });
    const ev = pageEval(c, context);
    await c.send("browsingContext.navigate", { context, url: base + "/", wait: "complete" });
    await waitFor(() => ev("!!window.__sepiaApi && __sepiaApi.state.screen === 'start'"), "start screen");

    // Without deBG in raw output the PNG checks below would pass without testing anything.
    const rawChunks = await ev(`(async () => {
      const cv = new OffscreenCanvas(16, 16);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#c08040";
      ctx.fillRect(0, 0, 16, 16);
      const b = new Uint8Array(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
      return (${B64})(b);
    })()`);
    const rawTypes = scanPng(fromB64(rawChunks)).chunks.map((ch) => ch.type);
    check("canary: raw Firefox canvas PNG carries a deBG chunk", rawTypes.includes("deBG"), JSON.stringify(rawTypes));

    // Save records the blob it would download instead of writing into the profile.
    await ev(`(() => {
      const blobs = new Map();
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj) => { const u = create(obj); blobs.set(u, obj); return u; };
      globalThis.__savedBlobs = [];
      HTMLAnchorElement.prototype.click = function () { if (this.download) __savedBlobs.push(blobs.get(this.href)); };
      return true;
    })()`);

    await ev(`(async () => {
      const r = await fetch("demo/sample.jpg");
      return __sepiaApi.openBytes(new Uint8Array(await r.arrayBuffer()), "IMG_20260214_093122.jpg", "image/jpeg");
    })()`);
    await waitFor(() => ev("__sepiaApi.state.screen === 'edit'"), "demo open");

    for (const [fmt, start] of [["image/jpeg", "btn-export"], ["image/png", "radio"]]) {
      if (start === "btn-export") await ev(`document.getElementById("btn-export").click()`);
      else await ev(`document.querySelector('input[name="fmt"][value="image/png"]').click()`);
      await waitFor(
        () => ev(`__sepiaApi.state.screen === "done" && __sepiaApi.session().exported?.type === "${fmt}"`),
        `${fmt} export`,
      );
      const title = await ev(`document.getElementById("done-title").textContent`);
      check(`${fmt}: proof says Checked clean`, title === "Checked clean", title);
      await ev(`(() => { __savedBlobs.length = 0; document.getElementById("btn-save").click(); return true; })()`);
      await waitFor(() => ev("__savedBlobs.length === 1"), `${fmt} save`);
      const out = await ev(`(async () => {
        const s = __sepiaApi.session().exported;
        const saved = new Uint8Array(await __savedBlobs[0].arrayBuffer());
        return { verified: (${B64})(s.bytes), saved: (${B64})(saved), savedType: __savedBlobs[0].type };
      })()`);
      const verified = fromB64(out.verified);
      check(`${fmt}: the saved file is byte for byte the verified one`, out.verified === out.saved && out.savedType === fmt, out.savedType);
      check(`${fmt}: node's verifyClean agrees`, (await verifyClean(verified)).clean, JSON.stringify((await inspectImage(verified)).items));
      if (fmt === "image/png") {
        check("image/png: no chunk outside the kept set", extraChunks(verified).length === 0, JSON.stringify(extraChunks(verified)));
      }
    }

    // Batch: one PNG straight off Firefox's encoder (deBG and all) plus the demo JPEG.
    await ev(`document.getElementById("btn-again").click()`);
    await waitFor(() => ev("__sepiaApi.state.screen === 'start'"), "back to start");
    await ev(`(async () => {
      const cv = new OffscreenCanvas(24, 24);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#3a6ea5";
      ctx.fillRect(0, 0, 24, 24);
      const png = await cv.convertToBlob({ type: "image/png" });
      const jpg = await (await fetch("demo/sample.jpg")).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([png], "drawn.png", { type: "image/png" }));
      dt.items.add(new File([jpg], "sample.jpg", { type: "image/jpeg" }));
      const input = document.getElementById("file-input");
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
      return true;
    })()`);
    await waitFor(() => ev("__sepiaApi.state.screen === 'triage'"), "triage");
    await ev(`document.getElementById("btn-scrub-all").click()`);
    await waitFor(() => ev("__sepiaApi.state.screen === 'batch'"), "batch done", 30000);
    const batch = await ev(`(async () => Promise.all(__sepiaBatchResults.map(async (r) => ({
      ok: r.ok, type: r.type, clean: r.ok && r.verify.clean,
      b64: r.ok ? (${B64})(new Uint8Array(await r.blob.arrayBuffer())) : "",
    }))))()`);
    const title = await ev(`document.getElementById("batch-title").textContent`);
    check("batch: both files came back clean", /2 of 2/.test(title) && batch.every((r) => r.clean), title);
    const pngOut = fromB64(batch[0].b64);
    check("batch: the PNG stays a PNG", batch[0].type === "image/png", batch[0].type);
    check("batch: no chunk outside the kept set", extraChunks(pngOut).length === 0, JSON.stringify(extraChunks(pngOut)));
    check("batch: node's verifyClean agrees on every file", (await Promise.all(batch.map((r) => verifyClean(fromB64(r.b64))))).every((v) => v.clean));

    const errs = await ev("(__sepiaErrors || []).slice(0, 8)");
    check("no page errors across the run", errs.length === 0, JSON.stringify(errs));
  } finally {
    c?.close();
    firefox.kill();
    server.kill();
    await sleep(600);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E FIREFOX PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
