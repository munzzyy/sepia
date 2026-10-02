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

test("every X-ray label, detail and computed value the fixtures produce is in the es catalog", async () => {
  const { inspectImage } = await import("../app/js/inspect.js");
  const f = await import("./fixtures.mjs");
  const jpeg = (...segments) => f.structuralJpeg({ segments });
  const app = (marker, text) => f.concat(Uint8Array.of(0xff, marker), f.u16be(text.length + 2), f.str(text));
  const files = [
    jpeg(f.buildExifSegment(f.buildTiff(f.sampleExifSpec(f.FAKE_THUMB))), f.buildXmpSegment(f.SAMPLE_XMP), f.buildIptcSegment(), f.buildCommentSegment("hello")),
    jpeg(f.buildExifSegment(f.buildTiff(f.identityGapSpec())), f.buildXmpSegment("<x:xmpmeta/>"), app(0xfe, "\x01\x02\x03")),
    jpeg(app(0xe2, "MPF\0data"), app(0xe1, "http://ns.adobe.com/xmp/extension/\0x"), app(0xe4, "vendor"), app(0xee, "Adobe"), app(0xe1, "Exif\0\0XX")),
    jpeg(app(0xe2, "ICC_PROFILE\0\x01\x01not a profile")),
    f.structuralJpeg({ trailer: f.str("\0\0\0\x18ftypmp42") }),
    f.structuralJpeg({ trailer: f.str("PK\x03\x04") }),
    f.structuralJpeg({ trailer: f.str("\xff\xd8\xff") }),
    f.structuralJpeg().subarray(0, 20),
    f.buildPng({
      text: [["Author", "Jordan Sample"], ["parameters", "a prompt"], ["Comment", ""]],
      ztxt: [["Description", "note"]],
      itxt: [["XML:com.adobe.xmp", f.SAMPLE_XMP]],
      exif: f.buildTiff(f.sampleExifSpec()),
      time: true,
      trailer: f.str("APPENDED"),
    }),
    f.buildPng({ exif: f.str("not a tiff") }),
    f.structuralWebp({ exif: f.buildTiff(f.sampleExifSpec()), xmp: f.SAMPLE_XMP }),
    f.concat(f.structuralWebp(), f.str("TAIL")),
    f.str("\0\0\0\x18ftypheic....Exif....<x:xmpmeta"),
  ];
  const keys = new Set();
  for (const bytes of files) {
    for (const item of (await inspectImage(bytes)).items) {
      keys.add(item.labelT || item.label);
      if (item.detail) keys.add(item.detail);
      if (item.valueT) keys.add(item.valueT);
      for (const v of Object.values(item.vars || {})) if (Array.isArray(v)) v.forEach((w) => keys.add(w));
    }
  }
  assert.ok(keys.size > 60, `only ${keys.size} keys reached`);
  const missing = [...keys].filter((k) => !(k in es));
  assert.deepEqual(missing, []);
  for (const k of keys) {
    const want = (k.match(/\{\w+\}/g) || []).sort().join();
    assert.equal((es[k].match(/\{\w+\}/g) || []).sort().join(), want, k);
  }
});
