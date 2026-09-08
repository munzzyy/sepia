// The metadata X-ray. Takes raw file bytes, returns everything the file says
// beyond its pixels, ranked by how badly it can hurt the person sharing it.
// Severity: "high" = identifies you or a place, "medium" = narrows you down,
// "low" = harmless technical detail. The same report runs on exported bytes
// to prove the scrub worked, so it must be honest in both directions.

import { startsWith, sigBytes, utf8 } from "./bytes.js";
import { scanJpeg, exifPayload, xmpPayload, sniffTrailer } from "./jpegscan.js";
import { parseTiff, gpsToDecimal } from "./tiff.js";
import { scanPng, pngText } from "./pngscan.js";
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

const HIGH_TAGS = new Set([
  "Artist",
  "Owner name",
  "Body serial number",
  "Lens serial number",
  "Image unique ID",
  "MakerNote",
  "Windows author",
  "GPS area information",
  "GPS processing method",
]);
const MEDIUM_TAGS = new Set([
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
]);
const HIGH_PNG_KEYWORDS = new Set(["author", "artist", "copyright", "source", "location"]);

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

function pushExifItems(items, tiff, out) {
  let settings = 0;
  let unknown = 0;
  for (const f of tiff.fields) {
    const name = f.name;
    if (!name) {
      unknown++;
      continue;
    }
    const severity = HIGH_TAGS.has(name) ? "high" : MEDIUM_TAGS.has(name) ? "medium" : null;
    if (severity) {
      const text = fmtValue(f.value) || (f.oversized ? "present, too large to decode" : "");
      if (text) items.push({ id: `exif:${name}`, severity, label: name, value: text });
      continue;
    }
    settings++;
  }
  if (settings) {
    items.push({
      id: "exif:settings",
      severity: "low",
      label: "Camera settings",
      value: `${settings} technical fields`,
    });
  }
  if (unknown) {
    items.push({
      id: "exif:other",
      severity: "low",
      label: "Other Exif fields",
      value: `${unknown} maker or unknown fields`,
    });
  }
  const gps = gpsToDecimal(tiff.fields);
  if (gps) {
    out.gps = gps;
    const alt = gps.altitude !== null ? `, ${Math.round(gps.altitude)} m altitude` : "";
    items.unshift({
      id: "gps",
      severity: "high",
      label: "Location",
      value: `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}${alt}`,
      detail: "Exact coordinates of where this image was taken.",
    });
  } else if (tiff.fields.some((f) => f.ifd === "gps" && f.tag >= 1 && f.tag <= 6)) {
    items.unshift({
      id: "gps-partial",
      severity: "high",
      label: "Location fields",
      value: "GPS data present but not fully readable",
    });
  }
  if (tiff.thumbnail) {
    out.thumbnail = tiff.thumbnail;
    items.push({
      id: "thumbnail",
      severity: "high",
      label: "Hidden preview image",
      value: `${tiff.thumbnail.length.toLocaleString()} bytes`,
      detail:
        "A second, smaller copy of the photo stored inside the file. Croppings and edits sometimes leave the original preview behind.",
    });
  }
  if (tiff.truncated) {
    items.push({
      id: "exif:truncated",
      severity: "medium",
      label: "Exif field list truncated",
      value: "more fields exist than could be read",
    });
  }
}

