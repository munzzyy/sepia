// The seam between the page and the wrappers. On the web every export is a
// download or a Web Share; the Android wrapper's SepiaNative bridge hands
// bytes to the OS share sheet or the gallery without touching the network,
// which the app could not do anyway: the APK has no internet permission. The
// iOS wrapper has no SepiaNative (no addJavascriptInterface equivalent); it
// runs on the fixed sepia: scheme instead and offers a narrower save-only
// bridge over webkit.messageHandlers.save.

import { toBase64 } from "./bytes.js";

const native = () => globalThis.SepiaNative;

export const isWrapper = () => !!native();

// True only on the iOS wrapper's own origin. A page served over https could
// never satisfy this, so it cannot be used to fake wrapper status from the
// outside; that is also why the bridge check below requires this AND the
// message handler, not either alone.
export const isIOSWrapped = () => globalThis.location?.protocol === "sepia:";

// UI-only distinction: "does this look like a native app, so hide the
// marketing landing and stop offering browser-only install hints". Separate
// from capability checks below, which stay per-feature.
export const isBundled = () => isWrapper() || isIOSWrapped();

const iosSaveHandler = () => globalThis.webkit?.messageHandlers?.save;
const hasIOSBridge = () => isIOSWrapped() && !!iosSaveHandler();

export const wrapperVersion = () => {
  try {
    return native()?.version() || "";
  } catch {
    return "";
  }
};

async function blobBase64(blob) {
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

export async function shareOut(blob, name) {
  if (native()) {
    native().shareImage(await blobBase64(blob), blob.type, name);
    return true;
  }
  // iOS has no navigator.share with files inside a WKWebView, so the only
  // real hand-off is the message bridge; both buttons end up at the same
  // share sheet there, which is honest since that sheet is what decides.
  if (hasIOSBridge()) {
    iosSaveHandler().postMessage({ name, mime: blob.type, b64: await blobBase64(blob) });
    return true;
  }
  if (isIOSWrapped()) return false;
  if (navigator.canShare) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (err) {
        if (err?.name === "AbortError") return true;
      }
    }
  }
  return false;
}

export async function saveOut(blob, name) {
  if (native()) {
    native().saveImage(await blobBase64(blob), blob.type, name);
    return "gallery";
  }
  if (hasIOSBridge()) {
    iosSaveHandler().postMessage({ name, mime: blob.type, b64: await blobBase64(blob) });
    return "handoff";
  }
  // Running as the iOS wrapper but the bridge never showed up: a stale
  // build, or the page loaded somewhere it should not have. Either way an
  // <a download> click against sepia://localhost goes nowhere (the wrapper
  // cancels that navigation), so caller must report a real failure instead
  // of a silent no-op dressed up as "Downloaded".
  if (isIOSWrapped()) return "unsupported";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "download";
}

// Shares handed to the wrapper arrive as one-shot tokens; the page reads
// the bytes back over the asset-loader origin, never through a JS string.
// Older bridges expose a single token, newer ones a JSON array.
export function sharedTokens() {
  try {
    const native_ = native();
    if (!native_) return [];
    if (typeof native_.sharedImageTokens === "function") {
      const parsed = JSON.parse(native_.sharedImageTokens() || "[]");
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x) : [];
    }
    const one = native_.sharedImageToken?.() || "";
    return one ? [one] : [];
  } catch {
    return [];
  }
}

// The wrapper calls __sepiaShared with an array of tokens (a legacy single
// string is normalized so an old wrapper still works with a new page).
export function onShared(cb) {
  globalThis.__sepiaShared = (payload) => {
    const tokens = Array.isArray(payload) ? payload : payload ? [String(payload)] : [];
    cb(tokens.filter((x) => typeof x === "string" && x));
  };
}
