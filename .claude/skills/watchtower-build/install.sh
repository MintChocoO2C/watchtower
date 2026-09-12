#!/bin/bash
# Watchtower: 빌드 → /Applications 설치 → 확장 재등록
set -euo pipefail
cd "$(dirname "$0")/../../.."
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
xcodebuild -project watchtower.xcodeproj -scheme "watchtower (macOS)" -configuration Debug build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
DD="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/watchtower-*/Build/Products/Debug/watchtower.app | head -1)"
[ -d "$DD" ] || { echo "빌드 결과물을 찾지 못함"; exit 1; }
rm -rf /Applications/watchtower.app
cp -R "$DD" /Applications/
$LSR -u "$DD/Contents/PlugIns/watchtower Extension.appex" 2>/dev/null || true
$LSR -u "$DD" 2>/dev/null || true
rm -rf "$DD"
$LSR -f /Applications/watchtower.app
pluginkit -a "/Applications/watchtower.app/Contents/PlugIns/watchtower Extension.appex"
open -a /Applications/watchtower.app
echo "installed: $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' /Applications/watchtower.app/Contents/Info.plist) → Safari 상황실 탭을 새로고침하세요"
