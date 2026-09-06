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

// X-ray item labels and details are assembled dynamically in inspect.js and
// translated at render time, so the t("...") scan cannot see them. Kept as
// an explicit list; ui.js renderXray/renderProof route each through t().
const XRAY_STRINGS = [
  "Location",
  "Location fields",
  "Hidden preview image",
  "Data after the image ends",
  "IPTC metadata",
  "XMP metadata",
  "Extended XMP",
  "Multi-picture data",
  "Comment",
  "JFIF header",
  "Adobe encoder marker",
  "Color profile",
  "Camera settings",
  "Other Exif fields",
  "Exif block",
  "Exif data",
  "Unrecognized data blocks",
  "File structure unreadable",
  "Exif field list truncated",
  "Last modified",
  "Camera make",
  "Camera model",
  "Software",
  "Modified",
  "Taken",
  "Digitized",
  "Artist",
  "Copyright",
  "Description",
  "Owner name",
  "Body serial number",
  "Lens serial number",
  "Lens make",
  "Lens model",
  "Lens specification",
  "Image unique ID",
  "User comment",
  "Time zone",
  "Time zone (original)",
  "GPS date",
  "GPS time",
  "Exact coordinates of where this image was taken.",
  "A second, smaller copy of the photo stored inside the file. Croppings and edits sometimes leave the original preview behind.",
  "Phones in motion-photo mode append a short video clip here. Anything after the image marker travels with the file, invisible in every viewer.",
  "News-style metadata: often creator name, captions, and locations.",
  "Vendor-specific data this X-ray cannot itemize. Re-encoding removes it all the same.",
  "Treat the report above as a minimum, not a full accounting.",
  "AI generation prompt and settings.",
];
for (const s of XRAY_STRINGS) strings.add(s);

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
