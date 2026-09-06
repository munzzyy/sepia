// The installed app is the app, not the website. Boots the real page twice:
// once with window.SepiaNative planted before any script runs (what the
// Android WebView's addJavascriptInterface does), once bare. Also proves the
// share-in path: a token from the bridge turns into opened bytes fetched
// from the asset origin. And a Spanish system boots a Spanish app.
//
// Run from the repo root:  node test/e2e_wrapper.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = 8942;
const CDP_PORT = 9343;
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

const BRIDGE_STUB = (token) => `window.SepiaNative = {
  platform: () => "android",
  version: () => "e2e",
  sharedImageToken: () => ${JSON.stringify(token)},
  shareImage: (b64, mime, name) => { window.__shared = { size: b64.length, mime, name }; },
  saveImage: (b64, mime, name) => { window.__saved = { size: b64.length, mime, name }; },
};`;

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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
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

async function newTab({ wrapper, token = "", langs = null } = {}) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" });
  const tab = await res.json();
  const c = connect(tab.webSocketDebuggerUrl);
  await c.open;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  if (wrapper) await c.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE_STUB(token) });
  if (langs) {
    await c.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperty(navigator, "languages", { get: () => ${JSON.stringify(langs)} });`,
    });
  }
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await c.send("Page.navigate", { url: BASE + "/" });
  await waitFor(() => c.evalJs("!!window.__sepiaApi"), "app booted");
  return c;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-wrapper-e2e-"));
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

    // -------------------------------------------------- wrapper vs web
    const wrap = await newTab({ wrapper: true });
    const w = await wrap.evalJs(`(() => ({
      webOnly: document.querySelectorAll(".web-only").length,
      about: !document.getElementById("about-site").hidden,
      wrapper: __sepiaApi.state.wrapper,
      hint: document.getElementById("drop-hint").textContent,
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check("wrapper: every web-only section removed from the DOM", w.webOnly === 0, String(w.webOnly));
    check("wrapper: about link revealed", w.about === true);
    check("wrapper: bridge detected", w.wrapper === true);
    check("wrapper: hint speaks share-sheet, not Ctrl+V", w.hint.includes("share") && !w.hint.includes("Ctrl"), w.hint);
    check("wrapper: console clean", w.errs.length === 0, JSON.stringify(w.errs));
    const shot = await wrap.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(SHOTS, "05-wrapper-start.png"), Buffer.from(shot.result.data, "base64"));
    wrap.close();

    const web = await newTab({ wrapper: false });
    const v = await web.evalJs(`(() => ({
      webOnly: document.querySelectorAll(".web-only").length,
      about: !document.getElementById("about-site").hidden,
      landing: !!document.getElementById("landing-app"),
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check("web: landing sections all present", v.webOnly > 0 && v.landing);
    check("web: about link never shows", v.about === false);
    check("web: console clean", v.errs.length === 0, JSON.stringify(v.errs));
    web.close();

    // ----------------------------------------------------- share-in flow
    const shared = await newTab({ wrapper: true, token: "e2etoken" });
    await waitFor(() => shared.evalJs("__sepiaApi.state.screen === 'edit'"), "shared image opened");
    const s = await shared.evalJs(`(() => ({
      gps: !!__sepiaApi.state.report.gps,
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check("share-in: bridge token opens the image", s.gps === true);
    check("share-in: console clean", s.errs.length === 0, JSON.stringify(s.errs));

    // Export goes out through the bridge, not a download.
    await shared.evalJs("document.getElementById('btn-export').click(); 'ok'");
    await waitFor(() => shared.evalJs("__sepiaApi.state.screen === 'done'"), "export done");
    await shared.evalJs("document.getElementById('btn-share').click(); 'ok'");
    await waitFor(() => shared.evalJs("!!window.__shared"), "share handed to bridge");
    const out = await shared.evalJs("window.__shared");
    check("share-out: bytes reach the bridge with a scrubbed name", out.size > 1000 && /^image-[a-z2-9]{5}\.jpg$/.test(out.name), JSON.stringify(out));
    await shared.evalJs("document.getElementById('btn-save').click(); 'ok'");
    await waitFor(() => shared.evalJs("!!window.__saved"), "save handed to bridge");
    shared.close();

    // ------------------------------------------------------------ spanish
    const es = await newTab({ wrapper: true, langs: ["es-MX", "es"] });
    const esState = await es.evalJs(`(() => ({
      lang: document.documentElement.lang,
      tagline: document.querySelector(".tagline").textContent,
      errs: (__sepiaErrors || []).slice(0, 3),
    }))()`);
    check("es: document language follows the system", esState.lang === "es", esState.lang);
    check("es: the start screen speaks Spanish", esState.tagline === "Comparte imágenes sin compartir de más.", esState.tagline);
    check("es: console clean", esState.errs.length === 0, JSON.stringify(esState.errs));
    es.close();
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
  console.log("E2E WRAPPER PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
