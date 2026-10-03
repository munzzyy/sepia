// classes.dex was about 5.6MB unshrunk. R8 is on now, and the bridge the
// page calls by name through SepiaNative has to survive it: a renamed or
// stripped method breaks every bridge call silently, with no crash to see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the release build shrinks", () => {
  const gradle = read("android/app/build.gradle.kts");
  assert.match(gradle, /isMinifyEnabled = true/);
  assert.match(gradle, /isShrinkResources = true/);
  assert.match(gradle, /proguardFiles\(getDefaultProguardFile\("proguard-android-optimize\.txt"\), "proguard-rules\.pro"\)/);
});

test("the bridge's @JavascriptInterface methods are kept by name", () => {
  const rules = read("android/app/proguard-rules.pro");
  assert.match(
    rules,
    /-keepclassmembers class \* \{\s*@android\.webkit\.JavascriptInterface <methods>;\s*\}/,
  );
});
