import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTiff, gpsToDecimal } from "../app/js/tiff.js";
import {
  buildTiff,
  sampleExifSpec,
  structuralJpeg,
  buildExifSegment,
  FAKE_THUMB,
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
