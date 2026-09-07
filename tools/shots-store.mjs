// Captures phone-ratio store screenshots (390x844, wrapper mode) into the
// fastlane listing: start screen, editor with the X-ray open on the demo
// image, and the proof screen.
//
// Run from the repo root:  node tools/shots-store.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8944;
const CDP_PORT = 9345;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const OUT = path.join(ROOT, "fastlane", "metadata", "android", "en-US", "images", "phoneScreenshots");

const BRIDGE_STUB = `window.SepiaNative = {
  platform: () => "android",
  version: () => "0.1.0",
  sharedImageTokens: () => "[]",
  shareImage: () => {},
  saveImage: () => {},
};`;

async function waitFor(fn, desc, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`timeout: ${desc}`);
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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  return { send, evalJs, open: new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }) };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-shots-"));
  const server = spawn("node", [path.join(ROOT, "test", "serve_local.mjs"), String(HTTP_PORT)], { stdio: "ignore" });
  const chromium = spawn(
    "chromium",
    ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "--force-device-scale-factor=2", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(async () => {
      const [a, b] = await Promise.all([
        fetch(`${BASE}/index.html`).then((r) => r.ok).catch(() => false),
        fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok).catch(() => false),
      ]);
      return a && b;
    }, "server + devtools");

    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
    const tab = await res.json();
    const c = connect(tab.webSocketDebuggerUrl);
    await c.open;
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE_STUB });
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send("Page.navigate", { url: BASE + "/" });
    await waitFor(() => c.evalJs("!!window.__sepiaApi && __sepiaApi.state.screen === 'start'"), "start");

    const shot = async (name) => {
      const s = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(OUT, name), Buffer.from(s.result.data, "base64"));
      console.log(`wrote ${name}`);
    };

    await shot("1.png");

    await c.evalJs("document.getElementById('btn-demo').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit' && !document.getElementById('xray').hidden"), "editor + xray");
    await sleep(400);
    await shot("2.png");

    await c.evalJs("document.getElementById('btn-xray-export').click(); 'ok'");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'done'"), "proof");
    await sleep(400);
    await shot("3.png");
  } finally {
    chromium.kill();
    server.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  console.log("store screenshots done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
