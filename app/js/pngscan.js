// PNG chunk walker. Surfaces the text chunks (tEXt/zTXt/iTXt), embedded Exif
// (eXIf), timestamps (tIME), and anything appended after IEND.

import { ascii, asciiZ, inflate, startsWith, u32, utf8 } from "./bytes.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function scanPng(bytes) {
  if (!startsWith(bytes, 0, PNG_SIG)) return { ok: false, chunks: [], trailer: null };
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
  const trailer =
    iendEnd !== null && iendEnd < bytes.length
      ? { off: iendEnd, len: bytes.length - iendEnd }
      : null;
  return { ok: true, chunks, trailer };
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
