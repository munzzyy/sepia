import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTiff, gpsToDecimal } from "../app/js/tiff.js";
import { scanJpeg, exifPayload } from "../app/js/jpegscan.js";
import {
  buildTiff,
  sampleExifSpec,
  structuralJpeg,
  buildExifSegment,
  FAKE_THUMB,
  identityGapSpec,
} from "./fixtures.mjs";

test("parses the sample spec back out, both endianness paths bounds-checked", () => {
  const tiff = buildTiff(sampleExifSpec());
  const parsed = parseTiff(tiff);
  assert.equal(parsed.ok, true);
  const byName = Object.fromEntries(parsed.fields.filter((f) => f.name).map((f) => [f.name, f.value]));
  assert.equal(byName["Camera make"], "Sepia Test Devices");
  assert.equal(byName["Camera model"], "Camera 9 Pro");
  assert.equal(byName["Artist"], "Jordan Sample");
  assert.equal(byName["Body serial number"], "ZX44412906");
  assert.equal(byName["Owner name"], "Jordan Sample");
  assert.equal(byName["Taken"], "2026:02:14 09:31:22");
});

test("gps converts to decimal degrees near the eiffel tower", () => {
  const parsed = parseTiff(buildTiff(sampleExifSpec()));
  const gps = gpsToDecimal(parsed.fields);
  assert.ok(gps);
  assert.ok(Math.abs(gps.latitude - 48.8584) < 0.001, String(gps.latitude));
  assert.ok(Math.abs(gps.longitude - 2.2945) < 0.001, String(gps.longitude));
  assert.equal(Math.round(gps.altitude), 35);
});

test("southern and western hemispheres go negative", () => {
  const spec = sampleExifSpec();
  spec.gps = spec.gps.map((e) => {
    if (e.tag === 0x0001) return { ...e, values: "S" };
    if (e.tag === 0x0003) return { ...e, values: "W" };
    return e;
  });
  const gps = gpsToDecimal(parseTiff(buildTiff(spec)).fields);
  assert.ok(gps.latitude < 0 && gps.longitude < 0);
});

test("embedded thumbnail is extracted from IFD1", () => {
  const parsed = parseTiff(buildTiff(sampleExifSpec(FAKE_THUMB)));
  assert.ok(parsed.thumbnail);
  assert.equal(parsed.thumbnail.length, FAKE_THUMB.length);
  assert.deepEqual(Array.from(parsed.thumbnail.slice(0, 2)), [0xff, 0xd8]);
});

test("negative control: no gps ifd means no gps", () => {
  const spec = sampleExifSpec();
  spec.gps = [];
  const parsed = parseTiff(buildTiff(spec));
  assert.equal(gpsToDecimal(parsed.fields), null);
});

test("hostile input: loops, truncation, and garbage do not throw or hang", () => {
  const tiff = buildTiff(sampleExifSpec());
  // IFD0 offset pointing at itself would loop without the visited set.
  const loop = Uint8Array.from(tiff);
  loop.set([8, 0, 0, 0], 4);
  parseTiff(loop);
  for (const cut of [0, 2, 4, 7, 9, 15, tiff.length - 3]) {
    parseTiff(tiff.slice(0, cut));
  }
  assert.equal(parseTiff(new Uint8Array([0x4d, 0x4d, 0, 42])).ok, true);
  assert.equal(parseTiff(new Uint8Array([1, 2, 3, 4])).ok, false);
});

