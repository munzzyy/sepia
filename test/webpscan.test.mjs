import test from "node:test";
import assert from "node:assert/strict";
import { scanWebp, webpExifPayload } from "../app/js/webpscan.js";
import { parseTiff } from "../app/js/tiff.js";
import { structuralWebp, buildTiff, sampleExifSpec, concat, str, u32le } from "./fixtures.mjs";

function webpOf(...chunks) {
  const body = concat(str("WEBP"), ...chunks.map(([type, payload]) => concat(str(type), u32le(payload.length), payload)));
  return concat(str("RIFF"), u32le(body.length), body);
}

test("walks riff chunks and finds EXIF and XMP", () => {
  const webp = structuralWebp({ exif: buildTiff(sampleExifSpec()), xmp: "<x:xmpmeta/>" });
  const scan = scanWebp(webp);
  assert.equal(scan.ok, true);
  assert.ok(scan.chunks.some((c) => c.type === "EXIF"));
  assert.ok(scan.chunks.some((c) => c.type === "XMP "));
});

test("exif payload parses with and without the Exif prefix", () => {
  const tiff = buildTiff(sampleExifSpec());
  const plain = structuralWebp({ exif: tiff });
  const prefixed = structuralWebp({ exif: concat(str("Exif\0\0"), tiff) });
  for (const webp of [plain, prefixed]) {
    const chunk = scanWebp(webp).chunks.find((c) => c.type === "EXIF");
    const parsed = parseTiff(webpExifPayload(webp, chunk));
    assert.equal(parsed.ok, true);
    assert.ok(parsed.fields.some((f) => f.name === "Camera make"));
  }
});

test("negative control: a bare webp reports only the image chunk", () => {
  const scan = scanWebp(structuralWebp());
  assert.deepEqual(scan.chunks.map((c) => c.type), ["VP8 "]);
});

test("garbage does not throw", () => {
  assert.equal(scanWebp(new Uint8Array([1, 2, 3])).ok, false);
  const webp = structuralWebp();
  for (const cut of [4, 11, 14, webp.length - 3]) scanWebp(webp.slice(0, cut));
});

test("alpha: the VP8X flag, an ALPH chunk or a lossless VP8L image mean transparency", () => {
  const vp8x = (flags) => ["VP8X", Uint8Array.of(flags, 0, 0, 0, 15, 0, 0, 15, 0, 0)];
  const lossy = ["VP8 ", Uint8Array.of(1, 2, 3, 4, 5, 6)];
  assert.equal(scanWebp(webpOf(vp8x(0x10), lossy)).alpha, true);
  assert.equal(scanWebp(webpOf(vp8x(0x00), ["ALPH", Uint8Array.of(0, 1)], lossy)).alpha, true);
  assert.equal(scanWebp(webpOf(["VP8L", Uint8Array.of(0x2f, 0, 0, 0, 0)])).alpha, true);
  assert.equal(scanWebp(webpOf(vp8x(0x08), lossy)).alpha, false, "the EXIF flag alone is not alpha");
  assert.equal(scanWebp(structuralWebp()).alpha, false);
});
