// Android 9: the build targets it, the wrapper turns away a WebView too old
// for the page and says why, saving goes through the system picker where
// MediaStore would need a storage permission, and the page skips
// BarcodeDetector on the one WebView build that crashes the app over it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codesSupported } from "../app/js/barcodes.js";

const KT = "android/app/src/main/kotlin/io/github/munzzyy/sepia/";
const KEYS = ["webview_title", "webview_too_old", "webview_missing", "android9_title", "android9_body", "saved"];

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const RES = "android/app/src/main/res/";

test("the build installs on Android 9", () => {
  assert.match(read("android/app/build.gradle.kts"), /^\s*minSdk = 28$/m);
});

test("every new string has a Spanish version with the same placeholders", () => {
  const en = read(RES + "values/strings.xml");
  const es = read(RES + "values-es/strings.xml");
  const get = (xml, key) => xml.match(new RegExp(`<string name="${key}"[^>]*>([^<]*)</string>`))?.[1];
  for (const key of KEYS) {
    assert.ok(get(en, key), `values/${key}`);
    assert.ok(get(es, key), `values-es/${key}`);
  }
  for (const xml of [en, es]) {
    const tooOld = get(xml, "webview_too_old");
    assert.ok(tooOld.includes("%1$d") && tooOld.includes("%2$d"), "needs the minimum and the phone's version");
    assert.doesNotMatch(xml, /[\u2013\u2014]/);
  }
  assert.match(get(en, "android9_body"), /January 2022/);
  assert.match(get(es, "android9_body"), /enero de 2022/);
});

test("the WebView check runs before any WebView exists", () => {
  const src = read(KT + "MainActivity.kt");
  const gate = src.indexOf("if (SystemCheck.blockIfWebViewTooOld(this)) return");
  const make = src.indexOf("WebView(this)");
  assert.ok(gate > 0 && make > 0 && gate < make);
  assert.ok(src.indexOf("SystemCheck.noteAndroid9(this)") > make, "the note comes after the page is set up");
});

test("a share into a blocked activity doesn't touch the missing WebView", () => {
  const src = read(KT + "MainActivity.kt");
  assert.match(src, /super\.onNewIntent\(intent\)\s*if \(!::webView\.isInitialized\) return/);
});

test("Android 9 saves through the system picker", () => {
  assert.match(
    read(KT + "SepiaBridge.kt"),
    /SDK_INT < Build\.VERSION_CODES\.Q\) \{\s*activity\.runOnUiThread \{ activity\.saveWithPicker\(bytes, mime, sanitize\(name\)\) \}\s*return/,
  );
});

test("a multi-select in the picker reaches the page", () => {
  const src = read(KT + "MainActivity.kt");
  assert.match(src, /callback\?\.onReceiveValue\(pickedUris\(result\.resultCode, result\.data\)\)/);
  assert.match(src, /val clip = data\?\.clipData/);
  assert.match(src, /\.filter \{ it\.scheme == "content" \}\s*\.take\(50\)/);
});

test("Save all on Android 9 queues its pickers instead of sharing one slot", () => {
  const src = read(KT + "MainActivity.kt");
  assert.doesNotMatch(src, /pendingSave: ByteArray\?/);
  assert.match(src, /import java\.util\.ArrayDeque/);
  assert.match(src, /pendingSaves\.addLast\(PendingSave\(bytes, mime, name\)\)\s*openNextSavePicker\(\)/);
  assert.match(src, /if \(pickerOpen\) return/);
});

test("the wrapper names the WebView build that crashes on BarcodeDetector", () => {
  assert.match(read(KT + "SepiaBridge.kt"), /fun codesSafe\(\): Boolean = WebView\.getCurrentWebViewPackage\(\)\?\.packageName != "com\.android\.webview"/);
});

test("codesSupported defers to the wrapper's codesSafe", () => {
  globalThis.BarcodeDetector = function () {};
  try {
    assert.equal(codesSupported(), true, "no wrapper: the browser decides");
    globalThis.SepiaNative = { codesSafe: () => false };
    assert.equal(codesSupported(), false);
    globalThis.SepiaNative = { codesSafe: () => true };
    assert.equal(codesSupported(), true);
    globalThis.SepiaNative = {};
    assert.equal(codesSupported(), true, "an older wrapper without codesSafe still works");
    delete globalThis.BarcodeDetector;
    globalThis.SepiaNative = { codesSafe: () => true };
    assert.equal(codesSupported(), false, "no API, no feature");
  } finally {
    delete globalThis.BarcodeDetector;
    delete globalThis.SepiaNative;
  }
});
