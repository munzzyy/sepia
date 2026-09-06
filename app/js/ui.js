// DOM glue outside the canvas: screens, the X-ray drawer, the proof page,
// toasts, and live-region announcements.

import { t } from "./i18n.js";
import { headline, gpsWords, severityWord } from "./report.js";

export const $ = (id) => document.getElementById(id);

let toastTimer = 0;
export function toast(msg, ms = 3500) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
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
}

export function riskPill(report) {
  const el = $("risk-pill");
  el.className = "risk-pill";
  if (!report) {
    el.textContent = "";
    return;
  }
  if (report.counts.high > 0) {
    el.classList.add("high");
    el.textContent = t("{count} serious leaks in this file", { count: report.counts.high });
  } else if (report.counts.medium > 0) {
    el.classList.add("medium");
    el.textContent = t("{count} revealing details in this file", { count: report.counts.medium });
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
    label.textContent = item.label + ": ";
    const value = document.createElement("span");
    value.className = "xray-value";
    value.textContent = item.value;
    body.append(label, value);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "xray-detail";
      detail.textContent = item.detail;
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

export function renderProof({ report, opsCount, cropUsed, verify, blob, name, origName }) {
  const clean = verify.clean;
  const badge = $("done-badge");
  badge.textContent = clean ? "✓" : "!";
  badge.classList.toggle("warn", !clean);
  $("done-title").textContent = clean ? t("Checked clean") : t("Something survived");
  $("done-sub").textContent = clean
    ? t("The exported file was re-opened and re-scanned. Nothing above harmless technical detail remains.")
    : t("The exported file was re-scanned and something is still in it. Details below.");

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const img = $("done-preview");
  img.src = previewUrl;
  img.alt = t("Preview of the scrubbed image");

  const removed = $("done-removed");
  removed.textContent = "";
  const lines = [];
  for (const item of report.items.filter((i) => i.severity !== "low")) {
    lines.push(`${item.label}: ${item.value}`);
  }
  const lowCount = report.counts.low;
  if (lowCount) lines.push(t("{count} technical fields", { count: lowCount }));
  if (opsCount) lines.push(t("{count} area(s) permanently covered", { count: opsCount }));
  if (cropUsed) lines.push(t("Everything outside the crop"));
  if (lines.length === 0) lines.push(t("Nothing needed removing; the file was re-encoded anyway."));
  for (const text of lines) {
    const li = document.createElement("li");
    li.textContent = text;
    removed.append(li);
  }
  $("done-name").textContent = origName
    ? t("Saved as {name}. The original name ({orig}) stays with the original.", { name, orig: origName })
    : t("Saved as {name}.", { name });

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
    () => toast(t("Coordinates copied")),
    () => toast(text),
  );
}
