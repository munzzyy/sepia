// Regression tests for the adversarial-review findings: fail-closed
// scanning, bounded decompression, and no silent under-reporting.

import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { inflate } from "../app/js/bytes.js";
import { scanJpeg } from "../app/js/jpegscan.js";
import { inspectImage } from "../app/js/inspect.js";
import { verifyClean } from "../app/js/verify.js";
import { headline } from "../app/js/report.js";
import {
  structuralJpeg,
  buildTiff,
  sampleExifSpec,
  buildExifSegment,
  buildPng,
  structuralWebp,
  injectWebpChunks,
  concat,
  str,
  u16be,
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
  const other = report.items.find((i) => i.id === "exif:other");
  assert.ok(other, "oversized field appears in the maker/unknown rollup");
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
