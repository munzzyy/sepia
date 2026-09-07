// DOM glue outside the canvas: screens, the X-ray drawer, the proof page,
// toasts, and live-region announcements.

import { t } from "./i18n.js";
import { headline, gpsWords, severityWord } from "./report.js";
import { paintOps } from "./editor.js";

function paintOpsSplit(editor) {
  const ops = editor ? paintOps(editor) : [];
  return {
    ink: ops.filter((o) => o.type === "ink").length,
    pixelate: ops.filter((o) => o.type === "pixelate").length,
  };
}

export const $ = (id) => document.getElementById(id);

let toastTimer = 0;
export function toast(msg, ms = 3500) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  announce(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, ms);
}

export function announce(msg) {
  $("sr-live").textContent = msg;
}

const SCREENS = ["start", "edit", "done"];
export function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  if (name === "edit") {
    const wanted = "#edit";
    if (location.hash !== wanted) history.pushState(null, "", wanted);
  } else if (name === "done") {
    if (location.hash !== "#done") history.pushState(null, "", "#done");
  } else if (location.hash) {
    history.pushState(null, "", location.pathname + location.search);
  }
  window.scrollTo(0, 0);
  // A screen switch removes whatever held focus; land it somewhere real so
  // keyboard and screen-reader users are not dropped back to <body>. The
  // very first paint keeps the browser's default (the skip link stays
  // first) instead of yanking focus on page load.
  if (!firstScreenShown) {
    firstScreenShown = true;
    return;
  }
  if (name === "done") $("done-title").focus({ preventScroll: true });
  else if (name === "start") $("dropzone").focus({ preventScroll: true });
  else $("canvas").focus({ preventScroll: true });
}

let firstScreenShown = false;

export function riskPill(report) {
  const el = $("risk-pill");
  el.className = "risk-pill";
  if (!report) {
    el.textContent = "";
    return;
  }
  if (!report.analyzed) {
    el.classList.add("medium");
    el.textContent = t("Can't list what's inside this kind of file");
  } else if (report.counts.high > 0) {
    el.classList.add("high");
    el.textContent =
      report.counts.high === 1
        ? t("1 serious leak in this file")
        : t("{count} serious leaks in this file", { count: report.counts.high });
  } else if (report.counts.medium > 0) {
    el.classList.add("medium");
    el.textContent =
      report.counts.medium === 1
        ? t("1 revealing detail in this file")
        : t("{count} revealing details in this file", { count: report.counts.medium });
  } else {
    el.classList.add("clean");
    el.textContent = t("No metadata leaks found");
  }
}

let thumbUrl = null;

export function renderXray(report, actions) {
  $("xray-headline").textContent = headline(report);
  const list = $("xray-list");
  list.textContent = "";
  if (thumbUrl) {
    URL.revokeObjectURL(thumbUrl);
    thumbUrl = null;
  }
  $("thumb-reveal").hidden = true;

  if (report.items.length === 0) {
    const li = document.createElement("li");
    li.textContent = t("Nothing found beyond the pixels themselves.");
    list.append(li);
    return;
  }

  for (const item of report.items) {
    const li = document.createElement("li");
    const sev = document.createElement("span");
    sev.className = `sev sev-${item.severity}`;
    sev.textContent = severityWord(item.severity);
    const body = document.createElement("div");
    const label = document.createElement("span");
    label.className = "xray-label";
    // Labels and details are a closed set of English strings; translating
    // at render time keeps the parser layer free of UI concerns.
    label.textContent = t(item.label) + ": ";
    const value = document.createElement("span");
    value.className = "xray-value";
    value.textContent = item.value;
    body.append(label, value);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "xray-detail";
      detail.textContent = t(item.detail);
      body.append(detail);
    }
    li.append(sev, body);

    if (item.id === "gps" && report.gps) {
      li.append(actionButton(t("Copy"), () => actions.copyGps(report.gps)));
    }
    if (item.id === "thumbnail" && report.thumbnail) {
      li.append(
        actionButton(t("Show"), () => {
          const reveal = $("thumb-reveal");
          if (!reveal.hidden) {
            reveal.hidden = true;
            return;
          }
          if (!thumbUrl) {
            thumbUrl = URL.createObjectURL(new Blob([report.thumbnail], { type: "image/jpeg" }));
            const img = $("thumb-img");
            img.src = thumbUrl;
            img.alt = t("The hidden preview image found inside the file");
          }
          reveal.hidden = false;
        }),
      );
    }
    list.append(li);
  }
}

