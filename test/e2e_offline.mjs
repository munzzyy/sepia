// The service worker in headless Chromium: offline reload and share-target pickup, at / and at /sepia/.
// Run from the repo root:  node test/e2e_offline.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails)}`);
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

async function newTab(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" });
  const c = connect((await res.json()).webSocketDebuggerUrl);
  await c.open;
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  return c;
}

function serve(port, mount) {
  return spawn("node", [path.join(ROOT, "test", "serve_local.mjs"), String(port), mount], { stdio: "ignore" });
}

async function run(cdpPort, mount) {
  const port = await freePort();
  const scope = `http://127.0.0.1:${port}${mount}`;
  let server = serve(port, mount);
  try {
    await waitFor(() => fetch(scope).then((r) => r.ok).catch(() => false), `server at ${mount}`);
    const c = await newTab(cdpPort);
    await c.send("Page.navigate", { url: scope });
    await waitFor(() => c.evalJs("!!window.__sepiaApi && __sepiaApi.state.screen === 'start'"), "start screen");
    const reg = await waitFor(
      // ready never settles when install fails, so it races a short timer.
      () =>
        c.evalJs(`Promise.race([
          navigator.serviceWorker.ready.then((r) => (navigator.serviceWorker.controller ? r.scope : "")),
          new Promise((resolve) => setTimeout(() => resolve(""), 1000)),
        ])`),
      "worker active and in control",
    );
    check(`${mount}: the worker registers with the page's own scope`, reg === scope, reg);

    server.kill();
    server = null;
    await waitFor(() => fetch(scope).then(() => false).catch(() => true), "server gone");
    await c.send("Page.reload", { ignoreCache: false });
    const offline = await waitFor(
      () => c.evalJs("!!window.__sepiaApi && __sepiaApi.state.screen === 'start' && !!document.getElementById('btn-demo')"),
      "offline start screen",
    ).catch((err) => String(err));
    check(`${mount}: offline reload renders the start screen`, offline === true, offline);
    await c.evalJs("document.getElementById('btn-demo').click(), true");
    await waitFor(() => c.evalJs("__sepiaApi.state.screen === 'edit'"), "offline demo");
    const demo = await c.evalJs("({ gps: !!__sepiaApi.state.report.gps, items: __sepiaApi.state.report.items.length })");
    check(`${mount}: the demo opens offline`, demo.gps && demo.items > 5, JSON.stringify(demo));

    // A form submit cannot do this: the page CSP has form-action 'none'.
    const post = await c.evalJs(`(async () => {
      const cv = new OffscreenCanvas(20, 14);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#3a6ea5";
      ctx.fillRect(0, 0, 20, 14);
      const body = new FormData();
      body.append("image", new File([await cv.convertToBlob({ type: "image/png" })], "shared.png", { type: "image/png" }));
      const reg = await navigator.serviceWorker.ready;
      const res = await fetch(new URL("share", reg.scope), { method: "POST", body, redirect: "manual" });
      return res.type;
    })()`);
    check(`${mount}: the worker answers a share POST with a redirect`, post === "opaqueredirect", post);
    await c.send("Page.navigate", { url: `${scope}?share-target=1` });
    await waitFor(() => c.evalJs("!!window.__sepiaApi && __sepiaApi.state.screen === 'edit'"), "shared image open");
    const picked = await c.evalJs(`(async () => ({
      w: __sepiaApi.session().editor.width,
      h: __sepiaApi.session().editor.height,
      parked: (await (await caches.open("sepia-share")).keys()).length,
      search: location.search,
      errs: (__sepiaErrors || []).slice(0, 5),
    }))()`);
    check(`${mount}: share-target opens the shared image`, picked.w === 20 && picked.h === 14, JSON.stringify(picked));
    check(`${mount}: the share cache is empty after pickup`, picked.parked === 0, String(picked.parked));
    check(`${mount}: the pickup leaves no ?share-target in the address`, picked.search === "", picked.search);
    check(`${mount}: no page errors`, picked.errs.length === 0, JSON.stringify(picked.errs));
    c.close();
  } finally {
    server?.kill();
  }
}

async function main() {
  const cdpPort = await freePort();
  const profile = mkdtempSync(path.join(tmpdir(), "sepia-e2e-offline-"));
  const chromium = spawn(
    "chromium",
    ["--headless=new", `--remote-debugging-port=${cdpPort}`, "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "about:blank"],
    { stdio: "ignore" },
  );
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.ok).catch(() => false), "devtools up");
    await run(cdpPort, "/");
    await run(cdpPort, "/sepia/");
  } finally {
    chromium.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
  if (fails.length) {
    console.log("FAILS:", fails.join("; "));
    process.exit(1);
  }
  console.log("E2E OFFLINE PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
