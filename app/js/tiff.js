// TIFF / Exif IFD parser. Feed it the payload of a JPEG Exif segment, a PNG
// eXIf chunk, or a WebP EXIF chunk and it returns every field it can decode,
// plus the embedded thumbnail when there is one. Written for hostile input:
// every offset is bounds-checked, IFD chains cannot loop, and failure means
// fewer fields, not an exception.

import { ascii, u16, u32 } from "./bytes.js";

export const TAG_NAMES = {
  "0:0x010e": "Description",
  "0:0x010f": "Camera make",
  "0:0x0110": "Camera model",
  "0:0x0112": "Orientation",
  "0:0x0131": "Software",
  "0:0x0132": "Modified",
  "0:0x013b": "Artist",
  "0:0x8298": "Copyright",
  "0:0xc4a5": "Print image matching",
  "exif:0x829a": "Exposure time",
  "exif:0x829d": "F number",
  "exif:0x8822": "Exposure program",
  "exif:0x8827": "ISO",
  "exif:0x9003": "Taken",
  "exif:0x9004": "Digitized",
  "exif:0x9010": "Time zone",
  "exif:0x9011": "Time zone (original)",
  "exif:0x9201": "Shutter speed",
  "exif:0x9202": "Aperture",
  "exif:0x9204": "Exposure bias",
  "exif:0x9207": "Metering mode",
  "exif:0x9209": "Flash",
  "exif:0x920a": "Focal length",
  "exif:0x9286": "User comment",
  "exif:0x9290": "Subsecond time",
  "exif:0xa002": "Width",
  "exif:0xa003": "Height",
  "exif:0xa20e": "Focal plane X resolution",
  "exif:0xa215": "Exposure index",
  "exif:0xa300": "File source",
  "exif:0xa403": "White balance",
  "exif:0xa404": "Digital zoom",
  "exif:0xa405": "Focal length (35mm)",
  "exif:0xa406": "Scene type",
  "exif:0xa420": "Image unique ID",
  "exif:0xa430": "Owner name",
  "exif:0xa431": "Body serial number",
  "exif:0xa432": "Lens specification",
  "exif:0xa433": "Lens make",
  "exif:0xa434": "Lens model",
  "exif:0xa435": "Lens serial number",
  "gps:0x0000": "GPS version",
  "gps:0x0001": "Latitude ref",
  "gps:0x0002": "Latitude",
  "gps:0x0003": "Longitude ref",
  "gps:0x0004": "Longitude",
  "gps:0x0005": "Altitude ref",
  "gps:0x0006": "Altitude",
  "gps:0x0007": "GPS time",
  "gps:0x0008": "GPS satellites",
  "gps:0x000b": "GPS precision",
  "gps:0x000c": "GPS speed ref",
  "gps:0x000d": "GPS speed",
  "gps:0x0010": "Image direction ref",
  "gps:0x0011": "Image direction",
  "gps:0x001b": "GPS processing method",
  "gps:0x001d": "GPS date",
};

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };
const MAX_ENTRIES_PER_IFD = 256;
const MAX_VALUE_COUNT = 4096;

function readValue(bytes, type, count, off, le) {
  const size = TYPE_SIZES[type] * count;
  if (off < 0 || off + size > bytes.length) return null;
  switch (type) {
    case 2:
      return (ascii(bytes, off, count) || "").replace(/\0+$/, "");
    case 1:
    case 6:
    case 7: {
      if (count === 1) return bytes[off];
      return Array.from(bytes.subarray(off, off + count));
    }
    case 3: {
      const out = [];
      for (let i = 0; i < count; i++) out.push(u16(bytes, off + i * 2, le));
      return count === 1 ? out[0] : out;
    }
    case 4: {
      const out = [];
      for (let i = 0; i < count; i++) out.push(u32(bytes, off + i * 4, le));
      return count === 1 ? out[0] : out;
    }
    case 9: {
      const out = [];
      for (let i = 0; i < count; i++) out.push(u32(bytes, off + i * 4, le) | 0);
      return count === 1 ? out[0] : out;
    }
    case 5:
    case 10: {
      const out = [];
      for (let i = 0; i < count; i++) {
        let n = u32(bytes, off + i * 8, le);
        let d = u32(bytes, off + i * 8 + 4, le);
        if (type === 10) {
          n = n | 0;
          d = d | 0;
        }
        out.push([n, d]);
      }
      return count === 1 ? out[0] : out;
    }
    default:
      return null;
  }
}

