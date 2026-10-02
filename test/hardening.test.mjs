// Regression tests for the adversarial-review findings: fail-closed
// scanning, bounded decompression, and no silent under-reporting.

import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { inflate } from "../app/js/bytes.js";
import { scanJpeg } from "../app/js/jpegscan.js";
import { scanPng, stripPngExtras } from "../app/js/pngscan.js";
import { inspectImage } from "../app/js/inspect.js";
import { verifyClean } from "../app/js/verify.js";
import { headline } from "../app/js/report.js";
import {
  structuralJpeg,
  buildTiff,
  sampleExifSpec,
  buildExifSegment,
  buildCommentSegment,
  buildPng,
  structuralWebp,
  injectWebpChunks,
  concat,
  crc32,
  str,
  u16be,
  u32be,
  u16le,
  u32le,
} from "./fixtures.mjs";

test("zip bomb: inflate output is capped, not OOM", async () => {
  const bomb = new Uint8Array(zlib.deflateSync(new Uint8Array(64 * 1024 * 1024)));
  assert.ok(bomb.length < 100_000, "compressed bomb is small");
  const out = await inflate(bomb);
  assert.ok(out.length <= 4 * 1024 * 1024, String(out.length));
});

test("oversized MakerNote-style field is counted, not silently dropped", async () => {
  const spec = sampleExifSpec();
  // Declared count far past the decode cap, like real MakerNotes.
  spec.exif.push({ tag: 0x927c, type: 7, values: Array.from({ length: 8 }, () => 1) });
  const tiff = buildTiff(spec);
  // Patch the count field of tag 0x927c to a huge value.
  for (let i = 0; i < tiff.length - 12; i++) {
    if (tiff[i] === 0x7c && tiff[i + 1] === 0x92 && tiff[i + 2] === 7 && tiff[i + 3] === 0) {
      tiff.set(u32le(100000), i + 4);
      break;
    }
  }
  const report = await inspectImage(structuralJpeg({ segments: [buildExifSegment(tiff)] }));
  const maker = report.items.find((i) => i.id === "exif:MakerNote");
  assert.ok(maker, "oversized MakerNote surfaces under its own name, not the unknown rollup");
  assert.notEqual(maker.severity, "low");
});

test("missing EOI does not hide an appended payload", async () => {
  const jpeg = structuralJpeg({ trailer: str("SNEAKY-PAYLOAD") });
  const noEoi = concat(jpeg.subarray(0, jpeg.length - 16), str("SNEAKY-PAYLOAD"));
  // Remove the EOI: find and drop the FFD9 before the trailer.
  const scan = scanJpeg(noEoi);
  assert.equal(scan.incomplete, true);
  const report = await inspectImage(noEoi);
  assert.ok(report.incomplete);
  assert.ok(report.items.some((i) => i.id === "incomplete"));
  const { clean } = await verifyClean(noEoi);
  assert.equal(clean, false);
});

test("malformed marker before a trailer fails closed instead of open", async () => {
  // A COM with an impossible length aborts the walk; everything after must
  // still be flagged rather than silently ignored.
  const good = structuralJpeg();
  const bad = concat(
    good.subarray(0, 2),
    Uint8Array.of(0xff, 0xfe, 0x00, 0x01),
    str("HIDDEN-AFTER-MALFORMED"),
  );
  const report = await inspectImage(bad);
  assert.ok(report.incomplete || report.trailer, JSON.stringify(report.items));
  const { clean } = await verifyClean(bad);
  assert.equal(clean, false);
});

test("exif hiding in APP2 is still parsed", async () => {
  const tiff = buildTiff(sampleExifSpec());
  const payload = concat(str("Exif\0\0"), tiff);
  const app2 = concat(Uint8Array.of(0xff, 0xe2), u16be(payload.length + 2), payload);
  const report = await inspectImage(structuralJpeg({ segments: [app2] }));
  assert.ok(report.gps, "gps found in APP2 exif");
});

