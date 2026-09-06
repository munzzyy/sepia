import test from "node:test";
import assert from "node:assert/strict";
import { scrubbedName, nameLeaks } from "../app/js/names.js";

test("scrubbed names carry no date, device, or sequence hints", () => {
  const name = scrubbedName("image/jpeg", Uint8Array.of(1, 2, 3));
  assert.match(name, /^image-[a-z2-9]{3}\.jpg$/);
  assert.equal(nameLeaks(name), false);
  assert.equal(scrubbedName("image/png", Uint8Array.of(0, 0, 0)), "image-aaa.png");
  assert.equal(scrubbedName("application/nonsense", Uint8Array.of(0, 0, 0)), "image-aaa.png");
});

test("two exports get different names", () => {
  const a = scrubbedName("image/png");
  const b = scrubbedName("image/png");
  assert.notEqual(a, b);
});

test("recognizes leaking source names", () => {
  for (const name of [
    "IMG_20260906_141503.jpg",
    "PXL_20260101_010101.jpg",
    "Screenshot 2026-09-06 at 14.15.03.png",
    "signal-2026-09-06-141503.jpg",
    "photo_2026-09-06 14.15.03.jpeg",
  ]) {
    assert.equal(nameLeaks(name), true, name);
  }
  assert.equal(nameLeaks("vacation.jpg"), false);
  assert.equal(nameLeaks(""), false);
});
