// The proof step. After export, the finished bytes go back through the same
// X-ray that judged the original. "Trust us, it's clean" is what every
// scrubber says; this one shows its work on the actual output file.

import { inspectImage } from "./inspect.js";

export async function verifyClean(bytes) {
  const report = await inspectImage(bytes);
  const leftovers = report.items.filter((i) => i.severity !== "low");
  return {
    clean: report.ok && leftovers.length === 0 && !report.trailer && !report.thumbnail && !report.gps,
    leftovers,
    report,
  };
}
