// JPEG segment walker. Finds every marker segment before the image data,
// classifies the metadata-bearing ones, and locates the true end of image so
// trailing payloads (motion-photo videos, appended archives) get caught.

import { ascii, startsWith, sigBytes, u16 } from "./bytes.js";

const SIG_EXIF = sigBytes("Exif\0\0");
const SIG_XMP = sigBytes("http://ns.adobe.com/xap/1.0/\0");
const SIG_XMP_EXT = sigBytes("http://ns.adobe.com/xmp/extension/\0");
const SIG_ICC = sigBytes("ICC_PROFILE\0");
const SIG_MPF = sigBytes("MPF\0");
const SIG_IPTC = sigBytes("Photoshop 3.0\0");
const SIG_JFIF = sigBytes("JFIF\0");

function classify(marker, bytes, payloadOff) {
  if (marker === 0xe0 && startsWith(bytes, payloadOff, SIG_JFIF)) return "jfif";
  if (marker === 0xe1) {
    if (startsWith(bytes, payloadOff, SIG_EXIF)) return "exif";
    if (startsWith(bytes, payloadOff, SIG_XMP)) return "xmp";
    if (startsWith(bytes, payloadOff, SIG_XMP_EXT)) return "xmp-ext";
  }
  if (marker === 0xe2) {
    if (startsWith(bytes, payloadOff, SIG_ICC)) return "icc";
    if (startsWith(bytes, payloadOff, SIG_MPF)) return "mpf";
  }
  if (marker === 0xed && startsWith(bytes, payloadOff, SIG_IPTC)) return "iptc";
  if (marker === 0xfe) return "comment";
  if (marker >= 0xe0 && marker <= 0xef) return "app";
  return "other";
}

// After an SOS the stream is entropy-coded: 0xFF is either stuffed (FF 00),
// a restart marker (FF D0-D7), or the next real marker. Returns the offset of
// the next real marker's 0xFF, or null when the data runs out.
function skipEntropy(bytes, off) {
  let i = off;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const m = bytes[i + 1];
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xff) {
      i++;
      continue;
    }
    return i;
  }
  return null;
}

// Returns { ok, segments, eoiEnd, trailer } where segments carry
// { marker, kind, off, len, payloadOff, payloadLen } and trailer is
// { off, len } for any bytes past the final EOI marker.
export function scanJpeg(bytes) {
  if (!startsWith(bytes, 0, [0xff, 0xd8])) return { ok: false, segments: [], trailer: null };
  const segments = [];
  let i = 2;
  let eoiEnd = null;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      // Garbage between segments; tolerate a small run, then give up.
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd9) {
      eoiEnd = i + 2;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = u16(bytes, i + 2);
    if (len === null || len < 2) break;
    const payloadOff = i + 4;
    const payloadLen = len - 2;
    if (payloadOff + payloadLen > bytes.length) break;
    segments.push({
      marker,
      kind: classify(marker, bytes, payloadOff),
      off: i,
      len: len + 2,
      payloadOff,
      payloadLen,
    });
    i = i + 2 + len;
    if (marker === 0xda) {
      const next = skipEntropy(bytes, i);
      if (next === null) break;
      i = next;
    }
  }
  const trailer =
    eoiEnd !== null && eoiEnd < bytes.length
      ? { off: eoiEnd, len: bytes.length - eoiEnd }
      : null;
  return { ok: true, segments, eoiEnd, trailer };
}

// The Exif payload minus its "Exif\0\0" prefix, as a subarray into the file.
export function exifPayload(bytes, segment) {
  if (segment.kind !== "exif") return null;
  return bytes.subarray(segment.payloadOff + SIG_EXIF.length, segment.payloadOff + segment.payloadLen);
}

export function xmpPayload(bytes, segment) {
  if (segment.kind !== "xmp") return null;
  return bytes.subarray(segment.payloadOff + SIG_XMP.length, segment.payloadOff + segment.payloadLen);
}

// A short sniff of what a trailer most likely is, for the report.
export function sniffTrailer(bytes, trailer) {
  const head = ascii(bytes, trailer.off, Math.min(16, trailer.len)) || "";
  if (head.startsWith("\xff\xd8")) return "embedded JPEG";
  if (head.includes("ftyp")) return "embedded video (motion photo)";
  if (head.startsWith("PK")) return "embedded ZIP archive";
  return "unidentified data";
}
