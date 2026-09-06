import test from "node:test";
import assert from "node:assert/strict";
import { scanWebp, webpExifPayload } from "../app/js/webpscan.js";
import { parseTiff } from "../app/js/tiff.js";
import { structuralWebp, buildTiff, sampleExifSpec, concat, str } from "./fixtures.mjs";

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
