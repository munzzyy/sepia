// Lists every translatable English source string: data-i18n texts and
// attributes from the HTML, plus t("...") calls in the JS. Compares against
// the Spanish catalog and prints what is missing or stale.
//
// Run from the repo root:  node tools/extract-strings.mjs

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const norm = (s) => decode(String(s).replace(/\s+/g, " ").trim());

const strings = new Set();

const html = readFileSync(path.join(ROOT, "app", "index.html"), "utf8");
for (const m of html.matchAll(/<([a-z0-9]+)([^>]*\bdata-i18n(?=[\s=>])[^>]*)>([^<]*)</gi)) {
  const text = norm(m[3]);
  if (text) strings.add(text);
}
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"[^>]*/g)) {
  const tag = m[0];
  for (const attr of m[1].split(",")) {
    const v = tag.match(new RegExp(`${attr}="([^"]+)"`));
    if (v) strings.add(norm(v[1]));
  }
}
// Attributes can appear before data-i18n-attr in the tag too.
for (const m of html.matchAll(/<[a-z0-9]+ [^>]*data-i18n-attr="([^"]+)"[^>]*>/gi)) {
  const tag = m[0];
  for (const attr of m[1].split(",")) {
    const v = tag.match(new RegExp(`${attr}="([^"]+)"`));
    if (v) strings.add(norm(v[1]));
  }
}

const jsDir = path.join(ROOT, "app", "js");
for (const file of readdirSync(jsDir)) {
  if (!file.endsWith(".js") || file === "strings-es.js") continue;
  const src = readFileSync(path.join(jsDir, file), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    strings.add(norm(m[1].replace(/\\"/g, '"')));
  }
}

// X-ray strings are translated at render time, so they come from inspect.js literals and the tag tables.
const xraySrc = readFileSync(path.join(jsDir, "inspect.js"), "utf8");
for (const m of xraySrc.matchAll(/\b(?:label|labelT|detail):\s*"((?:[^"\\]|\\.)*)"/g)) strings.add(norm(m[1]));
for (const m of xraySrc.matchAll(/\btv\(\s*"((?:[^"\\]|\\.)*)"/g)) strings.add(norm(m[1]));
const { HIGH_TAGS, MEDIUM_TAGS, XMP_HITS } = await import(path.join(jsDir, "inspect.js"));
const { TAG_NAMES } = await import(path.join(jsDir, "tiff.js"));
const { TRAILER_KINDS } = await import(path.join(jsDir, "jpegscan.js"));
for (const [word] of XMP_HITS) strings.add(word);
for (const word of Object.values(TRAILER_KINDS)) strings.add(word);
const named = new Set(Object.values(TAG_NAMES));
const unnamed = [...HIGH_TAGS, ...MEDIUM_TAGS].filter((s) => !named.has(s));
if (unnamed.length) {
  console.log(`severity set entries that name no tag in tiff.js: ${unnamed.join(", ")}`);
  process.exit(1);
}
for (const s of [...HIGH_TAGS, ...MEDIUM_TAGS]) strings.add(s);

const { es } = await import(path.join(ROOT, "app", "js", "strings-es.js"));
const missing = [...strings].filter((s) => !(s in es));
const stale = Object.keys(es).filter((k) => !strings.has(k));

console.log(`source strings: ${strings.size}`);
if (missing.length) {
  console.log(`\nmissing from es (${missing.length}):`);
  for (const s of missing.sort()) console.log(`  ${JSON.stringify(s)}`);
}
if (stale.length) {
  console.log(`\nstale in es (${stale.length}):`);
  for (const s of stale.sort()) console.log(`  ${JSON.stringify(s)}`);
}
if (!missing.length && !stale.length) console.log("es catalog complete");
process.exit(missing.length ? 1 : 0);