test("cross-check against exiftool on the same bytes", (t) => {
  let hasExiftool = true;
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
  } catch {
    hasExiftool = false;
  }
  if (!hasExiftool) {
    t.skip("exiftool not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "sepia-tiff-"));
  try {
    const jpeg = structuralJpeg({ segments: [buildExifSegment(buildTiff(sampleExifSpec(FAKE_THUMB)))] });
    const file = path.join(dir, "fixture.jpg");
    writeFileSync(file, jpeg);
    const out = execFileSync(
      "exiftool",
      ["-j", "-n", "-Make", "-Model", "-Artist", "-SerialNumber", "-GPSLatitude", "-GPSLongitude", file],
      { encoding: "utf8" },
    );
    const [meta] = JSON.parse(out);
    assert.equal(meta.Make, "Sepia Test Devices");
    assert.equal(meta.Artist, "Jordan Sample");
    assert.equal(meta.SerialNumber, "ZX44412906");
    assert.ok(Math.abs(meta.GPSLatitude - 48.8584) < 0.001);
    assert.ok(Math.abs(meta.GPSLongitude - 2.2945) < 0.001);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("names and decodes MakerNote, XPAuthor, and the free-text GPS tags", () => {
  const parsed = parseTiff(buildTiff(identityGapSpec()));
  const byName = Object.fromEntries(parsed.fields.filter((f) => f.name).map((f) => [f.name, f.value]));
  assert.equal(byName["Windows author"], "Jordan Sample");
  assert.equal(byName["GPS area information"], "Paris, France");
  assert.equal(byName["GPS processing method"], "GPS NETWORK");
  assert.ok(byName["MakerNote"], "MakerNote is named, not folded into the unknown gap");
});

test("cross-check the identity-gap fields against exiftool", (t) => {
  let hasExiftool = true;
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
  } catch {
    hasExiftool = false;
  }
  if (!hasExiftool) {
    t.skip("exiftool not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "sepia-tiff-gap-"));
  try {
    const jpeg = structuralJpeg({ segments: [buildExifSegment(buildTiff(identityGapSpec()))] });
    const file = path.join(dir, "fixture.jpg");
    writeFileSync(file, jpeg);
    const out = execFileSync(
      "exiftool",
      ["-j", "-XPAuthor", "-GPSAreaInformation", "-GPSProcessingMethod", file],
      { encoding: "utf8" },
    );
    const [meta] = JSON.parse(out);
    assert.equal(meta.XPAuthor, "Jordan Sample");
    assert.equal(meta.GPSAreaInformation, "Paris, France");
    assert.equal(meta.GPSProcessingMethod, "GPS NETWORK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("names the Exif 3.0 people fields, the host computer and GPS destination", () => {
  const parsed = parseTiff(
    buildTiff({
      ifd0: [
        { tag: 0x010d, type: 2, values: "scan.tif" },
        { tag: 0x013c, type: 2, values: "JORDANS-LAPTOP" },
      ],
      exif: [
        { tag: 0xa437, type: 2, values: "Jordan Sample" },
        { tag: 0xa438, type: 2, values: "Sam Editor" },
        { tag: 0x9000, type: 7, values: [0x30, 0x32, 0x33, 0x32] },
      ],
      gps: [
        { tag: 0x0013, type: 2, values: "N" },
        { tag: 0x0014, type: 5, values: [[48, 1], [51, 1], [3024, 100]] },
      ],
    }),
  );
  const byName = Object.fromEntries(parsed.fields.filter((f) => f.name).map((f) => [f.name, f.value]));
  assert.equal(byName["Document name"], "scan.tif");
  assert.equal(byName["Host computer"], "JORDANS-LAPTOP");
  assert.equal(byName["Photographer"], "Jordan Sample");
  assert.equal(byName["Image editor"], "Sam Editor");
  assert.deepEqual(byName["Exif version"], [0x30, 0x32, 0x33, 0x32]);
  assert.equal(byName["Destination latitude ref"], "N");
  assert.ok(byName["Destination latitude"]);
  assert.equal(parsed.fields.filter((f) => !f.name).length, 0);
});

test("every IFD0, ExifIFD and GPS tag exiftool writes for these fields has a name", (t) => {
  let hasExiftool = true;
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
  } catch {
    hasExiftool = false;
  }
  if (!hasExiftool) {
    t.skip("exiftool not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "sepia-tiff-names-"));
  try {
    const file = path.join(dir, "named.jpg");
    copyFileSync(new URL("fixtures/clean.jpg", import.meta.url), file);
    execFileSync("exiftool", [
      "-q", "-overwrite_original",
      "-Photographer=X", "-ImageEditor=X", "-ImageTitle=X", "-HostComputer=X", "-DocumentName=X",
      "-GPSDestLatitude=48.8584", "-GPSDestLatitudeRef=N", "-GPSDestLongitude=2.2945", "-GPSDestLongitudeRef=E",
      file,
    ]);
    const [meta] = JSON.parse(execFileSync("exiftool", ["-j", "-G1", "-D", file], { encoding: "utf8" }));
    const groups = { IFD0: "0", ExifIFD: "exif", GPS: "gps" };
    const listed = Object.entries(meta)
      .filter(([k]) => k.split(":")[0] in groups)
      .map(([k, v]) => ({ key: k, ifd: groups[k.split(":")[0]], tag: v.id }));
    assert.ok(listed.length >= 10, JSON.stringify(listed));
    const bytes = new Uint8Array(readFileSync(file));
    const seg = scanJpeg(bytes).segments.find((s) => s.kind === "exif");
    const fields = parseTiff(exifPayload(bytes, seg)).fields;
    for (const { key, ifd, tag } of listed) {
      const field = fields.find((f) => f.ifd === ifd && f.tag === tag);
      assert.ok(field?.name, `${key} (${ifd}:0x${tag.toString(16)}) has no name`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
