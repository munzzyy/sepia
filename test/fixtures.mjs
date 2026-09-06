// Builds real metadata-bearing image files in pure node, so the parsers are
// tested against byte layouts assembled independently of the code that reads
// them. PNGs come out fully decodable (zlib is node-side only; the app never
// compresses). JPEG/WebP structural fixtures exercise the walkers; decodable
// browser fixtures are made by injecting these segments into canvas output.

import zlib from "node:zlib";

// ------------------------------------------------------------------ helpers

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function u16be(n) {
  return Uint8Array.of((n >> 8) & 0xff, n & 0xff);
}
export function u32be(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
export function u16le(n) {
  return Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
}
export function u32le(n) {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------- TIFF builder

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function encodeValues(type, values) {
  if (type === 2) {
    const s = values + "\0";
    return str(s);
  }
  const list = Array.isArray(values) ? values : [values];
  if (type === 1 || type === 7) return Uint8Array.from(list);
  if (type === 3) return concat(...list.map(u16le));
  if (type === 4 || type === 9) return concat(...list.map((v) => u32le(v >>> 0)));
  if (type === 5 || type === 10) {
    return concat(...list.map(([n, d]) => concat(u32le(n >>> 0), u32le(d >>> 0))));
  }
  throw new Error(`unsupported type ${type}`);
}

function valueCount(type, values) {
  if (type === 2) return String(values).length + 1;
  if (type === 5 || type === 10) return Array.isArray(values[0]) ? values.length : 1;
  return Array.isArray(values) ? values.length : 1;
}

// spec: { ifd0: [{tag,type,values}], exif: [...], gps: [...], thumbnail: Uint8Array }
// Little-endian TIFF. Layout: header, IFD0, ExifIFD, GPSIFD, IFD1, heap, thumb.
export function buildTiff(spec) {
  const ifds = [];
  const ifd0 = [...(spec.ifd0 || [])];
  if (spec.exif?.length) ifd0.push({ tag: 0x8769, type: 4, values: 0, patchIfd: 1 });
  if (spec.gps?.length) ifd0.push({ tag: 0x8825, type: 4, values: 0, patchIfd: 2 });
  ifds.push(ifd0);
  if (spec.exif?.length) ifds.push([...spec.exif]);
  if (spec.gps?.length) ifds.push([...spec.gps]);
  const hasThumb = !!spec.thumbnail;
  if (hasThumb) {
    ifds.push([
      { tag: 0x0201, type: 4, values: 0, patchThumb: "off" },
      { tag: 0x0202, type: 4, values: spec.thumbnail.length },
    ]);
  }

  const ifdSizes = ifds.map((entries) => 2 + entries.length * 12 + 4);
  const ifdOffsets = [];
  let cursor = 8;
  for (const size of ifdSizes) {
    ifdOffsets.push(cursor);
    cursor += size;
  }
  const heapStart = cursor;

  const heap = [];
  let heapLen = 0;
  const heapAlloc = (bytes) => {
    const off = heapStart + heapLen;
    heap.push(bytes);
    heapLen += bytes.length;
    if (bytes.length % 2) {
      heap.push(Uint8Array.of(0));
      heapLen += 1;
    }
    return off;
  };

  const thumbOffset = () => heapStart + heapLen;

  const parts = [str("II"), u16le(42), u32le(ifdOffsets[0])];
  ifds.forEach((entries, idx) => {
    entries.sort((a, b) => a.tag - b.tag);
    const chunk = [u16le(entries.length)];
    for (const e of entries) {
      let count;
      let valueBytes;
      if (e.patchIfd !== undefined) {
        count = 1;
        const target = e.patchIfd === 1 ? ifdOffsets[1] : ifdOffsets[spec.exif?.length ? 2 : 1];
        valueBytes = u32le(target);
      } else if (e.patchThumb) {
        count = 1;
        valueBytes = u32le(0);
        e._pending = true;
      } else {
        count = valueCount(e.type, e.values);
        valueBytes = encodeValues(e.type, e.values);
      }
      chunk.push(u16le(e.tag), u16le(e.type), u32le(count));
      if (valueBytes.length <= 4) {
        const slot = new Uint8Array(4);
        slot.set(valueBytes);
        chunk.push(slot);
        e._slotInline = true;
      } else {
        chunk.push(u32le(heapAlloc(valueBytes)));
      }
    }
    // IFD1 (the thumbnail IFD) is linked from IFD0's next pointer.
    const next = idx === 0 && hasThumb ? ifdOffsets[ifds.length - 1] : 0;
    chunk.push(u32le(next));
    parts.push(concat(...chunk));
  });

  let tiff = concat(...parts, ...heap);
  if (hasThumb) {
    const thumbOff = tiff.length;
    tiff = concat(tiff, spec.thumbnail);
    // Patch the placeholder JPEGInterchangeFormat value in IFD1.
    const ifd1Off = ifdOffsets[ifds.length - 1];
    const entryCount = ifds[ifds.length - 1].length;
    for (let i = 0; i < entryCount; i++) {
      const e = ifd1Off + 2 + i * 12;
      const tag = tiff[e] | (tiff[e + 1] << 8);
      if (tag === 0x0201) {
        tiff.set(u32le(thumbOff), e + 8);
      }
    }
  }
  return tiff;
}

export function degToDms(deg) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60 * 1000);
  return [
    [d, 1],
    [m, 1],
    [s, 1000],
  ];
}

