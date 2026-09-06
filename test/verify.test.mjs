import test from "node:test";
import assert from "node:assert/strict";
import { verifyClean } from "../app/js/verify.js";
import {
  structuralJpeg,
  buildExifSegment,
  buildTiff,
  sampleExifSpec,
  buildPng,
  str,
} from "./fixtures.mjs";

test("clean output verifies clean", async () => {
  const { clean, leftovers } = await verifyClean(buildPng());
  assert.equal(clean, true);
  assert.equal(leftovers.length, 0);
});

test("negative control: dirty bytes fail verification", async () => {
  const dirty = structuralJpeg({ segments: [buildExifSegment(buildTiff(sampleExifSpec()))] });
  const { clean, leftovers } = await verifyClean(dirty);
  assert.equal(clean, false);
  assert.ok(leftovers.length > 0);
});

test("negative control: a trailer alone fails verification", async () => {
  const { clean } = await verifyClean(buildPng({ trailer: str("EXTRA") }));
  assert.equal(clean, false);
});

test("low-severity leftovers (color profile) still count as clean", async () => {
  const jpeg = structuralJpeg();
  const { clean } = await verifyClean(jpeg);
  assert.equal(clean, true);
});
