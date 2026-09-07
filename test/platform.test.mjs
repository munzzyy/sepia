// The iOS wrapper's save/share bridge, tested without a browser: a fake
// webkit.messageHandlers.save records what got posted, and a negative
// control removes it to prove the loud-failure path actually fires instead
// of a silent no-op.

import test from "node:test";
import assert from "node:assert/strict";
import { isWrapper, isIOSWrapped, isBundled, saveOut, shareOut } from "../app/js/platform.js";

function fakeBlob(bytes = [1, 2, 3, 4], type = "image/jpeg") {
  return {
    type,
    async arrayBuffer() {
      return new Uint8Array(bytes).buffer;
    },
  };
}

test.afterEach(() => {
  delete globalThis.location;
  delete globalThis.webkit;
  delete globalThis.SepiaNative;
});

test("isIOSWrapped/isBundled read the sepia: scheme, not any wrapper flag", () => {
  globalThis.location = { protocol: "https:" };
  assert.equal(isIOSWrapped(), false);
  assert.equal(isBundled(), false);
  globalThis.location = { protocol: "sepia:" };
  assert.equal(isIOSWrapped(), true);
  assert.equal(isBundled(), true);
  assert.equal(isWrapper(), false, "isWrapper stays Android-only");
});

test("iOS bridge present: saveOut posts to webkit.messageHandlers.save and reports a hand-off", async () => {
  globalThis.location = { protocol: "sepia:" };
  const posted = [];
  globalThis.webkit = { messageHandlers: { save: { postMessage: (m) => posted.push(m) } } };
  const how = await saveOut(fakeBlob(), "photo.jpg");
  assert.equal(how, "handoff");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].name, "photo.jpg");
  assert.equal(posted[0].mime, "image/jpeg");
  assert.equal(typeof posted[0].b64, "string");
  assert.ok(posted[0].b64.length > 0);
});

test("iOS bridge present: shareOut posts the same way and reports success", async () => {
  globalThis.location = { protocol: "sepia:" };
  const posted = [];
  globalThis.webkit = { messageHandlers: { save: { postMessage: (m) => posted.push(m) } } };
  const ok = await shareOut(fakeBlob(), "photo.jpg");
  assert.equal(ok, true);
  assert.equal(posted.length, 1);
});

test("negative control: iOS scheme with no bridge fails loud instead of silently downloading", async () => {
  globalThis.location = { protocol: "sepia:" };
  // No globalThis.webkit at all: a stale wrapper build, or a hostile page
  // trying to claim wrapper status without the real bridge.
  const how = await saveOut(fakeBlob(), "photo.jpg");
  assert.equal(how, "unsupported");
  const ok = await shareOut(fakeBlob(), "photo.jpg");
  assert.equal(ok, false);
});

test("negative control: a bridge object present on a non-sepia origin is not trusted", async () => {
  // The scheme check and the bridge check are both required so an https
  // page embedding a fake webkit.messageHandlers.save cannot pose as the
  // wrapper.
  globalThis.location = { protocol: "https:" };
  const posted = [];
  globalThis.webkit = { messageHandlers: { save: { postMessage: (m) => posted.push(m) } } };
  const ok = await shareOut(fakeBlob(), "photo.jpg");
  assert.equal(ok, false, "falls through to navigator.share/canShare, which are absent in this test env");
  assert.equal(posted.length, 0, "the fake bridge was never called");
});
