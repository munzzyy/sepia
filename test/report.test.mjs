import test from "node:test";
import assert from "node:assert/strict";
import { gpsWords, headline } from "../app/js/report.js";
import { inspectImage } from "../app/js/inspect.js";
import {
  structuralJpeg,
  buildExifSegment,
  buildTiff,
  sampleExifSpec,
  buildPng,
  identityGapSpec,
} from "./fixtures.mjs";

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
