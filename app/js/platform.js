// The seam between the page and the Android wrapper. On the web every export
// is a download or a Web Share; in the wrapper the SepiaNative bridge hands
// bytes to the OS share sheet or the gallery without touching the network,
// which the app could not do anyway: the APK has no internet permission.

import { toBase64 } from "./bytes.js";

const native = () => globalThis.SepiaNative;

export const isWrapper = () => !!native();

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

export function onShared(cb) {
  globalThis.__sepiaShared = cb;
}
