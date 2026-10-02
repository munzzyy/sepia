# Changelog

## 0.6.0 (2026-10-02)

Fixes to the proof, the X-ray and the Android app.

- PNG exports in Firefox always ended on "Something survived". Firefox adds
  a small deBG chunk to PNGs a page encodes, holding a value tied to the
  browser profile. Sepia now drops chunks like that from its PNG output
  before the check, so the saved file is the one that was checked.
- Picking several images in the Android app's picker opened nothing. They
  all land in the batch screen now.
- On Android 9, Save all wrote one file and left the rest empty. Each file
  gets its own save picker now, one after another.
- The X-ray names more fields that point at a person or a place: the Exif
  photographer, image editor and title fields, the computer an image was
  made on, document and page names, and GPS destination coordinates. An
  unnamed field holding text, or any unnamed GPS field, gets its own line
  instead of a quiet count.
- Broken or fake Exif, color profile and marker blocks in an original no
  longer read as clean.
- The X-ray and the proof screen are fully in Spanish, values included.
- Transparent WebP images stay transparent: they export as PNG instead of
  JPEG with a black background.
- Add box in the toolbar puts a cover box on the image, and buttons under
  the image move it, resize it and remove it. Covering something no longer
  needs a drag or a keyboard.
- The web app works offline from a subpath like example.com/sepia/ too.
- Release notes carry the APK's sha256 and the signing certificate digest
  again.

## 0.5.1

A new icon.

- Sepia's paper card was hard to tell from Magpie's and Blot's on a home
  screen. The icon is now a sun over a hill, with the right side of the
  picture breaking up into pixels.

## 0.5.0

Sepia runs on Android 9.

- Sepia installs on Android 9 now. Saving there goes through the system
  save picker, because Android 9 has no way to add a photo to the gallery
  without a storage permission. The first time it opens on Android 9, Sepia
  says once that Android 9 has had no security fixes since January 2022.
- With an Android System WebView older than 108, the app says which version
  it needs instead of opening to a blank page.
- Opening an image no longer crashes the app on Google's AOSP WebView build
  (emulator images and some AOSP-based phones). That build crashes whenever
  a page looks for QR codes, so code finding is off there.

## 0.4.3

Sepia stays clear of the status bar and the camera cutout.

- On Android 15 and later the app no longer draws under the status bar, the
  camera cutout or the navigation bar. It showed on a Pixel Fold's outer
  screen (#6). Thanks to Catalyze4 for the report.

## 0.4.2

Sepia says who made it.

- A "Made by Munzzyy" credit sits next to the About link, in the app and on
  the web, linking to the author's GitHub.
- Relicensed to GPL-3.0-or-later. Releases up to v0.4.1 stay under MIT.
- The F-Droid listing gets an author link, a Donate link, and screenshots
  that no longer have a toast covering the results.

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
