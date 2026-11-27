#!/usr/bin/env bash
# Builds an UNSIGNED iOS app on macOS and packages it as native/dist/minigames-unsigned.ipa
# (Payload/App.app zipped). Sign/install it later with your own tooling (e.g. AltStore, Sideloadly,
# or re-sign with a development certificate).
#
# Usage (from anywhere, on a Mac with Xcode + Node 20+):
#   bash native/scripts/build-ios-unsigned.sh            # npm ci if needed, build-www + cap sync ios, xcodebuild, package
#   bash native/scripts/build-ios-unsigned.sh --skip-www # only xcodebuild + package (www/cap sync already done)
set -euo pipefail

cd "$(dirname "$0")/.."   # -> native/
NATIVE_DIR="$(pwd)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: iOS builds need macOS + Xcode (use the GitHub workflow .github/workflows/ios-unsigned.yml instead)" >&2
  exit 1
fi
command -v xcodebuild >/dev/null || { echo "error: xcodebuild not found (install Xcode, then: sudo xcode-select -s /Applications/Xcode.app)" >&2; exit 1; }

SKIP_WWW=0
[ "${1:-}" = "--skip-www" ] && SKIP_WWW=1

[ -d node_modules ] || npm ci
if [ "$SKIP_WWW" = 0 ]; then
  node scripts/build-www.mjs --platform ios     # vendor bundle + www + sync-manifest + cap sync ios + version
fi

DERIVED="$NATIVE_DIR/ios/App/build/DerivedData"
APP="$DERIVED/Build/Products/Release-iphoneos/App.app"
rm -rf "$APP"

xcodebuild -version
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  -skipPackagePluginValidation \
  -skipMacroValidation \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  build

[ -d "$APP" ] || { echo "error: $APP was not produced" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/Payload" dist
cp -R "$APP" "$STAGE/Payload/"
OUT="$NATIVE_DIR/dist/minigames-unsigned.ipa"
rm -f "$OUT"
(cd "$STAGE" && zip -qry "$OUT" Payload)

VERSION="$(node -p "require('./package.json').version")"
echo "ipa: $OUT ($(du -h "$OUT" | cut -f1), version $VERSION, unsigned)"
