# Sepia

Share images without oversharing.

Photos and screenshots carry more than pixels: GPS coordinates, camera serial
numbers, the owner's name, timestamps to the second, sometimes a hidden
preview of the uncropped shot, sometimes a whole video clip appended by
motion-photo mode. People also keep shipping redactions that don't redact,
with highlighter smears over text that copies right back out.

Sepia is a small, serious tool for the moment before you hit send:

1. **X-ray.** Open an image and see everything the file says about you,
   ranked by how much it can hurt. GPS becomes a plain sentence, the hidden
   thumbnail is shown to you, trailing motion-photo data gets called out.
2. **Redact.** Ink boxes and pixelation burned into the pixels, plus crop.
   QR codes and barcodes are detected and offered for covering. The UI tells
   you honestly that pixelation is for faces, not text.
3. **Prove it.** Export re-encodes through a canvas, so the encoder never
   sees the original file. Then Sepia re-opens its own output, runs the same
   X-ray on it, and shows you the result. No green checkmark on faith.

Everything happens on your device. The web app never uploads anything and
works offline once loaded. The Android app ships with **no INTERNET
permission**: the OS will not let it open a connection, and you can verify
that in the manifest instead of trusting a privacy policy.

## Verify the claims yourself

- `aapt2 dump permissions sepia.apk` shows no `uses-permission` lines beyond
  the androidx not-exported marker. No INTERNET.
- The web app's CSP allows connections to its own origin only, and the page
  makes none beyond loading its own files.
- `npm test` runs 51 unit tests including negative controls: the parsers are
  cross-checked against exiftool, and every "clean" verdict is tested against
  deliberately dirty input so a broken parser cannot fake a clean scrub.
- `npm run e2e` drives the real app in Chromium, exports a file, and then
  verifies the output *outside* the app: independent parsers, exiftool, and
  pixel probes on the redacted region.

## What Sepia does not do

Read [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) before trusting it with
anything serious. The short version: it removes metadata and covers pixels
you choose. It does not recognize sensitive content for you (beyond QR
codes), does not handle PDFs, and does not defeat pixel-level forensics like
camera sensor fingerprints.

## Run it

Web: serve `app/` from any static host, or `node test/serve_local.mjs` for
local dev. No build step, no dependencies.

Android: `cd android && ./gradlew assembleRelease`. The wrapper syncs
`app/` into its assets at build time, so the APK and the website can never
drift apart.

## Develop

```
npm test              # unit tests (node >= 24)
npm run e2e           # chromium end-to-end suites
npm run fixtures      # regenerate demo + test images
node tools/extract-strings.mjs   # i18n catalog check
```

MIT licensed.