function actionButton(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "xray-act";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export function setXrayOpen(open) {
  $("xray").hidden = !open;
  $("btn-xray").setAttribute("aria-expanded", String(open));
}

let previewUrl = null;

// Blob URLs hold the very bytes the app exists to contain; a closed session
// must leave none of them resolvable.
export function releaseUrls() {
  if (thumbUrl) {
    URL.revokeObjectURL(thumbUrl);
    thumbUrl = null;
    $("thumb-img").removeAttribute("src");
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $("done-preview").removeAttribute("src");
  }
  $("thumb-reveal").hidden = true;
}

export function renderProof({ report, editor, verify, blob, name, origName }) {
  const clean = verify.clean;
  const badge = $("done-badge");
  badge.textContent = clean ? "✓" : "!";
  badge.classList.toggle("warn", !clean);
  $("done-title").textContent = clean ? t("Checked clean") : t("Something survived");
  $("done-sub").textContent = clean
    ? t("The exported file was re-opened and re-scanned. What's left is generic encoder output like color profile and format markers, nothing that names you.")
    : t("The exported file was re-scanned and something is still in it. Details below.");

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const img = $("done-preview");
  img.src = previewUrl;
  img.alt = t("Preview of the scrubbed image");

  const removed = $("done-removed");
  removed.textContent = "";
  // The values themselves (exact coordinates, names) stay collapsed: this
  // screen is the one most likely to be visible at share time.
  const secretItems = report.items.filter(
    (i) => i.severity !== "low" && !verify.leftovers.some((l) => l.id === i.id),
  );
  for (const item of secretItems) {
    const li = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = t("{label}: removed", { label: t(item.label) });
    const value = document.createElement("span");
    value.className = "done-secret";
    value.textContent = item.value;
    details.append(summary, value);
    li.append(details);
    removed.append(li);
  }
  const plain = [];
  const lowCount = report.counts.low;
  if (lowCount) plain.push(t("{count} technical fields", { count: lowCount }));
  const ops = paintOpsSplit(editor);
  if (ops.ink) plain.push(t("{count} area(s) inked over, permanently", { count: ops.ink }));
  if (ops.pixelate)
    plain.push(t("{count} area(s) pixelated. Pixelation is weaker than ink on text.", { count: ops.pixelate }));
  if (editor?.crop) plain.push(t("Everything outside the crop"));
  if (secretItems.length === 0 && plain.length === 0)
    plain.push(t("Nothing needed removing; the file was re-encoded anyway."));
  for (const text of plain) {
    const li = document.createElement("li");
    li.textContent = text;
    removed.append(li);
  }
  $("done-name").textContent = origName
    ? t("Will be saved as {name}. The original name ({orig}) stays with the original.", { name, orig: origName })
    : t("Will be saved as {name}.", { name });

  const leftoverWrap = $("done-leftover");
  leftoverWrap.hidden = clean;
  if (!clean) {
    const ul = $("done-leftover-list");
    ul.textContent = "";
    for (const item of verify.leftovers) {
      const li = document.createElement("li");
      li.textContent = `${item.label}: ${item.value}`;
      ul.append(li);
    }
  }

  $("done-size").textContent = formatSize(blob.size);
}

export function formatSize(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function copyGpsAction(gps) {
  const text = gpsWords(gps);
  navigator.clipboard?.writeText(text).then(
    () => toast(t("Coordinates copied. Careful: clipboards can be synced or kept in history.")),
    () => toast(text),
  );
}
