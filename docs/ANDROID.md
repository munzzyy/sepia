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
- **Save:** MediaStore insert into `Pictures/Sepia`. No storage permission
  is needed for app-created images on minSdk 29.
- **Secure screen:** FLAG_SECURE, because the canvas holds the unredacted
  original and the app switcher thumbnails whatever was on screen.
- **Font scale:** the system font size reaches the page through textZoom.

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
