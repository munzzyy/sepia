#!/bin/bash
# Usage: bash tools/release-notes.sh 0.5.1   (CHANGELOG section, APK sha256 and cert digest, from dist/ only)
set -euo pipefail
cd "$(dirname "$0")/.."

ver="${1:?usage: tools/release-notes.sh <version>}"
apk="dist/sepia-$ver.apk"
apksigner="${ANDROID_HOME:-$HOME/Android/Sdk}/build-tools/34.0.0/apksigner"

[ -f "$apk" ] || { echo "missing $apk; build it with tools/release-android.sh first" >&2; exit 1; }
[ -x "$apksigner" ] || { echo "missing $apksigner" >&2; exit 1; }

notes=$(awk -v want="$ver" '
  /^## / { on = ($2 == want); next }
  !on { next }
  /^$/ { if (line != "") print line; line = ""; print ""; next }
  /^- / { if (line != "") print line; line = $0; next }
  { sub(/^ +/, ""); line = (line == "" ? $0 : line " " $0) }
  END { if (line != "") print line }
' CHANGELOG.md | sed -e '/./,$!d' | cat -s)
[ -n "$notes" ] || { echo "CHANGELOG.md has no ## $ver section" >&2; exit 1; }

sha=$(sha256sum "$apk" | cut -d' ' -f1)
cert=$("$apksigner" verify --print-certs "$apk" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
[ -n "$cert" ] || { echo "apksigner printed no signer digest for $apk" >&2; exit 1; }

printf '%s\n\n' "$notes"
printf '**Verify what you install**\n\n'
printf '```\nsha256 sepia-%s.apk  %s\nsigning cert sha256  %s\n```\n' "$ver" "$sha" "$cert"
if cmp -s "$apk" dist/sepia.apk; then
  printf '\n`sepia.apk` is the same file as `sepia-%s.apk` under a stable name.\n' "$ver"
fi
