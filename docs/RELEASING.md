# Releasing Sepia

The whole flow, in order. Nothing here is optional; the gates exist because
each one has caught a real bug.

## 1. Verify

```
npm test                          # unit tests, exiftool cross-check
npm run e2e                       # chromium and firefox suites, edge pixel probes
bash tools/check-clean.sh         # dashes, attribution, adblock names,
                                  # version, versionCode, fastlane changelog
node tools/extract-strings.mjs    # es catalog complete
```

## 2. Version

Bump together (check-clean fails if any drift): `package.json`,
`app/js/main.js` VERSION, `app/sw.js` VERSION (`sepia-v<x>`),
`android/app/build.gradle.kts` versionName + versionCode
(major*10000 + minor*100 + patch, so 0.5.1 is 501), `CHANGELOG.md`
heading, plus a fastlane changelog file named `<versionCode>.txt`.

## 3. Build and sign

```
bash tools/release-android.sh
```

Signs with apksigner from build-tools 34.0.0 (the version F-Droid's
apksigcopier can verify) using `~/keys/sepia-upload.jks`; the password
lives in the system keyring under `service sepia-keystore key upload`.
Artifacts land in `dist/` with sha256 sums printed, including the
stable-name `sepia.apk` used by the landing page and Tern.

## 4. Tag and publish

```
git tag v<x.y.z>
git push origin main --tags
gh release create v<x.y.z> dist/sepia-<x.y.z>.apk dist/sepia.apk \
  --title "Sepia <x.y.z>" --notes-file <(bash tools/release-notes.sh <x.y.z>)
```

Both APK assets every time: versioned for the record, stable-name so
`releases/latest/download/sepia.apk` keeps working. The notes are the
CHANGELOG section plus the APK's sha256 and the signing certificate
digest, which the README tells sideloaders to check.

## 5. After

- If the site is deployed anywhere, redeploy `app/` and then curl the live
  URL to confirm the new version actually serves (hosts cache).
- Store screenshots regenerate with `node tools/shots-store.mjs` when the
  UI changed.
- F-Droid picks up new tags via its checkupdates once the app is in
  fdroiddata; keep the tag on the exact commit the APK was built from.