// The default juicy spec: everything a phone camera writes that people wish
// it had not. Coordinates are the Eiffel Tower, recognizable and nobody's.
export function sampleExifSpec(thumbnail) {
  return {
    ifd0: [
      { tag: 0x010f, type: 2, values: "Sepia Test Devices" },
      { tag: 0x0110, type: 2, values: "Camera 9 Pro" },
      { tag: 0x0131, type: 2, values: "CameraOS 15.2" },
      { tag: 0x0132, type: 2, values: "2026:02:14 09:31:22" },
      { tag: 0x013b, type: 2, values: "Jordan Sample" },
      { tag: 0x0112, type: 3, values: 1 },
    ],
    exif: [
      { tag: 0x9003, type: 2, values: "2026:02:14 09:31:22" },
      { tag: 0x9011, type: 2, values: "+01:00" },
      { tag: 0xa430, type: 2, values: "Jordan Sample" },
      { tag: 0xa431, type: 2, values: "ZX44412906" },
      { tag: 0xa420, type: 2, values: "f3a9c2d84be14f0e9d3a" },
      { tag: 0x829a, type: 5, values: [[1, 120]] },
      { tag: 0x829d, type: 5, values: [[9, 5]] },
      { tag: 0x8827, type: 3, values: 64 },
      { tag: 0x920a, type: 5, values: [[27, 4]] },
    ],
    gps: [
      { tag: 0x0001, type: 2, values: "N" },
      { tag: 0x0002, type: 5, values: degToDms(48.8584) },
      { tag: 0x0003, type: 2, values: "E" },
      { tag: 0x0004, type: 5, values: degToDms(2.2945) },
      { tag: 0x0005, type: 1, values: 0 },
      { tag: 0x0006, type: 5, values: [[35, 1]] },
      { tag: 0x001d, type: 2, values: "2026:02:14" },
    ],
    thumbnail,
  };
}

// ------------------------------------------------------------ JPEG fixtures

export function buildExifSegment(tiffBytes) {
  const payload = concat(str("Exif\0\0"), tiffBytes);
  return concat(Uint8Array.of(0xff, 0xe1), u16be(payload.length + 2), payload);
}

export function buildXmpSegment(xml) {
  const payload = concat(str("http://ns.adobe.com/xap/1.0/\0"), str(xml));
  return concat(Uint8Array.of(0xff, 0xe1), u16be(payload.length + 2), payload);
}

export function buildIptcSegment(body = "8BIM\x04\x04\0\0\0\0\0\x10fake iptc block!") {
  const payload = concat(str("Photoshop 3.0\0"), str(body));
  return concat(Uint8Array.of(0xff, 0xed), u16be(payload.length + 2), payload);
}

export function buildCommentSegment(text) {
  const payload = str(text);
  return concat(Uint8Array.of(0xff, 0xfe), u16be(payload.length + 2), payload);
}

// Structural JPEG: correct markers, junk entropy data. Parsers only.
export function structuralJpeg({ segments = [], trailer = null } = {}) {
  const sos = concat(
    Uint8Array.of(0xff, 0xda),
    u16be(8),
    Uint8Array.of(1, 1, 0, 0, 63, 0),
    // Entropy-coded junk including a stuffed FF00 and a restart marker.
    Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a),
  );
  const parts = [Uint8Array.of(0xff, 0xd8), ...segments, sos, Uint8Array.of(0xff, 0xd9)];
  if (trailer) parts.push(trailer);
  return concat(...parts);
}

