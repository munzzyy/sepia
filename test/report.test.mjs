import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gpsWords, headline } from "../app/js/report.js";
import { inspectImage } from "../app/js/inspect.js";
import { verifyClean } from "../app/js/verify.js";
import {
  structuralJpeg,
  buildExifSegment,
  buildTiff,
  sampleExifSpec,
  buildPng,
  identityGapSpec,
  degToDms,
  asciiCharsetBytes,
} from "./fixtures.mjs";

const CLEAN = /No personal metadata/;
const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const jpegWith = (spec) => structuralJpeg({ segments: [buildExifSegment(buildTiff(spec))] });

test("gps words are hemisphere-correct", () => {
  assert.equal(gpsWords({ latitude: 48.8584, longitude: 2.2945 }), "48.85840° N, 2.29450° E");
  assert.equal(gpsWords({ latitude: -33.9249, longitude: -18.4241 }), "33.92490° S, 18.42410° W");
});

test("headline escalates by what is in the file", async () => {
  const withGps = await inspectImage(
    structuralJpeg({ segments: [buildExifSegment(buildTiff(sampleExifSpec()))] }),
  );
  assert.match(headline(withGps), /where it was taken/);

  const clean = await inspectImage(buildPng());
  assert.match(headline(clean), /No personal metadata/);

  const identity = await inspectImage(buildPng({ text: [["Author", "Jordan Sample"]] }));
  assert.match(headline(identity), /identifies you/);
});

test("a file naming its owner never gets the clean headline, even with no GPS fix", async () => {
  const report = await inspectImage(
    structuralJpeg({ segments: [buildExifSegment(buildTiff(identityGapSpec()))] }),
  );
  assert.equal(report.gps, null, "this fixture carries no coordinates on purpose");
  assert.doesNotMatch(headline(report), /No personal metadata/);
  assert.match(headline(report), /identifies you/);
});

const IDENTITY_TAGS = [
  ["Photographer", "high", { exif: [{ tag: 0xa437, type: 2, values: "Jordan Sample" }] }],
  ["Image editor", "high", { exif: [{ tag: 0xa438, type: 2, values: "Jordan Sample" }] }],
  ["Host computer", "high", { ifd0: [{ tag: 0x013c, type: 2, values: "JORDANS-LAPTOP" }] }],
  ["Destination latitude", "high", { gps: [{ tag: 0x0014, type: 5, values: degToDms(48.8584) }] }],
  ["Destination longitude", "high", { gps: [{ tag: 0x0016, type: 5, values: degToDms(2.2945) }] }],
  ["Destination bearing", "high", { gps: [{ tag: 0x0018, type: 5, values: [[90, 1]] }] }],
  ["Destination distance", "high", { gps: [{ tag: 0x001a, type: 5, values: [[3, 1]] }] }],
  ["Image title", "medium", { exif: [{ tag: 0xa436, type: 2, values: "Our flat, kitchen" }] }],
  ["Camera firmware", "medium", { exif: [{ tag: 0xa439, type: 2, values: "FW 2.1.4" }] }],
  ["RAW developing software", "medium", { exif: [{ tag: 0xa43a, type: 2, values: "RawLab 3" }] }],
  ["Image editing software", "medium", { exif: [{ tag: 0xa43b, type: 2, values: "PhotoLab 12" }] }],
  ["Metadata editing software", "medium", { exif: [{ tag: 0xa43c, type: 2, values: "TagTool 1" }] }],
  ["Document name", "medium", { ifd0: [{ tag: 0x010d, type: 2, values: "jordan-passport.jpg" }] }],
  ["Page name", "medium", { ifd0: [{ tag: 0x011d, type: 2, values: "Scan 2" }] }],
];

for (const [name, severity, spec] of IDENTITY_TAGS) {
  test(`${name} gets its own ${severity} line and never the clean headline`, async () => {
    const jpeg = jpegWith(spec);
    const report = await inspectImage(jpeg);
    const item = report.items.find((i) => i.id === `exif:${name}`);
    assert.ok(item, JSON.stringify(report.items.map((i) => i.id)));
    assert.equal(item.severity, severity);
    assert.doesNotMatch(headline(report), CLEAN);
    assert.equal((await verifyClean(jpeg)).clean, false);
  });
}