test("unrecognized APPn vendor blocks surface as an item", async () => {
  const payload = str("SEFT-vendor-block-data-here");
  const app4 = concat(Uint8Array.of(0xff, 0xe4), u16be(payload.length + 2), payload);
  const report = await inspectImage(structuralJpeg({ segments: [app4] }));
  const item = report.items.find((i) => i.id === "app-unknown");
  assert.ok(item);
  assert.equal(item.severity, "medium");
  const { clean } = await verifyClean(structuralJpeg({ segments: [app4] }));
  assert.equal(clean, false);
});

test("webp trailer surfaces and fails verification", async () => {
  const webp = concat(structuralWebp(), str("APPENDED"));
  const report = await inspectImage(webp);
  assert.ok(report.trailer);
  assert.ok(report.items.some((i) => i.id === "trailer"));
  assert.equal((await verifyClean(webp)).clean, false);
});

test("unanalyzed formats are honest, not confidently clean", async () => {
  const gif = str("GIF89a" + "\x01".repeat(40));
  const report = await inspectImage(gif);
  assert.equal(report.analyzed, false);
  assert.match(headline(report), /not itemized/);
  assert.equal((await verifyClean(gif)).clean, false);
});

test("IFD with an inflated entry count still yields its real fields", async () => {
  const tiff = buildTiff(sampleExifSpec());
  // Bump IFD0's declared entry count past the cap; parsing should keep the
  // fields it can reach and mark truncation instead of dropping everything.
  const declared = tiff[8] | (tiff[9] << 8);
  tiff.set(Uint8Array.of(0xff, 0x01), 8);
  const report = await inspectImage(structuralJpeg({ segments: [buildExifSegment(tiff)] }));
  assert.ok(declared < 0x1ff);
  assert.ok(report.items.some((i) => i.id === "exif:truncated"), JSON.stringify(report.items.map((i) => i.id)));
  assert.ok(report.items.length > 1, "real fields still parsed");
});

test("negative control: canvas-style clean output still verifies clean", async () => {
  const { clean } = await verifyClean(structuralJpeg());
  assert.equal(clean, true);
  const { clean: pngClean } = await verifyClean(buildPng());
  assert.equal(pngClean, true);
});

// ---- cross-model audit round (Gemini findings, all verified) ----

test("stray bytes hidden between JPEG segments are reported", async () => {
  const clean = structuralJpeg({ segments: [buildCommentSegment("x")] });
  // Splice a payload after the first segment, outside any marker.
  const at = 2 + 2 + 2 + 1;
  const hidden = concat(clean.subarray(0, at), str("HIDDEN PAYLOAD BETWEEN SEGMENTS"), clean.subarray(at));
  const report = await inspectImage(hidden);
  assert.ok(report.items.some((i) => i.id === "stray"), JSON.stringify(report.items.map((i) => i.id)));
  assert.equal((await verifyClean(hidden)).clean, false);
});

test("a COM segment of unreadable bytes still shows in the report", async () => {
  const payload = new Uint8Array(64).fill(0x20);
  const com = concat(Uint8Array.of(0xff, 0xfe), u16be(payload.length + 2), payload);
  const report = await inspectImage(structuralJpeg({ segments: [com] }));
  const item = report.items.find((i) => i.id === "comment");
  assert.ok(item, "binary comment reported");
  assert.match(item.value, /bytes/);
});

test("custom PNG chunks are reported, standard encoder chunks are not", async () => {
  const png = buildPng();
  // Insert a private ancillary chunk before IEND.
  const iendAt = png.length - 12;
  const secret = str("SECRET-DATA-IN-PRIVATE-CHUNK");
  const chunkBody = concat(str("prVt"), secret);
  const custom = concat(
    Uint8Array.of(0, 0, 0, secret.length),
    chunkBody,
    u32be(crc32(chunkBody)),
  );
  const withCustom = concat(png.subarray(0, iendAt), custom, png.subarray(iendAt));
  const report = await inspectImage(withCustom);
  assert.ok(report.items.some((i) => i.id === "chunk-unknown"), JSON.stringify(report.items.map((i) => i.id)));
  assert.equal((await verifyClean(withCustom)).clean, false);
  // Negative control: a bare PNG with only standard chunks stays clean.
  assert.equal((await verifyClean(buildPng())).clean, true);
});

