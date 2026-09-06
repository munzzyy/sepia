// WebP RIFF walker. Surfaces EXIF, XMP, and ICC chunks.

import { ascii, startsWith, sigBytes, u32 } from "./bytes.js";

export function scanWebp(bytes) {
  if (!startsWith(bytes, 0, sigBytes("RIFF")) || ascii(bytes, 8, 4) !== "WEBP") {
    return { ok: false, chunks: [], trailer: null, incomplete: true };
  }
  const riffLen = u32(bytes, 4, true);
  const chunks = [];
  let i = 12;
  let broke = false;
  const end = Math.min(bytes.length, 8 + (riffLen ?? bytes.length));
  while (i + 8 <= end) {
    const type = ascii(bytes, i, 4);
    const len = u32(bytes, i + 4, true);
    if (type === null || len === null || i + 8 + len > bytes.length) {
      broke = true;
      break;
    }
    chunks.push({ type, off: i, len: len + 8, payloadOff: i + 8, payloadLen: len });
    i += 8 + len + (len % 2);
  }
  const trailer = end < bytes.length ? { off: end, len: bytes.length - end } : null;
  return { ok: true, chunks, trailer, incomplete: broke };
}

// The EXIF chunk payload is TIFF, sometimes with a stray "Exif\0\0" prefix.
export function webpExifPayload(bytes, chunk) {
  const off = startsWith(bytes, chunk.payloadOff, sigBytes("Exif\0\0"))
    ? chunk.payloadOff + 6
    : chunk.payloadOff;
  return bytes.subarray(off, chunk.payloadOff + chunk.payloadLen);
}
