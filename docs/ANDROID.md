# The Android wrapper

The web app is the app. The wrapper is a WebView on the fixed asset origin
plus the platform pieces a page cannot do alone. Everything in `app/` is
synced into assets at build time, so the APK and the website cannot drift.

## What the wrapper adds

- **Share in:** ACTION_SEND and ACTION_VIEW for `image/*`. The incoming
  content URI is held in RAM and served to the page at `/shared/<token>`
  through the WebViewAssetLoader interception, where the token is 16 random
  bytes generated per share. The image is never written to disk by Sepia and
  never crosses the JS bridge as a string.
- **Share out:** the scrubbed bytes go to a scoped cache directory exposed
  by a FileProvider, then to the system share sheet. The directory is
  emptied on the next share.
- **Save:** MediaStore insert into `Pictures/` on Android 10 and later,
  which needs no storage permission for app-created images. Android 9 has
  no permission-free way in, so there the save goes through the system
  save picker instead.
- **Secure screen:** FLAG_SECURE, because the canvas holds the unredacted
  original and the app switcher thumbnails whatever was on screen.
- **Font scale:** the system font size reaches the page through textZoom.

The page needs Android System WebView 108 or newer, because its layout uses
dvh units. Below that, the wrapper shows a plain native screen with the
version it needs and the one the phone has, instead of a blank page. On
Android 9 the first launch also shows a one-time note that Android 9 has had
no security fixes since January 2022.

Google's AOSP WebView build, the one on emulator images, kills the app when
the page creates a `BarcodeDetector`. The bridge's `codesSafe()` turns code
finding off there, and the page treats it like a browser without the API.

## What the wrapper deliberately lacks

- **INTERNET permission.** The manifest requests no permissions. Asset
  loading is interception, not networking. Any regression that introduces a
  network call would fail at the OS level rather than leak quietly.
- Backups and device transfer (excluded in data extraction rules).
- File and content URL access inside the WebView (`allowFileAccess` and
  `allowContentAccess` are off; the content URI hand-off goes through the
  interception instead).

## Build

```
cd android && ./gradlew assembleRelease
```

`tools/release-android.sh` signs with apksigner from build-tools 34.0.0 (the
version F-Droid's apksigcopier verifies) using the keystore outside the
repo, and drops versioned artifacts plus a stable-name `sepia.apk` in
`dist/`.