test("custom WebP chunks are reported", async () => {
  const base = structuralWebp();
  const secret = str("SECRET8!");
  const chunk = concat(str("SECR"), u32le(secret.length), secret);
  const withCustom = concat(base, chunk);
  withCustom.set(u32le(withCustom.length - 8), 4);
  const report = await inspectImage(withCustom);
  assert.ok(report.items.some((i) => i.id === "chunk-unknown"), JSON.stringify(report.items.map((i) => i.id)));
});

test("firefox's deBG chunk fails the proof until the export filter drops it", async () => {
  const png = buildPng();
  const iendAt = png.length - 12;
  const body = concat(str("deBG"), str("7E33FC1244975E73"));
  const debg = concat(u32be(16), body, u32be(crc32(body)));
  const raw = concat(png.subarray(0, iendAt), debg, png.subarray(iendAt));
  assert.equal((await verifyClean(raw)).clean, false);
  const filtered = stripPngExtras(raw);
  assert.deepEqual(scanPng(filtered).chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  assert.equal((await verifyClean(filtered)).clean, true);
  assert.deepEqual(filtered, png);
});

test("the export filter passes a png with nothing to drop through untouched", () => {
  const png = buildPng();
  assert.equal(stripPngExtras(png), png);
  assert.deepEqual(stripPngExtras(png), buildPng());
  const jpeg = structuralJpeg();
  assert.equal(stripPngExtras(jpeg), jpeg);
});

// ---- fail-open shapes: blocks that carried a name and still verified clean ----

const NAME = str("Jordan Sample, 12 Elm St, phone 555-0100");
const segment = (marker, payload) => concat(Uint8Array.of(0xff, marker), u16be(payload.length + 2), payload);
const iccSegment = (seq, count, data) => segment(0xe2, concat(str("ICC_PROFILE\0"), Uint8Array.of(seq, count), data));
const pngChunk = (type, payload) => {
  const body = concat(str(type), payload);
  return concat(u32be(payload.length), body, u32be(crc32(body)));
};
const pngWith = (chunk) => {
  const png = buildPng();
  return concat(png.subarray(0, 33), chunk, png.subarray(33));
};
const webpWith = (type, payload) => {
  const out = concat(structuralWebp(), str(type), u32le(payload.length), payload, payload.length % 2 ? Uint8Array.of(0) : new Uint8Array(0));
  out.set(u32le(out.length - 8), 4);
  return out;
};
// A 128-byte ICC header: size, then "acsp" at offset 36 where every real profile has it.
function iccHeader() {
  const h = new Uint8Array(128);
  h.set(u32be(128), 0);
  h.set(str("acsp"), 36);
  return h;
}

async function assertFlagged(bytes, id) {
  const report = await inspectImage(bytes);
  const item = report.items.find((i) => i.id === id);
  assert.ok(item, `${id} missing from ${JSON.stringify(report.items.map((i) => i.id))}`);
  assert.notEqual(item.severity, "low");
  assert.equal((await verifyClean(bytes)).clean, false);
}

test("an Exif block whose IFD0 points nowhere is flagged", async () => {
  const payload = concat(str("Exif\0\0II*\0"), u32le(0x7fffffff), NAME);
  await assertFlagged(structuralJpeg({ segments: [segment(0xe1, payload)] }), "exif:unreadable");
});

test("an Exif block with no fields at all is flagged", async () => {
  const tiff = concat(str("II*\0"), u32le(8), u16le(0), u32le(0), NAME);
  await assertFlagged(structuralJpeg({ segments: [buildExifSegment(tiff)] }), "exif:unreadable");
  await assertFlagged(buildPng({ exif: tiff }), "exif:unreadable");
  await assertFlagged(structuralWebp({ exif: tiff }), "exif:unreadable");
});

test("PNG eXIf and WebP EXIF that do not parse are flagged", async () => {
  await assertFlagged(buildPng({ exif: NAME }), "exif:unreadable");
  await assertFlagged(structuralWebp({ exif: NAME }), "exif:unreadable");
});

test("a second ICC profile cannot hide behind the first", async () => {
  const jpeg = structuralJpeg({ segments: [iccSegment(1, 1, iccHeader()), iccSegment(1, 1, NAME)] });
  await assertFlagged(jpeg, "icc:invalid");
});

test("an ICC segment with no profile in it is flagged", async () => {
  await assertFlagged(structuralJpeg({ segments: [iccSegment(1, 1, NAME)] }), "icc:invalid");
});

test("ICC segments that disagree on their count are flagged", async () => {
  const jpeg = structuralJpeg({ segments: [iccSegment(1, 2, iccHeader()), iccSegment(2, 3, NAME)] });
  await assertFlagged(jpeg, "icc:invalid");
});

test("positive control: a profile split over two segments is still a harmless profile", async () => {
  const jpeg = structuralJpeg({ segments: [iccSegment(1, 2, iccHeader()), iccSegment(2, 2, new Uint8Array(64))] });
  const report = await inspectImage(jpeg);
  assert.deepEqual(report.items.map((i) => [i.id, i.severity]), [["icc", "low"]]);
  assert.equal((await verifyClean(jpeg)).clean, true);
});

test("PNG iCCP is inflated and checked for a profile header", async () => {
  const fake = pngChunk("iCCP", concat(str("icc\0\0"), new Uint8Array(zlib.deflateSync(NAME))));
  await assertFlagged(pngWith(fake), "icc:invalid");
  const real = pngChunk("iCCP", concat(str("icc\0\0"), new Uint8Array(zlib.deflateSync(iccHeader()))));
  const report = await inspectImage(pngWith(real));
  assert.deepEqual(report.items.map((i) => [i.id, i.severity]), [["icc", "low"]]);
  assert.equal((await verifyClean(pngWith(real))).clean, true);
  await assertFlagged(pngWith(concat(real, real)), "icc:invalid");
});

test("WebP ICCP is checked for a profile header", async () => {
  await assertFlagged(webpWith("ICCP", NAME), "icc:invalid");
  const report = await inspectImage(webpWith("ICCP", iccHeader()));
  assert.deepEqual(report.items.map((i) => [i.id, i.severity]), [["icc", "low"]]);
});

test("reserved and unassigned JPEG markers count as unrecognized data", async () => {
  for (const marker of [0xf0, 0xfd, 0xc8, 0x02, 0xbf]) {
    await assertFlagged(structuralJpeg({ segments: [segment(marker, NAME)] }), "app-unknown");
  }
  const scan = scanJpeg(structuralJpeg({ segments: [segment(0xdb, new Uint8Array(65)), segment(0xc4, new Uint8Array(20))] }));
  assert.deepEqual(scan.segments.map((seg) => seg.kind), ["other", "other", "other"]);
});

test("positive control: the real fixtures keep their item ids", async () => {
  const ids = async (name) =>
    (await inspectImage(new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url))))).items.map((i) => i.id).sort().join(" ");
  assert.equal(await ids("clean.jpg"), "icc jfif");
  assert.equal(await ids("real-text.png"), "png-text:Author png-time");
  assert.match(await ids("real-gps.jpg"), /^exif:Artist .* icc jfif thumbnail$/);
  assert.match(await ids("real-exif.webp"), /exif:settings gps icc$/);
});

test("2000 seeded single-byte flips and truncations never throw", async () => {
  let seed = 0x5e9ea;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dir = new URL("fixtures/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/.test(f))
    .map((f) => new Uint8Array(readFileSync(new URL(f, dir))));
  assert.ok(files.length >= 4);
  const t0 = Date.now();
  for (let i = 0; i < 2000; i++) {
    const src = files[i % files.length];
    const pos = Math.floor(rand() * src.length);
    const bytes = i % 4 === 3 ? src.slice(0, pos) : Uint8Array.from(src);
    if (i % 4 !== 3) bytes[pos] = Math.floor(rand() * 256);
    await inspectImage(bytes);
  }
  assert.ok(Date.now() - t0 < 20000, `took ${Date.now() - t0} ms`);
});
