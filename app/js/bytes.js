// Byte-level helpers shared by every container walker. All readers are
// bounds-checked and return null past the end instead of throwing, because
// the walkers run on arbitrary hostile files and must degrade to "could not
// parse", never to an exception that kills the report.

export function u8(bytes, off) {
  return off >= 0 && off < bytes.length ? bytes[off] : null;
}

export function u16(bytes, off, littleEndian = false) {
  if (off < 0 || off + 2 > bytes.length) return null;
  return littleEndian
    ? bytes[off] | (bytes[off + 1] << 8)
    : (bytes[off] << 8) | bytes[off + 1];
}

export function u32(bytes, off, littleEndian = false) {
  if (off < 0 || off + 4 > bytes.length) return null;
  return littleEndian
    ? (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0
    : ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}

export function ascii(bytes, off, len) {
  if (off < 0 || off + len > bytes.length) return null;
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[off + i]);
  return out;
}

// ASCII up to the first NUL, for NUL-terminated fields inside a bounded slot.
export function asciiZ(bytes, off, maxLen) {
  const raw = ascii(bytes, off, Math.min(maxLen, bytes.length - off));
  if (raw === null) return null;
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

export function startsWith(bytes, off, sig) {
  if (off < 0 || off + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[off + i] !== sig[i]) return false;
  }
  return true;
}

export function sigBytes(str) {
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

export function utf8(bytes, off, len) {
  if (off < 0 || off + len > bytes.length) return null;
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(off, off + len));
  } catch {
    return null;
  }
}

// Bounded: a 1 MB zTXt can inflate to gigabytes, and this runs on hostile
// files at open time. Everything past the cap is discarded, which is fine
// for a report that truncates text anyway.
export async function inflate(bytes, maxOut = 4 * 1024 * 1024) {
  try {
    const ds = new DecompressionStream("deflate");
    const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
    const parts = [];
    let total = 0;
    while (total < maxOut) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(total, maxOut));
    let off = 0;
    for (const p of parts) {
      const take = Math.min(p.length, out.length - off);
      out.set(p.subarray(0, take), off);
      off += take;
      if (off >= out.length) break;
    }
    return out;
  } catch {
    return null;
  }
}

export function toBase64(bytes) {
  // Chunked: String.fromCharCode(...bigArray) blows the argument limit.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
