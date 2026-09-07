# Sepia on iOS

The `ios/` directory is a native wrapper around the exact same `app/` the
website and the Android APK ship: a WKWebView serving the bundle on the
fixed origin `sepia://localhost`, with no networking code of its own.

## Build it

You need a Mac with Xcode 15 or newer. The Xcode project is generated, not
checked in:

```
brew install xcodegen
cd ios
xcodegen generate
open Sepia.xcodeproj
```

Before you press run: select the Sepia target, open Signing & Capabilities,
and pick your own Apple ID under Team (Xcode adds a free personal team the
first time you sign in with one). `io.github.munzzyy.sepia` is already
claimed by the actual release, so change the bundle identifier to something
of your own if signing complains it is taken.

With a free Apple ID this gives you a personal build that runs on your own
device for 7 days at a time; App Store or TestFlight distribution needs a
paid developer account, and Sepia is not published there today. The first
time you run it on a physical device, iOS will refuse to open it until you
go to Settings > General > VPN & Device Management and trust your own
developer certificate.

CI builds the wrapper for the iOS simulator on every push and fails if a
permission prompt or an App Transport Security exception ever appears in the
built Info.plist. What CI cannot do is run it on physical hardware or drive
VoiceOver, so treat device and accessibility behavior as verified by people,
not by the pipeline; see "Verify on device" below.

## What is different from Android, honestly

- **The network guarantee is weaker.** Android lets an app ship without the
  INTERNET permission, so the OS itself stops Sepia from ever opening a
  connection. iOS has no such permission. What holds the line here is the
  meta Content-Security-Policy the page itself carries (`app/index.html`;
  nothing but `'self'` is loadable) plus a wrapper that ships no networking
  code of its own. That covers every `fetch`, `XHR`, image, and script the
  page could issue. It does not cover WebRTC, which a CSP cannot restrict on
  any platform; Sepia ships no WebRTC code, so the guarantee here is "no
  code paths that could reach the network, plus a CSP fence around the
  code that exists", not an OS-level block.
- **Export goes through the share sheet, not a download link.** The wrapper
  registers a `save` message handler (`ios/Sources/SaveBridge.swift`). Save
  and Share both hand the exported bytes to that bridge, which writes them
  to a scratch file and opens `UIActivityViewController`; that sheet is
  where "Save to Files", Photos, AirDrop, and other apps all live. If a
  build somehow ships without the bridge wired up, the page detects that
  and reports the failure instead of pretending the file downloaded
  somewhere.
- **No share-sheet intake yet.** On Android you can share an image straight
  into Sepia. The iOS wrapper opens images through the in-app picker only; a
  proper share extension is on the roadmap. The intake hint on iOS says so
  plainly instead of promising a share target that is not there.
- **App-switcher privacy works differently.** Android uses FLAG_SECURE; the
  iOS wrapper covers the window with a blur shield the moment the app leaves
  the foreground, so the switcher thumbnails the shield, not your photo.
  Unlike FLAG_SECURE, the shield does nothing against a screenshot or a
  screen recording while the app is in the foreground; there is no iOS API
  that blocks those.
- **Backups.** The wrapper excludes its WebKit working directory from
  iCloud and iTunes/Finder device backups (`ios/Sources/App.swift`), the
  same intent as Android's `allowBackup="false"`. Sessions live in memory
  either way and nothing is written to disk beyond that working directory
  and the one export file a save/share hand-off creates.
- **Dynamic Type.** The system text-size setting reaches the page the way
  Android's textZoom does, and it now tracks live: changing the setting
  while Sepia is open rescales the page immediately instead of only at
  launch.

## What Sepia's own web accessibility gives you here, and what it does not

The page's accessibility work (keyboard box creation, arrow-key movement,
live-region announcements, labeled controls) is the same code on every
platform, iOS included. Two limits are worth stating plainly rather than
letting someone find them the hard way:

- **Covering a face, a block of text, or a code needs a pointer drag or a
  hardware keyboard.** VoiceOver on a touchscreen, with no keyboard
  attached, cannot draw a box on the canvas today. This is not iOS-specific
  and is not fixed by anything in this wrapper.
- **Metadata removal does not need any of that.** Everything the X-ray
  panel lists (GPS, camera identity, the hidden preview, timestamps, all of
  it) comes out on export whether or not a single box was ever drawn. A
  VoiceOver user who cannot redact visible content can still get a fully
  scrubbed file: open the image, then Scrub & export.

## Verify on device

Nothing here runs in CI. Before calling a build good:

- VoiceOver reaches every control: the intake picker, the toolbar, the
  X-ray list and its Copy/Show actions, the export format controls, Save
  and Share.
- Dynamic Type: change the system text size while Sepia is open and
  confirm the page rescales without a relaunch.
- Save and Share both reach the system share sheet with a real file
  (`UIActivityViewController`), not a silent no-op.

## The no-install alternative

Safari on iOS can install a hosted copy of `app/` directly: open the site,
tap Share, then "Add to Home Screen". That needs an https origin serving
`app/` at the domain root; see the main [README](../README.md#get-it) for
where that stands today. The wrapper exists for people who prefer a real
app binary whose contents are pinned by a release they can verify.

## One rule for maintainers

`sepia://localhost` is the storage origin. Renaming the scheme or the host
orphans every user's saved data with no migration path. Never change it.