function parseIfd(bytes, off, le, ifdName, out, visited) {
  if (visited.has(off) || off < 0 || off + 2 > bytes.length) return null;
  visited.add(off);
  const declared = u16(bytes, off, le);
  if (declared === null) return null;
  // A count past the cap still parses up to the cap; discarding the whole
  // IFD would let a padded file hide real fields behind fake ones.
  const count = Math.min(declared, MAX_ENTRIES_PER_IFD);
  if (declared > MAX_ENTRIES_PER_IFD) out.truncated = true;
  let subExif = null;
  let subGps = null;
  for (let i = 0; i < count; i++) {
    const e = off + 2 + i * 12;
    const tag = u16(bytes, e, le);
    const type = u16(bytes, e + 2, le);
    const valCount = u32(bytes, e + 4, le);
    if (tag === null || type === null || valCount === null) break;
    if (!TYPE_SIZES[type]) continue;
    if (valCount > MAX_VALUE_COUNT) {
      // Too big to decode (MakerNotes mostly), but its existence is exactly
      // what the X-ray reports; dropping it silently under-reported.
      out.fields.push({ ifd: ifdName, tag, type, count: valCount, value: null, oversized: true });
      continue;
    }
    const size = TYPE_SIZES[type] * valCount;
    const valOff = size <= 4 ? e + 8 : u32(bytes, e + 8, le);
    if (valOff === null) continue;
    const value = readValue(bytes, type, valCount, valOff, le);
    if (tag === 0x8769 && ifdName === "0") {
      subExif = value;
      continue;
    }
    if (tag === 0x8825 && ifdName === "0") {
      subGps = value;
      continue;
    }
    if (tag === 0xa005) continue;
    out.fields.push({ ifd: ifdName, tag, type, count: valCount, value });
  }
  if (typeof subExif === "number") parseIfd(bytes, subExif, le, "exif", out, visited);
  if (typeof subGps === "number") parseIfd(bytes, subGps, le, "gps", out, visited);
  // The next-IFD pointer sits after the DECLARED count; past the cap its
  // position is unknowable, so the chain honestly ends here.
  if (declared > MAX_ENTRIES_PER_IFD) return null;
  return u32(bytes, off + 2 + count * 12, le);
}

// Returns { ok, fields, thumbnail } where fields carry { ifd, tag, type,
// count, value, name } and thumbnail is a Uint8Array of embedded JPEG bytes
// when IFD1 points at one.
export function parseTiff(bytes) {
  const order = ascii(bytes, 0, 2);
  const le = order === "II";
  if (!le && order !== "MM") return { ok: false, fields: [], thumbnail: null };
  if (u16(bytes, 2, le) !== 42) return { ok: false, fields: [], thumbnail: null };
  const ifd0 = u32(bytes, 4, le);
  const out = { ok: true, fields: [], thumbnail: null, truncated: false };
  const visited = new Set();
  const ifd1Off = parseIfd(bytes, ifd0, le, "0", out, visited);
  if (typeof ifd1Off === "number" && ifd1Off > 0) {
    const thumb = { ok: true, fields: [], thumbnail: null, truncated: false };
    parseIfd(bytes, ifd1Off, le, "1", thumb, visited);
    const jpegOff = thumb.fields.find((f) => f.tag === 0x0201)?.value;
    const jpegLen = thumb.fields.find((f) => f.tag === 0x0202)?.value;
    if (
      typeof jpegOff === "number" &&
      typeof jpegLen === "number" &&
      jpegLen > 0 &&
      jpegOff + jpegLen <= bytes.length
    ) {
      out.thumbnail = bytes.subarray(jpegOff, jpegOff + jpegLen);
    }
    out.fields.push(...thumb.fields.filter((f) => f.tag !== 0x0201 && f.tag !== 0x0202));
    out.truncated = out.truncated || thumb.truncated;
  }
  for (const f of out.fields) {
    f.name = TAG_NAMES[`${f.ifd}:0x${f.tag.toString(16).padStart(4, "0")}`] || null;
  }
  return out;
}

const rat = (v) => (Array.isArray(v) && v.length === 2 ? (v[1] ? v[0] / v[1] : 0) : Number(v));

// Decimal degrees from the GPS IFD fields, or null when they do not add up.
export function gpsToDecimal(fields) {
  const get = (tag) => fields.find((f) => f.ifd === "gps" && f.tag === tag)?.value;
  const latRef = get(0x0001);
  const lat = get(0x0002);
  const lonRef = get(0x0003);
  const lon = get(0x0004);
  if (!Array.isArray(lat) || !Array.isArray(lon) || lat.length < 3 || lon.length < 3) return null;
  const dec = (dms) => rat(dms[0]) + rat(dms[1]) / 60 + rat(dms[2]) / 3600;
  let latitude = dec(lat);
  let longitude = dec(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (String(latRef).toUpperCase().startsWith("S")) latitude = -latitude;
  if (String(lonRef).toUpperCase().startsWith("W")) longitude = -longitude;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const altRaw = get(0x0006);
  const altRef = get(0x0005);
  let altitude = null;
  if (altRaw !== undefined) {
    altitude = rat(altRaw);
    if (altRef === 1) altitude = -altitude;
    if (!Number.isFinite(altitude)) altitude = null;
  }
  return { latitude, longitude, altitude };
}
