// The metadata X-ray. Takes raw file bytes, returns everything the file says
// beyond its pixels, ranked by how badly it can hurt the person sharing it.
// Severity: "high" = identifies you or a place, "medium" = narrows you down,
// "low" = harmless technical detail. The same report runs on exported bytes
// to prove the scrub worked, so it must be honest in both directions.

import { startsWith, sigBytes, utf8, inflate, asciiZ } from "./bytes.js";
import { scanJpeg, exifPayload, xmpPayload, sniffTrailer, TRAILER_KINDS } from "./jpegscan.js";
import { parseTiff, gpsToDecimal } from "./tiff.js";
import { scanPng, pngText, PNG_BENIGN } from "./pngscan.js";
import { scanWebp, webpExifPayload } from "./webpscan.js";

export function sniffFormat(bytes) {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, 0, sigBytes("RIFF")) && startsWith(bytes, 8, sigBytes("WEBP"))) return "webp";
  if (startsWith(bytes, 0, sigBytes("GIF8"))) return "gif";
  if (startsWith(bytes, 0, sigBytes("BM"))) return "bmp";
  if (startsWith(bytes, 4, sigBytes("ftyp"))) {
    const brand = utf8(bytes, 8, 4) || "";
    if (brand.startsWith("avi")) return "avif";
    if (brand.startsWith("hei") || brand.startsWith("mif")) return "heif";
    return "isobmff";
  }
  return "unknown";
}

export const HIGH_TAGS = new Set([
  "Artist",
  "Owner name",
  "Body serial number",
  "Lens serial number",
  "Image unique ID",
  "MakerNote",
  "Windows author",
  "GPS area information",
  "GPS processing method",
  "Photographer",
  "Image editor",
  "Host computer",
  "Destination latitude ref",
  "Destination latitude",
  "Destination longitude ref",
  "Destination longitude",
  "Destination bearing ref",
  "Destination bearing",
  "Destination distance ref",
  "Destination distance",
]);
export const MEDIUM_TAGS = new Set([
  "Camera make",
  "Camera model",
  "Software",
  "Modified",
  "Taken",
  "Digitized",
  "Lens make",
  "Lens model",
  "Lens specification",
  "Description",
  "Copyright",
  "User comment",
  "Time zone",
  "Time zone (original)",
  "GPS date",
  "GPS time",
  "Windows title",
  "Windows comment",
  "Windows keywords",
  "Windows subject",
  "Image title",
  "Document name",
  "Page name",
  "Camera firmware",
  "RAW developing software",
  "Image editing software",
  "Metadata editing software",
]);
const HIGH_PNG_KEYWORDS = new Set(["author", "artist", "copyright", "source", "location"]);

// A computed value the UI translates; vars carry raw data, and arrays in vars are words to translate.
function tv(template, vars) {
  if (!vars) return { value: template, valueT: template };
  const value = template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? [].concat(vars[k]).join(", ") : m));
  return { value, valueT: template, vars };
}

function fmtValue(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      return v[1] ? String(Math.round((v[0] / v[1]) * 1000) / 1000) : `${v[0]}/0`;
    }
    return v.slice(0, 8).map(fmtValue).join(", ") + (v.length > 8 ? "…" : "");
  }
  return String(v).slice(0, 120);
}

// Unnamed tags holding text: ASCII with a letter in it, or BYTE/UNDEFINED that is all printable.
function unnamedText(f) {
  if (f.type === 2 && typeof f.value === "string") {
    const s = f.value.trim();
    return s.length >= 4 && /\p{L}/u.test(s) ? s : null;
  }
  if ((f.type === 1 || f.type === 7) && Array.isArray(f.value)) {
    let end = f.value.length;
    while (end > 0 && f.value[end - 1] === 0) end--;
    if (end < 8 || !f.value.slice(0, end).every((b) => b >= 0x20 && b <= 0x7e)) return null;
    return String.fromCharCode(...f.value.slice(0, end));
  }
  return null;
}