// Splice segments into a real JPEG right after SOI (and after APP0 if there),
// keeping it decodable.
export function injectJpegSegments(jpeg, segments) {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  }
  return concat(jpeg.subarray(0, at), ...segments, jpeg.subarray(at));
}

// ------------------------------------------------------------- PNG fixtures

function pngChunk(type, payload) {
  const body = concat(str(type), payload);
  return concat(u32be(payload.length), body, u32be(crc32(body)));
}

// Fully decodable RGBA PNG with optional metadata chunks.
export function buildPng({
  width = 8,
  height = 8,
  color = [200, 120, 40, 255],
  text = [],
  ztxt = [],
  itxt = [],
  exif = null,
  time = false,
  trailer = null,
} = {}) {
  const ihdr = pngChunk(
    "IHDR",
    concat(u32be(width), u32be(height), Uint8Array.of(8, 6, 0, 0, 0)),
  );
  const row = new Uint8Array(1 + width * 4);
  for (let x = 0; x < width; x++) row.set(color, 1 + x * 4);
  const raw = concat(...Array.from({ length: height }, () => row));
  const idat = pngChunk("IDAT", new Uint8Array(zlib.deflateSync(raw)));
  const chunks = [ihdr];
  for (const [keyword, value] of text) {
    chunks.push(pngChunk("tEXt", concat(str(keyword), Uint8Array.of(0), str(value))));
  }
  for (const [keyword, value] of ztxt) {
    chunks.push(
      pngChunk(
        "zTXt",
        concat(str(keyword), Uint8Array.of(0, 0), new Uint8Array(zlib.deflateSync(str(value)))),
      ),
    );
  }
  for (const [keyword, value] of itxt) {
    chunks.push(
      pngChunk(
        "iTXt",
        concat(str(keyword), Uint8Array.of(0, 0, 0), str("\0"), str("\0"), new TextEncoder().encode(value)),
      ),
    );
  }
  if (exif) chunks.push(pngChunk("eXIf", exif));
  if (time) chunks.push(pngChunk("tIME", concat(u16be(2026), Uint8Array.of(2, 14, 9, 31, 22))));
  chunks.push(idat, pngChunk("IEND", new Uint8Array(0)));
  if (trailer) chunks.push(trailer);
  return concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ...chunks);
}

// ------------------------------------------------------------ WebP fixtures

function riffChunk(type, payload) {
  const parts = [str(type), u32le(payload.length), payload];
  if (payload.length % 2) parts.push(Uint8Array.of(0));
  return concat(...parts);
}

export function structuralWebp({ exif = null, xmp = null } = {}) {
  const chunks = [riffChunk("VP8 ", Uint8Array.of(1, 2, 3, 4, 5, 6))];
  if (exif) chunks.push(riffChunk("EXIF", exif));
  if (xmp) chunks.push(riffChunk("XMP ", str(xmp)));
  const body = concat(str("WEBP"), ...chunks);
  return concat(str("RIFF"), u32le(body.length), body);
}

// Append metadata chunks to a real WebP, fixing the RIFF size.
export function injectWebpChunks(webp, { exif = null, xmp = null }) {
  const extra = [];
  if (exif) extra.push(riffChunk("EXIF", exif));
  if (xmp) extra.push(riffChunk("XMP ", str(xmp)));
  const out = concat(webp, ...extra);
  const size = out.length - 8;
  out.set(u32le(size), 4);
  return out;
}

export const SAMPLE_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:exif="http://ns.adobe.com/exif/1.0/">
<dc:creator><rdf:Seq><rdf:li>Jordan Sample</rdf:li></rdf:Seq></dc:creator>
<xmp:CreateDate>2026-02-14T09:31:22+01:00</xmp:CreateDate>
<xmp:CreatorTool>PhotoLab 12</xmp:CreatorTool>
<exif:GPSLatitude>48,51.504N</exif:GPSLatitude>
<exif:GPSLongitude>2,17.670E</exif:GPSLongitude>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

// A tiny structurally-valid JPEG standing in for an embedded thumbnail.
export const FAKE_THUMB = structuralJpeg();
