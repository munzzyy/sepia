import test from "node:test";
import assert from "node:assert/strict";

globalThis.navigator ??= { languages: ["en-US"] };
const { t, setLocale, resolveLocale, norm } = await import("../app/js/i18n.js");
const { es } = await import("../app/js/strings-es.js");

test("english passes through untouched", () => {
  setLocale("en");
  assert.equal(t("Scrub this image"), "Scrub this image");
});

test("variables substitute once, never recursively", () => {
  setLocale("en");
  assert.equal(t("{count} fields found", { count: 3 }), "3 fields found");
  assert.equal(t("{a} and {b}", { a: "{b}", b: "X" }), "{b} and X");
});

test("unknown locale falls back to english", () => {
  setLocale("zz");
  assert.equal(t("Scrub this image"), "Scrub this image");
  assert.equal(resolveLocale("zz"), "en");
  setLocale("en");
});

test("catalog keys are normalized", () => {
  for (const key of Object.keys(es)) {
    assert.equal(key, norm(key), `catalog key not normalized: ${JSON.stringify(key)}`);
  }
});
