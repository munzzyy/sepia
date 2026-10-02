// PNG chunk walker. Surfaces the text chunks (tEXt/zTXt/iTXt), embedded Exif
// (eXIf), timestamps (tIME), and anything appended after IEND.

import { ascii, asciiZ, inflate, startsWith, u32, utf8 } from "./bytes.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Structural and color chunks a normal encoder writes; anything else must
// show up in the report, not vanish (a custom ancillary chunk carries data
// exactly as well as a tEXt).
export const PNG_BENIGN = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT",
  "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT",
]);

export function scanPng(bytes) {
  if (!startsWith(bytes, 0, PNG_SIG)) return { ok: false, chunks: [], trailer: null, incomplete: true };
  const chunks = [];
  let i = 8;
  let iendEnd = null;
  while (i + 8 <= bytes.length) {
    const len = u32(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    if (len === null || type === null || i + 12 + len > bytes.length) break;
    chunks.push({ type, off: i, len: len + 12, payloadOff: i + 8, payloadLen: len });
    i += 12 + len;
    if (type === "IEND") {
      iendEnd = i;
      break;
    }
  }
  // No IEND seen means the walk was cut short; whatever remains is treated
  // as an appended payload instead of silently ignored.
  const incomplete = iendEnd === null;
  let trailer = null;
  if (iendEnd !== null && iendEnd < bytes.length) {
    trailer = { off: iendEnd, len: bytes.length - iendEnd };
  } else if (incomplete && i < bytes.length) {
    trailer = { off: i, len: bytes.length - i };
  }
  return { ok: true, chunks, trailer, incomplete };
}

// Decoded { keyword, text } for a text chunk, inflating when compressed.
// Truncates long values; the report needs the gist, not a megabyte of XMP.
export async function pngText(bytes, chunk, maxText = 2048) {
  const { type, payloadOff, payloadLen } = chunk;
  const end = payloadOff + payloadLen;
  if (type === "tEXt") {
    const keyword = asciiZ(bytes, payloadOff, Math.min(80, payloadLen));
    if (keyword === null) return null;
    const textOff = payloadOff + keyword.length + 1;
    return { keyword, text: ascii(bytes, textOff, Math.min(end - textOff, maxText)) || "" };
  }
  if (type === "zTXt") {
    const keyword = asciiZ(bytes, payloadOff, Math.min(80, payloadLen));
    if (keyword === null) return null;
    const dataOff = payloadOff + keyword.length + 2;
    if (dataOff >= end) return { keyword, text: "" };
    const raw = await inflate(bytes.subarray(dataOff, end));
    return { keyword, text: raw ? (utf8(raw, 0, Math.min(raw.length, maxText)) || "") : "(could not decompress)" };
  }
  if (type === "iTXt") {
    const keyword = asciiZ(bytes, payloadOff, Math.min(80, payloadLen));
    if (keyword === null) return null;
    let p = payloadOff + keyword.length + 1;
    const compressed = bytes[p] === 1;
    p += 2;
    const lang = asciiZ(bytes, p, end - p);
    if (lang === null) return null;
    p += lang.length + 1;
    const translated = asciiZ(bytes, p, end - p);
    if (translated === null) return null;
    p += translated.length + 1;
    if (p > end) return { keyword, text: "" };
    if (compressed) {
      const raw = await inflate(bytes.subarray(p, end));
      return { keyword, text: raw ? (utf8(raw, 0, Math.min(raw.length, maxText)) || "") : "(could not decompress)" };
    }
    return { keyword, text: utf8(bytes, p, Math.min(end - p, maxText)) || "" };
  }
  return null;
}

// Encoder output only: Firefox's fingerprinting protection tags canvas PNGs with a per-profile deBG chunk.
export function stripPngExtras(bytes) {
  const scan = scanPng(bytes);
  if (!scan.ok || scan.incomplete) return bytes;
  const kept = scan.chunks.filter((c) => PNG_BENIGN.has(c.type) || c.type === "iCCP");
  if (kept.length === scan.chunks.length) return bytes;
  const tail = scan.trailer ? bytes.subarray(scan.trailer.off) : new Uint8Array(0);
  const out = new Uint8Array(8 + kept.reduce((n, c) => n + c.len, 0) + tail.length);
  out.set(bytes.subarray(0, 8), 0);
  let at = 8;
  for (const c of kept) {
    out.set(bytes.subarray(c.off, c.off + c.len), at);
    at += c.len;
  }
  out.set(tail, at);
  return out;
}
