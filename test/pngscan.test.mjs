import test from "node:test";
import assert from "node:assert/strict";
import { scanPng, pngText } from "../app/js/pngscan.js";
import { buildPng, buildTiff, sampleExifSpec, str } from "./fixtures.mjs";

test("walks a real png and finds text chunks", async () => {
  const png = buildPng({
    text: [
      ["Author", "Jordan Sample"],
      ["Comment", "made with test"],
    ],
    time: true,
  });
  const scan = scanPng(png);
  assert.equal(scan.ok, true);
  const texts = scan.chunks.filter((c) => c.type === "tEXt");
  assert.equal(texts.length, 2);
  const first = await pngText(png, texts[0]);
  assert.equal(first.keyword, "Author");
  assert.equal(first.text, "Jordan Sample");
  assert.ok(scan.chunks.some((c) => c.type === "tIME"));
  assert.equal(scan.trailer, null);
});

test("inflates zTXt through DecompressionStream", async () => {
  const png = buildPng({ ztxt: [["Description", "compressed secret note"]] });
  const chunk = scanPng(png).chunks.find((c) => c.type === "zTXt");
  const decoded = await pngText(png, chunk);
  assert.equal(decoded.keyword, "Description");
  assert.equal(decoded.text, "compressed secret note");
});

test("reads iTXt with language fields", async () => {
  const png = buildPng({ itxt: [["Title", "unicode text ✓"]] });
  const chunk = scanPng(png).chunks.find((c) => c.type === "iTXt");
  const decoded = await pngText(png, chunk);
  assert.equal(decoded.keyword, "Title");
  assert.equal(decoded.text, "unicode text ✓");
});

test("finds eXIf and trailing data", async () => {
  const png = buildPng({ exif: buildTiff(sampleExifSpec()), trailer: str("EXTRA-PAYLOAD") });
  const scan = scanPng(png);
  assert.ok(scan.chunks.some((c) => c.type === "eXIf"));
  assert.ok(scan.trailer);
  assert.equal(scan.trailer.len, 13);
});

test("negative control: a bare png has no metadata chunks", () => {
  const scan = scanPng(buildPng());
  const meta = scan.chunks.filter((c) => !["IHDR", "IDAT", "IEND"].includes(c.type));
  assert.equal(meta.length, 0);
});

test("garbage and truncation do not throw", () => {
  assert.equal(scanPng(new Uint8Array([1, 2, 3])).ok, false);
  const png = buildPng();
  for (const cut of [8, 9, 20, png.length - 5]) scanPng(png.slice(0, cut));
});