function pushExifItems(items, tiff, out) {
  let settings = 0;
  let unknown = 0;
  for (const f of tiff.fields) {
    const name = f.name;
    if (!name) {
      const tag = `0x${f.tag.toString(16).padStart(4, "0")}`;
      if (f.ifd === "gps") {
        const text = fmtValue(f.value);
        const value = text ? { value: `${tag}: ${text}` } : tv("{tag}: present, too large to decode", { tag });
        items.push({ id: `exif:gps:${tag}`, severity: "high", label: "Unnamed GPS field", ...value });
        continue;
      }
      const text = unnamedText(f);
      if (text) {
        items.push({ id: `exif:text:${f.ifd}:${tag}`, severity: "medium", label: "Unnamed text field", value: `${tag}: ${text.slice(0, 120)}` });
        continue;
      }
      unknown++;
      continue;
    }
    const severity = HIGH_TAGS.has(name) ? "high" : MEDIUM_TAGS.has(name) ? "medium" : null;
    if (severity) {
      const text = fmtValue(f.value);
      if (text) items.push({ id: `exif:${name}`, severity, label: name, value: text });
      else if (f.oversized) items.push({ id: `exif:${name}`, severity, label: name, ...tv("present, too large to decode") });
      continue;
    }
    settings++;
  }
  if (settings) {
    items.push({
      id: "exif:settings",
      severity: "low",
      label: "Camera settings",
      ...tv("{count} technical fields", { count: settings }),
    });
  }
  if (unknown) {
    items.push({
      id: "exif:other",
      severity: "low",
      label: "Other Exif fields",
      ...tv("{count} maker or unknown fields", { count: unknown }),
    });
  }
  const gps = gpsToDecimal(tiff.fields);
  if (gps) {
    out.gps = gps;
    const coords = `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
    items.unshift({
      id: "gps",
      severity: "high",
      label: "Location",
      ...(gps.altitude !== null ? tv("{coords}, {alt} m altitude", { coords, alt: Math.round(gps.altitude) }) : { value: coords }),
      detail: "Exact coordinates of where this image was taken.",
    });
  } else if (tiff.fields.some((f) => f.ifd === "gps" && f.tag >= 1 && f.tag <= 6)) {
    items.unshift({
      id: "gps-partial",
      severity: "high",
      label: "Location fields",
      ...tv("GPS data present but not fully readable"),
    });
  }
  if (tiff.thumbnail) {
    out.thumbnail = tiff.thumbnail;
    items.push({
      id: "thumbnail",
      severity: "high",
      label: "Hidden preview image",
      ...tv("{bytes} bytes", { bytes: tiff.thumbnail.length.toLocaleString() }),
      detail:
        "A second, smaller copy of the photo stored inside the file. Croppings and edits sometimes leave the original preview behind.",
    });
  }
  if (tiff.truncated) {
    items.push({
      id: "exif:truncated",
      severity: "medium",
      label: "Exif field list truncated",
      ...tv("more fields exist than could be read"),
    });
  }
}

// A block that parses to nothing still carries bytes; it must not read as clean.
function exifItems(items, tiff, out) {
  if (tiff.ok && (tiff.fields.length || tiff.thumbnail)) pushExifItems(items, tiff, out);
  else items.push({ id: "exif:unreadable", severity: "medium", label: "Exif block", ...tv("present but unreadable") });
}

const ACSP = sigBytes("acsp");
const iccItem = (ok) =>
  ok
    ? { id: "icc", severity: "low", label: "Color profile", ...tv("ICC profile") }
    : { id: "icc:invalid", severity: "medium", label: "Color profile", ...tv("not a valid ICC profile") };

// PNG and WebP allow one profile, so a second chunk turns the line medium.
function pushChunkIcc(items, seen, ok) {
  if (seen.at === undefined) {
    seen.at = items.length;
    items.push(iccItem(ok));
  } else {
    items[seen.at] = iccItem(false);
  }
}

// One profile: sequence numbers 1..N once each, all agreeing on N, and only segment 1 holds the header.
function jpegIccValid(bytes, segs) {
  const n = bytes[segs[0].payloadOff + 13];
  if (!n || segs.length !== n) return false;
  const seen = new Set();
  for (const seg of segs) {
    const seq = bytes[seg.payloadOff + 12];
    if (seg.payloadLen < 14 || bytes[seg.payloadOff + 13] !== n || seq < 1 || seq > n || seen.has(seq)) return false;
    seen.add(seq);
  }
  const first = segs.find((seg) => bytes[seg.payloadOff + 12] === 1);
  const at = first.payloadOff + 14 + 36;
  return at + 4 <= first.payloadOff + first.payloadLen && startsWith(bytes, at, ACSP);
}

async function pngIccValid(bytes, chunk) {
  const end = chunk.payloadOff + chunk.payloadLen;
  const keyword = asciiZ(bytes, chunk.payloadOff, Math.min(80, chunk.payloadLen));
  if (keyword === null) return false;
  const dataOff = chunk.payloadOff + keyword.length + 2;
  if (dataOff >= end || bytes[dataOff - 1] !== 0) return false;
  const profile = await inflate(bytes.subarray(dataOff, end), 64);
  return !!profile && startsWith(profile, 36, ACSP);
}

export const XMP_HITS = [
  ["location", /GPS(Latitude|Longitude|Position)/i],
  ["creator identity", /dc:creator|photoshop:Credit|xmp:Author/i],
  ["dates", /CreateDate|DateTimeOriginal|ModifyDate/i],
  ["editing software", /CreatorTool|xmp:Agent/i],
];

function xmpItem(items, text) {
  if (!text) return;
  const hits = XMP_HITS.filter(([, re]) => re.test(text)).map(([word]) => word);
  items.push({
    id: "xmp",
    severity: hits.includes("location") || hits.includes("creator identity") ? "high" : "medium",
    label: "XMP metadata",
    ...(hits.length ? tv("contains {what}", { what: hits }) : tv("editing history block")),
  });
}

async function inspectJpeg(bytes, out) {
  const scan = scanJpeg(bytes);
  if (!scan.ok) {
    out.ok = false;
    return;
  }
  const items = out.items;
  let unknownApp = 0;
  let unknownAppBytes = 0;
  for (const seg of scan.segments) {
    switch (seg.kind) {
      case "exif":
        exifItems(items, parseTiff(exifPayload(bytes, seg)), out);
        break;
      case "xmp":
        xmpItem(items, utf8(bytes, seg.payloadOff, Math.min(seg.payloadLen, 65536)));
        break;
      case "xmp-ext":
        items.push({ id: "xmp-ext", severity: "medium", label: "Extended XMP", ...tv("{bytes} bytes", { bytes: seg.payloadLen.toLocaleString() }) });
        break;
      case "iptc":
        items.push({
          id: "iptc",
          severity: "high",
          label: "IPTC metadata",
          ...tv("{bytes} bytes", { bytes: seg.payloadLen.toLocaleString() }),
          detail: "News-style metadata: often creator name, captions, and locations.",
        });
        break;
      case "icc":
        break;
      case "mpf":
        items.push({ id: "mpf", severity: "medium", label: "Multi-picture data", ...tv("extra embedded images likely") });
        break;
      case "comment": {
        const text = (utf8(bytes, seg.payloadOff, Math.min(seg.payloadLen, 512)) || "").trim();
        if (text) {
          items.push({ id: "comment", severity: "medium", label: "Comment", value: text.slice(0, 120) });
        } else if (seg.payloadLen > 0) {
          // A comment of pure whitespace or binary is still a payload; an
          // empty report line here would let it ride through as "clean".
          items.push({
            id: "comment",
            severity: "medium",
            label: "Comment",
            ...tv("{bytes} bytes, not readable text", { bytes: seg.payloadLen.toLocaleString() }),
          });
        }
        break;
      }
      case "jfif":
        items.push({ id: "jfif", severity: "low", label: "JFIF header", ...tv("standard") });
        break;
      case "adobe":
        items.push({ id: "adobe", severity: "low", label: "Adobe encoder marker", ...tv("standard") });
        break;
      case "app":
        // Vendor blocks (Samsung SEF and friends) carry real data; an
        // unrecognized APPn must show up, not silently vanish. "other"
        // covers structural markers (DQT, SOF, SOS), which are the image.
        unknownApp++;
        unknownAppBytes += seg.payloadLen;
        break;
    }
  }
  const icc = scan.segments.filter((seg) => seg.kind === "icc");
  if (icc.length) items.push(iccItem(jpegIccValid(bytes, icc)));
  if (unknownApp) {
    items.push({
      id: "app-unknown",
      severity: "medium",
      label: "Unrecognized data blocks",
      ...tv("{count} segment(s), {bytes} bytes", { count: unknownApp, bytes: unknownAppBytes.toLocaleString() }),
      detail: "Vendor-specific data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
  if (scan.stray > 8) {
    items.unshift({
      id: "stray",
      severity: "high",
      label: "Stray data between segments",
      ...tv("{bytes} bytes outside any marker", { bytes: scan.stray.toLocaleString() }),
      detail: "Bytes hidden between the image's structural blocks. Re-encoding removes them.",
    });
  }
  if (scan.incomplete) {
    out.incomplete = true;
    items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      ...tv("the scan could not reach the end of the image"),
      detail: "Treat the report above as a minimum, not a full accounting.",
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: sniffTrailer(bytes, scan.trailer) };
    items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      ...tv("{bytes} bytes of {kind}", { bytes: scan.trailer.len.toLocaleString(), kind: [out.trailer.kind] }),
      detail:
        "Phones in motion-photo mode append a short video clip here. Anything after the image marker travels with the file, invisible in every viewer.",
    });
  }
}

const PNG_HANDLED = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP"]);

async function inspectPng(bytes, out) {
  const scan = scanPng(bytes);
  if (!scan.ok) {
    out.ok = false;
    return;
  }
  const items = out.items;
  let unknown = 0;
  let unknownBytes = 0;
  for (const chunk of scan.chunks) {
    if (!PNG_BENIGN.has(chunk.type) && !PNG_HANDLED.has(chunk.type)) {
      unknown++;
      unknownBytes += chunk.payloadLen;
    }
  }
  if (unknown) {
    items.push({
      id: "chunk-unknown",
      severity: "medium",
      label: "Unrecognized data blocks",
      ...tv("{count} chunk(s), {bytes} bytes", { count: unknown, bytes: unknownBytes.toLocaleString() }),
      detail: "Nonstandard data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
  const icc = {};
  for (const chunk of scan.chunks) {
    if (chunk.type === "tEXt" || chunk.type === "zTXt" || chunk.type === "iTXt") {
      const decoded = await pngText(bytes, chunk);
      if (!decoded) continue;
      const kw = decoded.keyword || "text";
      if (kw === "XML:com.adobe.xmp") {
        xmpItem(items, decoded.text);
        continue;
      }
      const lower = kw.toLowerCase();
      const severity = HIGH_PNG_KEYWORDS.has(lower) ? "high" : "medium";
      const text = (decoded.text || "").slice(0, 120);
      items.push({
        id: `png-text:${kw}`,
        severity,
        label: `Text: ${kw}`,
        labelT: "Text: {keyword}",
        ...(text ? { value: text } : tv("(empty)")),
        vars: { keyword: kw },
        ...(lower === "parameters" ? { detail: "AI generation prompt and settings." } : {}),
      });
    } else if (chunk.type === "eXIf") {
      exifItems(items, parseTiff(bytes.subarray(chunk.payloadOff, chunk.payloadOff + chunk.payloadLen)), out);
    } else if (chunk.type === "tIME") {
      items.push({ id: "png-time", severity: "medium", label: "Last modified", ...tv("timestamp chunk") });
    } else if (chunk.type === "iCCP") {
      pushChunkIcc(items, icc, await pngIccValid(bytes, chunk));
    }
  }
  if (scan.incomplete) {
    out.incomplete = true;
    items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      ...tv("the scan could not reach the end of the image"),
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: TRAILER_KINDS.unknown };
    items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      ...tv("{bytes} bytes appended", { bytes: scan.trailer.len.toLocaleString() }),
    });
  }
}

const WEBP_BENIGN = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
const WEBP_HANDLED = new Set(["EXIF", "XMP ", "ICCP"]);

async function inspectWebp(bytes, out) {
  const scan = scanWebp(bytes);
  if (!scan.ok) {
    out.ok = false;
    return;
  }
  let unknown = 0;
  let unknownBytes = 0;
  for (const chunk of scan.chunks) {
    if (!WEBP_BENIGN.has(chunk.type) && !WEBP_HANDLED.has(chunk.type)) {
      unknown++;
      unknownBytes += chunk.payloadLen;
    }
  }
  if (unknown) {
    out.items.push({
      id: "chunk-unknown",
      severity: "medium",
      label: "Unrecognized data blocks",
      ...tv("{count} chunk(s), {bytes} bytes", { count: unknown, bytes: unknownBytes.toLocaleString() }),
      detail: "Nonstandard data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
  const icc = {};
  for (const chunk of scan.chunks) {
    if (chunk.type === "EXIF") {
      exifItems(out.items, parseTiff(webpExifPayload(bytes, chunk)), out);
    } else if (chunk.type === "XMP ") {
      xmpItem(out.items, utf8(bytes, chunk.payloadOff, Math.min(chunk.payloadLen, 65536)));
    } else if (chunk.type === "ICCP") {
      pushChunkIcc(out.items, icc, chunk.payloadLen >= 40 && startsWith(bytes, chunk.payloadOff + 36, ACSP));
    }
  }
  if (scan.incomplete) {
    out.incomplete = true;
    out.items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      ...tv("the scan could not reach the end of the image"),
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: TRAILER_KINDS.unknown };
    out.items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      ...tv("{bytes} bytes appended", { bytes: scan.trailer.len.toLocaleString() }),
    });
  }
}

// Naive byte scans; ISOBMFF is a tree we deliberately do not parse. The
// honest "not itemized" verdict does the safety work; these just add color.
function inspectIsobmff(bytes, out) {
  const probes = [
    { sig: sigBytes("Exif"), id: "exif:present", label: "Exif data" },
    { sig: sigBytes("<x:xmpmeta"), id: "xmp", label: "XMP metadata" },
  ];
  for (const { sig, id, label } of probes) {
    outer: for (let i = 0; i < bytes.length - sig.length; i++) {
      for (let j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) continue outer;
      out.items.push({
        id,
        severity: "high",
        label,
        ...tv("present (not itemized for this format)"),
      });
      break;
    }
  }
}

const ANALYZED_FORMATS = new Set(["jpeg", "png", "webp"]);

export async function inspectImage(bytes) {
  const out = {
    format: sniffFormat(bytes),
    ok: true,
    bytes: bytes.length,
    items: [],
    gps: null,
    thumbnail: null,
    trailer: null,
    incomplete: false,
    // False means "this X-ray cannot itemize the format": the UI must say
    // so instead of showing a confident empty report.
    analyzed: ANALYZED_FORMATS.has(sniffFormat(bytes)),
  };
  if (out.format === "jpeg") await inspectJpeg(bytes, out);
  else if (out.format === "png") await inspectPng(bytes, out);
  else if (out.format === "webp") await inspectWebp(bytes, out);
  else if (out.format === "avif" || out.format === "heif" || out.format === "isobmff") inspectIsobmff(bytes, out);
  const rank = { high: 0, medium: 1, low: 2 };
  out.items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  out.counts = {
    high: out.items.filter((i) => i.severity === "high").length,
    medium: out.items.filter((i) => i.severity === "medium").length,
    low: out.items.filter((i) => i.severity === "low").length,
  };
  return out;
}
