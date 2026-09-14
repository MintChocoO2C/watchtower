#!/bin/bash
# Watchtower: 빌드 → /Applications 설치 → 확장 재등록
set -euo pipefail
cd "$(dirname "$0")/../../.."
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
# 서명 팀 ID(git 무시 파일). 없으면 adhoc 서명이 되어 Safari 가 확장을 켜 주지 않는다.
# 워크트리에서 빌드할 때 빠지기 쉬우므로 본 저장소(main 체크아웃)의 것을 복사해 온다.
if [ ! -f Config/Local.xcconfig ]; then
    MAIN="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; MAIN="${MAIN%/.git}"
    if [ -n "$MAIN" ] && [ -f "$MAIN/Config/Local.xcconfig" ]; then
        cp "$MAIN/Config/Local.xcconfig" Config/Local.xcconfig
        echo "Config/Local.xcconfig 를 $MAIN 에서 복사함"
    else
        echo "Config/Local.xcconfig 가 없음 — Local.xcconfig.example 을 복사해 DEVELOPMENT_TEAM 을 채우세요 (없으면 adhoc 서명되어 Safari 에서 켜지지 않음)"; exit 1
    fi
fi
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