function xmpItem(items, text) {
  if (!text) return;
  const hits = [];
  if (/GPS(Latitude|Longitude|Position)/i.test(text)) hits.push("location");
  if (/dc:creator|photoshop:Credit|xmp:Author/i.test(text)) hits.push("creator identity");
  if (/CreateDate|DateTimeOriginal|ModifyDate/i.test(text)) hits.push("dates");
  if (/CreatorTool|xmp:Agent/i.test(text)) hits.push("editing software");
  items.push({
    id: "xmp",
    severity: hits.includes("location") || hits.includes("creator identity") ? "high" : "medium",
    label: "XMP metadata",
    value: hits.length ? `contains ${hits.join(", ")}` : "editing history block",
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
      case "exif": {
        const tiff = parseTiff(exifPayload(bytes, seg));
        if (tiff.ok) pushExifItems(items, tiff, out);
        else items.push({ id: "exif:unreadable", severity: "medium", label: "Exif block", value: "present but unreadable" });
        break;
      }
      case "xmp":
        xmpItem(items, utf8(bytes, seg.payloadOff, Math.min(seg.payloadLen, 65536)));
        break;
      case "xmp-ext":
        items.push({ id: "xmp-ext", severity: "medium", label: "Extended XMP", value: `${seg.payloadLen.toLocaleString()} bytes` });
        break;
      case "iptc":
        items.push({
          id: "iptc",
          severity: "high",
          label: "IPTC metadata",
          value: `${seg.payloadLen.toLocaleString()} bytes`,
          detail: "News-style metadata: often creator name, captions, and locations.",
        });
        break;
      case "icc":
        if (!items.some((i) => i.id === "icc")) {
          items.push({ id: "icc", severity: "low", label: "Color profile", value: "ICC profile" });
        }
        break;
      case "mpf":
        items.push({ id: "mpf", severity: "medium", label: "Multi-picture data", value: "extra embedded images likely" });
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
            value: `${seg.payloadLen.toLocaleString()} bytes, not readable text`,
          });
        }
        break;
      }
      case "jfif":
        items.push({ id: "jfif", severity: "low", label: "JFIF header", value: "standard" });
        break;
      case "adobe":
        items.push({ id: "adobe", severity: "low", label: "Adobe encoder marker", value: "standard" });
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
  if (unknownApp) {
    items.push({
      id: "app-unknown",
      severity: "medium",
      label: "Unrecognized data blocks",
      value: `${unknownApp} segment(s), ${unknownAppBytes.toLocaleString()} bytes`,
      detail: "Vendor-specific data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
  if (scan.stray > 8) {
    items.unshift({
      id: "stray",
      severity: "high",
      label: "Stray data between segments",
      value: `${scan.stray.toLocaleString()} bytes outside any marker`,
      detail: "Bytes hidden between the image's structural blocks. Re-encoding removes them.",
    });
  }
  if (scan.incomplete) {
    out.incomplete = true;
    items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      value: "the scan could not reach the end of the image",
      detail: "Treat the report above as a minimum, not a full accounting.",
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: sniffTrailer(bytes, scan.trailer) };
    items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      value: `${scan.trailer.len.toLocaleString()} bytes of ${out.trailer.kind}`,
      detail:
        "Phones in motion-photo mode append a short video clip here. Anything after the image marker travels with the file, invisible in every viewer.",
    });
  }
}

// Structural and color chunks a normal encoder writes; anything else must
// show up in the report, not vanish (a custom ancillary chunk carries data
// exactly as well as a tEXt).
const PNG_BENIGN = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT",
  "bKGD", "hIST", "pHYs", "sPLT", "acTL", "fcTL", "fdAT",
]);
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
      value: `${unknown} chunk(s), ${unknownBytes.toLocaleString()} bytes`,
      detail: "Nonstandard data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
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
      items.push({
        id: `png-text:${kw}`,
        severity,
        label: `Text: ${kw}`,
        value: (decoded.text || "").slice(0, 120) || "(empty)",
        detail: lower === "parameters" ? "AI generation prompt and settings." : undefined,
      });
    } else if (chunk.type === "eXIf") {
      const tiff = parseTiff(bytes.subarray(chunk.payloadOff, chunk.payloadOff + chunk.payloadLen));
      if (tiff.ok) pushExifItems(items, tiff, out);
    } else if (chunk.type === "tIME") {
      items.push({ id: "png-time", severity: "medium", label: "Last modified", value: "timestamp chunk" });
    } else if (chunk.type === "iCCP") {
      items.push({ id: "icc", severity: "low", label: "Color profile", value: "ICC profile" });
    }
  }
  if (scan.incomplete) {
    out.incomplete = true;
    items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      value: "the scan could not reach the end of the image",
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: "unidentified data" };
    items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      value: `${scan.trailer.len.toLocaleString()} bytes appended`,
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
      value: `${unknown} chunk(s), ${unknownBytes.toLocaleString()} bytes`,
      detail: "Nonstandard data this X-ray cannot itemize. Re-encoding removes it all the same.",
    });
  }
  for (const chunk of scan.chunks) {
    if (chunk.type === "EXIF") {
      const tiff = parseTiff(webpExifPayload(bytes, chunk));
      if (tiff.ok) pushExifItems(out.items, tiff, out);
    } else if (chunk.type === "XMP ") {
      xmpItem(out.items, utf8(bytes, chunk.payloadOff, Math.min(chunk.payloadLen, 65536)));
    } else if (chunk.type === "ICCP") {
      out.items.push({ id: "icc", severity: "low", label: "Color profile", value: "ICC profile" });
    }
  }
  if (scan.incomplete) {
    out.incomplete = true;
    out.items.unshift({
      id: "incomplete",
      severity: "high",
      label: "File structure unreadable",
      value: "the scan could not reach the end of the image",
    });
  }
  if (scan.trailer) {
    out.trailer = { len: scan.trailer.len, kind: "unidentified data" };
    out.items.unshift({
      id: "trailer",
      severity: "high",
      label: "Data after the image ends",
      value: `${scan.trailer.len.toLocaleString()} bytes appended`,
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
        value: "present (not itemized for this format)",
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
