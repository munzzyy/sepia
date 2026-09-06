// Output filenames. The original name is itself metadata: IMG_20260906_141503
// says when you were somewhere, PXL_ says which phone you carry, and a
// screenshot name embeds the exact second. Exports get a name that says
// nothing, with a short random tag so two exports never collide.

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function scrubbedName(mime, randomBytes) {
  const ext = EXT[mime] || "png";
  const raw =
    randomBytes ??
    (globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(5)) : null);
  let tag = "";
  if (raw) {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    for (const b of raw) tag += alphabet[b % alphabet.length];
  }
  return tag ? `image-${tag}.${ext}` : `image.${ext}`;
}

// True when a filename looks like it leaks capture details.
export function nameLeaks(name) {
  if (!name) return false;
  return (
    /20\d{6}/.test(name) ||
    /(19|20)\d{2}-\d{2}-\d{2}/.test(name) ||
    /^(IMG|PXL|DSC|MVIMG|VID|PANO|Screenshot|signal-|photo_)/i.test(name)
  );
}
