// Turns the X-ray report into words a person acts on.

import { t } from "./i18n.js";

export function gpsWords(gps) {
  const ns = gps.latitude >= 0 ? "N" : "S";
  const ew = gps.longitude >= 0 ? "E" : "W";
  return `${Math.abs(gps.latitude).toFixed(5)}° ${ns}, ${Math.abs(gps.longitude).toFixed(5)}° ${ew}`;
}

export function headline(report) {
  if (!report.ok) return t("Could not read this file's structure. Re-encoding will still strip whatever is in it.");
  if (!report.analyzed)
    return t("This format's metadata is not itemized here. Re-encoding on export strips it all the same.");
  if (report.incomplete)
    return t("This file could not be fully read. Treat the list below as a minimum.");
  if (report.gps) return t("This image says exactly where it was taken.");
  if (report.trailer) return t("This file carries hidden data after the image ends.");
  if (report.thumbnail) return t("This file hides a second preview image inside.");
  if (report.counts.high > 0) return t("This image identifies you.");
  if (report.counts.medium > 0) return t("This image narrows down when and how it was made.");
  return t("No personal metadata found. The pixels themselves are on you.");
}

export function severityWord(severity) {
  if (severity === "high") return t("serious");
  if (severity === "medium") return t("revealing");
  return t("harmless");
}
