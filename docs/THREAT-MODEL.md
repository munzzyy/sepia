# Sepia threat model

What this tool defends against, what it doesn't, and where the sharp
edges are. If you're deciding whether to trust Sepia with a photo that
actually matters, read this whole page first. It's short on purpose.

## What it protects you from

The adversary is whoever you send the image to, plus everyone they forward
it to, plus every scraper that ever downloads it. What they'd learn beyond
the pixels: where the photo was taken (Exif GPS, XMP location), whose
camera took it (artist and owner-name fields, body and lens serials, the
unique image IDs that let two separate photos be pinned to one device),
and when and how (timestamps to the second, time zones, editing software,
comments, IPTC). Then there are the stowaways. Most people have no idea
their JPEG carries a second, smaller copy of itself, and that cropping in
many apps updates the big image while the old thumbnail keeps showing
whatever got cropped away. Motion-photo modes are worse: a real video
clip, glued on after the byte where the image format says the file ends,
carried around invisibly by every viewer and messenger that ships it.

Sepia surfaces all of that before you send, and it makes your redactions
real. Ink and pixelation get drawn into the pixel data itself. The file is
re-encoded afterward, so there's no annotation layer to peel off, no
"undo" living in the file.

One design decision does most of the security work, so I'll be precise
about it. Sepia never edits your original file and tries to snip out the
bad parts, the way most strippers do. It decodes the image to raw pixels,
draws your covers on those pixels, and encodes an entirely new file from
the canvas. The encoder is never shown the original container. So even if
the X-ray missed some exotic metadata block, that block has no route into
the output. Detection quality affects what you get warned about, never
what gets removed.

And then the output gets checked anyway. The proof screen is the same
parser that judged your original, pointed at the bytes you're about to
share. If a platform encoder someday writes something surprising into the
export, it lands on that screen, not in the dark.

## What it does NOT protect you from

The pixels themselves, first and always. A face, a street sign, a
reflection in a window, an address on an envelope: that's content, and
covering it is your judgment call. Sepia flags machine-readable codes
where the platform can detect them, and that is the whole extent of its
opinion about your pixels.

Pixelation reversal on text. Researchers keep getting better at
reconstructing pixelated writing. Sepia uses big cells and the UI pushes
you toward ink for anything textual, but the honest rule is simple: ink
for words and numbers, pixelate only for faces and objects.

Camera sensor fingerprinting. Every sensor leaves a faint noise pattern
(PRNU) in every photo it takes, and a forensic analyst with reference
shots from your camera can match them. No metadata scrubber touches this.
If your adversary is a lab, don't share the photo.

A few more, briefly. Recompression analysis can hint at which encoder
made a file; Sepia's output looks like ordinary browser canvas output,
an enormous crowd to hide in, but a crowd is not invisibility. Copies you
already sent are gone, obviously. A compromised device already saw
everything. And PDFs get refused outright. Court filings with peel-off
black boxes make the news every couple of years, document redaction fails
in its own special ways, and a tool that half-handles it would be worse
than one that says no.

## Where your image goes

Nowhere. Not "encrypted in transit", not "never sold". Nowhere.

The web page loads its own files from its origin and its CSP allows
nothing else. Images are read into memory, processed in memory, handed
back as a download or a share. Sepia writes no image data to browser
storage, with one narrow exception: sharing INTO the installed web app
goes through the browser's share-target machinery, which parks the file
in a cache entry that Sepia deletes on pickup.

The Android app has no INTERNET permission, so the process cannot open a
socket. That's enforced by the OS and visible in the manifest. An image
shared into the app streams from the content resolver straight into the
page through a local interception; Sepia never writes it to disk. Exports
go where you point them: the share sheet (through a scoped cache file,
cleared on the next share) or your gallery. The app switcher's screenshot
of the editor is blocked with FLAG_SECURE, since the screen holds the
unredacted original while you work, and backups are disabled so nothing
rides along in a device transfer.

## What you're trusting

Three things. Your browser or WebView's image decoder and canvas encoder,
which already handle every image you look at, so that trust is not new.
Sepia's own code, which is a few thousand lines of dependency-free
JavaScript plus a thin Kotlin shell, MIT licensed, honestly readable in an
afternoon. And the site serving you the web app, or the APK signature once
you've installed it.

Notice what's not on the list. No server. No third-party library. No
analytics vendor promising your data is handled respectfully. There is no
traffic to make promises about.

## Honest limitations

The X-ray itemizes JPEG, PNG, and WebP. AVIF and HEIF metadata gets
flagged as present rather than itemized; the scrub-by-re-encode covers
those formats all the same. HEIC input usually can't decode in a browser
at all, though sharing from a gallery tends to convert to JPEG on the way
out. Animated GIFs flatten to their first frame. Wide-gamut color gets
squeezed to sRGB, and a JPEG re-encode at quality 90 costs a little
fidelity. Those are the price of the rule that the original container
never reaches the output.
