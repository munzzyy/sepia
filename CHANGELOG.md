# Changelog

## 0.4.1

The picker opens now.

- Choosing an image to scrub did nothing: the button opened no file picker
  at all. The WebView had never been handed a file-chooser, so the image
  input was dead. It opens now, filtered to images, and the photo loads
  straight into the editor.

## 0.4.0

Two things the X-ray missed.

- GPS free-text fields, GPS area information and GPS processing method, were
  skipped before the report ever decided what to name, so they never showed
  up no matter what they held. Anything else the tag table didn't recognize,
  MakerNote, Windows Explorer's XP author and title fields, fell into one
  quiet low-severity line instead of being called out by name, which meant a
  file carrying your actual name in one of those fields could still come
  back clean. An earlier pass already counted oversized MakerNotes as
  truncated bytes, but that bucket never named them, so the clean verdict
  held anyway. All of it is named and severity-checked now, cross-checked
  against exiftool.

## 0.3.0

The batch round.

- Batch scrub: queue several images, triage them in one view, and scrub
  everything metadata-only in one pass. Every file runs the same bake,
  encode, and re-verify path a hand edit uses, every verdict is fail-closed
  on its own, and the rollup proof re-checks each exported file outside
  the app.
- The proof screen develops like a darkroom print, the risk pill reads as
  the verdict, the dropzone answers your hand, X-ray rows sweep in, and
  Copy image puts the clean file on the clipboard or says plainly that it
  could not.

## 0.2.0

The iOS round.

- An iOS wrapper in `ios/`: the same app in a WKWebView on the permanent
  `sepia://localhost` origin, with Save and Share handing the scrubbed file
  to the system share sheet, and a loud failure if a build ever ships
  without that bridge. Build-from-source with Xcode; docs/IOS.md tells the
  whole truth, including what Android still does better.
- The complaint-hunt round: rem typography so browser text settings work,
  focus and announcement fixes, forced-colors support, an untimed discard
  confirm, a spelled-out VoiceOver route to a fully scrubbed export, and
  honest copy for every iPhone path that exists today.
- CI builds the iOS wrapper on macOS on every push and fails if a
  permission prompt ever appears in it.

## 0.1.0

First release.

- Metadata X-ray for JPEG, PNG, and WebP: Exif (with GPS decoding and
  embedded-thumbnail extraction), XMP, IPTC, PNG text chunks, WebP chunks,
  and trailing-data detection (motion-photo clips, appended files).
- Redaction that redacts: ink and pixelate burned into pixels, crop, undo
  and redo, full keyboard operation, QR/barcode detection with one-tap
  covering where the platform supports it.
- Scrub by re-encode: the output file is built fresh from the canvas, so
  the original container never reaches it. Exports as PNG or JPEG with a
  content-free filename.
- Proof screen: the exported bytes are re-opened and re-scanned, and the
  result is shown, including anything that survived.
- Offline-first PWA with share-target and file-handler registration,
  English and Spanish.
- Android wrapper with no INTERNET permission, share-in and share-out,
  save to gallery, secure-screen flag, backups disabled.