test("text in a tag nobody named is shown, not counted away", async () => {
  const shapes = [
    ["ascii", { exif: [{ tag: 0xc7b6, type: 2, values: "Jordan Sample" }] }, "exif:text:exif:0xc7b6", "medium"],
    ["undefined bytes", { ifd0: [{ tag: 0xc7b7, type: 7, values: Array.from("12 Elm Street", (c) => c.charCodeAt(0)) }] }, "exif:text:0:0xc7b7", "medium"],
    ["gps", { gps: [{ tag: 0x001e, type: 3, values: 1 }] }, "exif:gps:0x001e", "high"],
    ["gps text", { gps: [{ tag: 0x0030, type: 7, values: asciiCharsetBytes("Home") }] }, "exif:gps:0x0030", "high"],
  ];
  for (const [what, spec, id, severity] of shapes) {
    const jpeg = jpegWith(spec);
    const report = await inspectImage(jpeg);
    const item = report.items.find((i) => i.id === id);
    assert.ok(item, `${what}: ${JSON.stringify(report.items.map((i) => i.id))}`);
    assert.equal(item.severity, severity, what);
    assert.doesNotMatch(headline(report), CLEAN, what);
    assert.equal((await verifyClean(jpeg)).clean, false, what);
  }
});

test("negative control: short codes and binary in unnamed tags stay in the low rollup", async () => {
  const report = await inspectImage(
    jpegWith({
      exif: [
        { tag: 0xc7b6, type: 2, values: "0100" },
        { tag: 0xc7b7, type: 2, values: "AB" },
        { tag: 0xc7b8, type: 7, values: [1, 2, 3, 0] },
        { tag: 0xc7b9, type: 7, values: [0x30, 0x32, 0x33, 0x32, 0x01, 0x41, 0x42, 0x43, 0x44] },
      ],
    }),
  );
  assert.deepEqual(report.items.map((i) => i.id), ["exif:other"]);
  assert.match(headline(report), CLEAN);
});

test("negative control: the fixtures keep their headlines and items", async () => {
  const expected = {
    "real-gps.jpg": [
      "This image says exactly where it was taken.",
      "gps exif:Artist exif:Image unique ID exif:Owner name exif:Body serial number thumbnail exif:Camera make exif:Camera model exif:Software exif:Modified exif:Taken exif:Time zone (original) exif:GPS date jfif exif:settings icc",
    ],
    "real-exif.webp": [
      "This image says exactly where it was taken.",
      "gps exif:Artist exif:Image unique ID exif:Owner name exif:Body serial number exif:Camera make exif:Camera model exif:Software exif:Modified exif:Taken exif:Time zone (original) exif:GPS date icc exif:settings",
    ],
    "clean.jpg": ["No personal metadata found. The pixels themselves are on you.", "jfif icc"],
  };
  for (const [name, [line, ids]] of Object.entries(expected)) {
    const report = await inspectImage(fixture(name));
    assert.equal(headline(report), line, name);
    assert.equal(report.items.map((i) => i.id).join(" "), ids, name);
  }
});

function hasExiftool() {
  try {
    execFileSync("exiftool", ["-ver"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

test("negative control: the version and color tags exiftool writes stay harmless", async (t) => {
  if (!hasExiftool()) {
    t.skip("exiftool not installed");
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "sepia-benign-"));
  try {
    const file = path.join(dir, "benign.jpg");
    copyFileSync(new URL("fixtures/clean.jpg", import.meta.url), file);
    execFileSync("exiftool", ["-q", "-overwrite_original", "-ExifVersion=0232", "-FlashpixVersion=0100", "-ColorSpace=sRGB", file]);
    const report = await inspectImage(new Uint8Array(readFileSync(file)));
    assert.ok(report.items.length > 2, "exiftool wrote an Exif block");
    assert.ok(report.items.every((i) => i.severity === "low"), JSON.stringify(report.items));
    assert.match(headline(report), CLEAN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
