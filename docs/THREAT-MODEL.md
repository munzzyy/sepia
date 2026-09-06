# Sepia threat model

What this tool defends against, what it does not, and where the sharp edges
are. Written for people deciding whether to trust it with something that
matters.

## What Sepia protects you from

**The recipient of a shared image, and anyone downstream of them,** learning
things from the file that the pixels don't show:

- Location: Exif GPS, GPS date/time, XMP location fields.
- Identity: artist and owner-name fields, camera body and lens serial
  numbers, unique image IDs that tie separate photos to one camera.
- Time and context: capture timestamps, time zones, editing software names,
  comments, IPTC blocks.
- Hidden copies: the embedded Exif thumbnail (which can show what you
  cropped out), multi-picture blocks, and data appended after the image ends
  (motion-photo video clips are the common case).
- Visible content you chose to cover: ink and pixelation are drawn into the
  pixel data and the file is re-encoded. There is no layer to peel off.

The mechanism matters: Sepia does not "strip" metadata by editing the
original file. It decodes the image to raw pixels, draws your redactions,
and encodes a brand new file from the canvas. The encoder never sees the
original container, so there is nothing to accidentally keep. The X-ray on
the original is for your information; the scrub does not depend on the
parser having caught everything.

The verify step then re-parses the actual output bytes and reports what is
in them. If the environment's encoder ever wrote something unexpected, it
would show up there, not stay invisible.

## What Sepia does NOT protect you from

- **The pixels themselves.** A face, a street sign, a reflection, a tattoo,
  an address on an envelope. Sepia flags machine-readable codes (QR,
  barcodes) where the platform supports detection, and nothing else. Looking
  is your job.
- **Pixelation reversal on text.** Pixelated text can sometimes be
  reconstructed, and research keeps getting better at it. Sepia warns about
  this in the UI and uses large cells, but the honest rule stands: ink for
  text, pixelate only for faces and objects.
- **Camera sensor fingerprinting (PRNU).** Every camera sensor leaves a
  faint noise pattern in every photo. A well-resourced forensic analyst with
  reference photos from your camera can match them. No metadata scrubber
  touches this. If your adversary is a lab, do not share the photo.
- **Recompression fingerprinting.** JPEG quantization tables and encoder
  quirks can hint at what software produced a file. Sepia's output looks
  like standard browser canvas output, which is at least a very large crowd
  to hide in.
- **What you already sent.** Sepia has no reach into the copies that exist.
- **A compromised device.** If the device is already hostile, the image was
  exposed the moment you opened it anywhere.
- **PDFs and documents.** Out of scope on purpose. Document redaction has
  different failure modes and half-supporting it would invite exactly the
  disasters it is famous for.

## Where your image goes

Nowhere.

- **Web app:** the page loads its own files from its origin and that is the
  only network access its CSP allows. Images are read in memory, processed
  in memory, and handed back as a download or a share. Nothing image-related
  is written to browser storage, with one narrow exception: when you share
  INTO the installed web app, the browser's share-target machinery hands the
  file through a cache entry, which Sepia deletes on pickup. The Android app
  does not have this exception.
- **Android app:** no INTERNET permission, so the process cannot open
  sockets at all; this is enforced by the OS and visible in the manifest.
  The shared-in image is streamed from the content resolver directly into
  the page over a local interception, never written by Sepia to disk. The
  scrubbed output goes where you send it: the share sheet (via a scoped
  cache file that is cleared on the next share) or your gallery.
- The app-switcher thumbnail is blocked (FLAG_SECURE), because the screen
  holds the unredacted original while you work.
- Backups are disabled for the Android app, so no copy of anything rides
  along in a device backup or transfer.

## Trust surface

What you are trusting when you use Sepia:

- The browser or WebView's image decoder and canvas encoder (that is: the
  platform you already trust with every image you view).
- Sepia's own code: about three thousand lines of dependency-free
  JavaScript and a thin Kotlin shell, MIT licensed and readable in an
  afternoon.
- The site serving the web app (or the APK signature, once installed).

What you are NOT trusting: any server, any third-party library, any
analytics vendor, any promise that traffic "isn't logged". There is no
traffic.

## Known honest limitations

- The X-ray itemizes JPEG, PNG, and WebP. AVIF/HEIF metadata is flagged as
  present but not itemized; the scrub-by-re-encode covers those formats all
  the same.
- HEIC input does not decode in most browsers, so Sepia can't open it;
  sharing from a gallery usually converts to JPEG on the way.
- Animated GIFs flatten to their first frame; wide-gamut color is squeezed
  to sRGB; a JPEG re-encode at quality 90 is a small quality loss. These are
  the cost of the guarantee that the original container never reaches the
  output.
