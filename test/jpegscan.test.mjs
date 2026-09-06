import test from "node:test";
import assert from "node:assert/strict";
import { scanJpeg, exifPayload, sniffTrailer } from "../app/js/jpegscan.js";
import {
  structuralJpeg,
  buildExifSegment,
  buildXmpSegment,
  buildIptcSegment,
  buildCommentSegment,
  buildTiff,
  sampleExifSpec,
  str,
  concat,
} from "./fixtures.mjs";

test("walks segments and classifies the metadata carriers", () => {
  const tiff = buildTiff(sampleExifSpec());
  const jpeg = structuralJpeg({
    segments: [
      buildExifSegment(tiff),
      buildXmpSegment("<x:xmpmeta>test</x:xmpmeta>"),
      buildIptcSegment(),
      buildCommentSegment("edited with sepia-test"),
    ],
  });
  const scan = scanJpeg(jpeg);
  assert.equal(scan.ok, true);
  const kinds = scan.segments.map((s) => s.kind);
  assert.ok(kinds.includes("exif"));
  assert.ok(kinds.includes("xmp"));
  assert.ok(kinds.includes("iptc"));
  assert.ok(kinds.includes("comment"));
  assert.equal(scan.trailer, null);
});

test("exif payload round-trips the tiff bytes", () => {
  const tiff = buildTiff(sampleExifSpec());
  const jpeg = structuralJpeg({ segments: [buildExifSegment(tiff)] });
  const scan = scanJpeg(jpeg);
  const seg = scan.segments.find((s) => s.kind === "exif");
  const payload = exifPayload(jpeg, seg);
  assert.equal(payload.length, tiff.length);
  assert.deepEqual(Array.from(payload.slice(0, 8)), Array.from(tiff.slice(0, 8)));
});

test("finds trailing data after EOI and sniffs a motion-photo video", () => {
  const trailer = concat(str("....ftypmp42 pretend video bytes here"));
  const jpeg = structuralJpeg({ trailer });
  const scan = scanJpeg(jpeg);
  assert.ok(scan.trailer);
  assert.equal(scan.trailer.len, trailer.length);
  assert.equal(sniffTrailer(jpeg, scan.trailer), "embedded video (motion photo)");
});

test("entropy data with stuffed FF00 and restart markers does not fake an EOI", () => {
  const jpeg = structuralJpeg();
  const scan = scanJpeg(jpeg);
  assert.equal(scan.trailer, null);
  assert.equal(scan.eoiEnd, jpeg.length);
});

test("negative control: a clean structural jpeg reports no metadata segments", () => {
  const scan = scanJpeg(structuralJpeg());
  const meta = scan.segments.filter((s) => ["exif", "xmp", "iptc", "comment"].includes(s.kind));
  assert.equal(meta.length, 0);
});

test("garbage input does not throw", () => {
  assert.equal(scanJpeg(new Uint8Array([1, 2, 3])).ok, false);
  const truncated = structuralJpeg().slice(0, 6);
  assert.equal(scanJpeg(truncated).ok, true);
  scanJpeg(new Uint8Array(0));
});
