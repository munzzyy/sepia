// QR and barcode discovery, so a boarding pass or ticket screenshot gets its
// code flagged before it ships. Uses the platform BarcodeDetector where the
// browser has one; where it does not, the feature honestly does not exist
// rather than shipping a heavyweight vendored decoder.

export function codesSupported() {
  return typeof globalThis.BarcodeDetector === "function";
}

export async function findCodes(bitmap) {
  if (!codesSupported()) return { supported: false, codes: [] };
  try {
    const detector = new BarcodeDetector();
    const found = await detector.detect(bitmap);
    return {
      supported: true,
      codes: found.map((c) => ({
        rect: {
          x: Math.floor(c.boundingBox.x),
          y: Math.floor(c.boundingBox.y),
          w: Math.ceil(c.boundingBox.width),
          h: Math.ceil(c.boundingBox.height),
        },
        format: c.format,
      })),
    };
  } catch {
    return { supported: false, codes: [] };
  }
}
