import test from "node:test";
import assert from "node:assert/strict";
import { inspectImage, sniffFormat } from "../app/js/inspect.js";
import {
  structuralJpeg,
  buildExifSegment,
  buildXmpSegment,
  buildIptcSegment,
  buildTiff,
  sampleExifSpec,
  buildPng,
  structuralWebp,
  FAKE_THUMB,
  SAMPLE_XMP,
  str,
  identityGapSpec,
} from "./fixtures.mjs";

test("sniffs formats from magic bytes", () => {
  assert.equal(sniffFormat(structuralJpeg()), "jpeg");
  assert.equal(sniffFormat(buildPng()), "png");
  assert.equal(sniffFormat(structuralWebp()), "webp");
  assert.equal(sniffFormat(str("GIF89a....")), "gif");
  assert.equal(sniffFormat(str("nonsense")), "unknown");
});

test("full jpeg x-ray: gps, identity, thumbnail, trailer all surface as high", async () => {
  const jpeg = structuralJpeg({
    segments: [
      buildExifSegment(buildTiff(sampleExifSpec(FAKE_THUMB))),
      buildXmpSegment(SAMPLE_XMP),
      buildIptcSegment(),
    ],
    trailer: str("....ftypmp42fakevideo"),
  });
  const report = await inspectImage(jpeg);
  assert.equal(report.ok, true);
  assert.ok(report.gps, "gps decoded");
  assert.ok(report.thumbnail, "thumbnail extracted");
  assert.ok(report.trailer, "trailer found");
  const ids = report.items.map((i) => i.id);
  assert.ok(ids.includes("gps"));
  assert.ok(ids.includes("thumbnail"));
  assert.ok(ids.includes("trailer"));
  assert.ok(ids.includes("iptc"));
  assert.ok(ids.includes("xmp"));
  assert.ok(ids.includes("exif:Artist"));
  assert.ok(ids.includes("exif:Body serial number"));
  assert.ok(report.counts.high >= 6, JSON.stringify(report.counts));
  // Highs sort first so the scariest thing is the first thing seen.
  assert.equal(report.items[0].severity, "high");
});

test("xmp with location and creator ranks high", async () => {
  const jpeg = structuralJpeg({ segments: [buildXmpSegment(SAMPLE_XMP)] });
  const report = await inspectImage(jpeg);
  const xmp = report.items.find((i) => i.id === "xmp");
  assert.equal(xmp.severity, "high");
  assert.ok(xmp.value.includes("location"));
});

test("png report: author text is high, ai prompt flagged, exif decoded", async () => {
  const png = buildPng({
    text: [
      ["Author", "Jordan Sample"],
      ["parameters", "masterpiece, 8k, seed 1234"],
    ],
    exif: buildTiff(sampleExifSpec()),
  });
  const report = await inspectImage(png);
  const author = report.items.find((i) => i.id === "png-text:Author");
  assert.equal(author.severity, "high");
  const prompt = report.items.find((i) => i.id === "png-text:parameters");
  assert.ok(prompt.detail.includes("AI"));
  assert.ok(report.gps);
});

test("webp exif surfaces", async () => {
  const report = await inspectImage(structuralWebp({ exif: buildTiff(sampleExifSpec()) }));
  assert.ok(report.gps);
  assert.ok(report.items.some((i) => i.id === "exif:Camera model"));
});

test("negative control: clean files report nothing above low", async () => {
  for (const bytes of [structuralJpeg(), buildPng(), structuralWebp()]) {
    const report = await inspectImage(bytes);
    assert.equal(report.counts.high, 0, JSON.stringify(report.items));
    assert.equal(report.counts.medium, 0, JSON.stringify(report.items));
    assert.equal(report.gps, null);
    assert.equal(report.trailer, null);
    assert.equal(report.thumbnail, null);
  }
});

test("negative control: the sample spec really is dirty before scrubbing", async () => {
  const report = await inspectImage(structuralJpeg({ segments: [buildExifSegment(buildTiff(sampleExifSpec()))] }));
  assert.ok(report.counts.high > 0);
});

test("GPSAreaInformation, GPSProcessingMethod, XPAuthor, and MakerNote all surface", async () => {
  const report = await inspectImage(
    structuralJpeg({ segments: [buildExifSegment(buildTiff(identityGapSpec()))] }),
  );
  const byId = Object.fromEntries(report.items.map((i) => [i.id, i]));
  assert.equal(byId["exif:GPS area information"]?.value, "Paris, France");
  assert.equal(byId["exif:GPS area information"]?.severity, "high");
  assert.equal(byId["exif:GPS processing method"]?.value, "GPS NETWORK");
  assert.equal(byId["exif:GPS processing method"]?.severity, "high");
  assert.equal(byId["exif:Windows author"]?.value, "Jordan Sample");
  assert.equal(byId["exif:Windows author"]?.severity, "high");
  assert.ok(byId["exif:MakerNote"], "MakerNote has its own line, not folded into the low rollup");
  assert.notEqual(byId["exif:MakerNote"]?.severity, "low");
  // A genuinely unmapped tag still falls into the honest low rollup; that
  // path must survive the fix, not just the named tags.
  const other = report.items.find((i) => i.id === "exif:other");
  assert.ok(other, "unmapped tag still counted, not dropped");
});

test("hostile input does not throw", async () => {
  await inspectImage(new Uint8Array(0));
  await inspectImage(new Uint8Array([0xff, 0xd8, 0xff]));
  await inspectImage(str("RIFFxxxxWEBP"));
});
