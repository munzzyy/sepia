# Changelog

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
