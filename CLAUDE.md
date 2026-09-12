# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Watchtower는 Xcode로 macOS 앱으로 패키징되는 (macOS 전용, iOS 미지원) **Safari 웹 확장**(Manifest V3)이다. 치지직 여러 채널을 한 화면 격자로 보는 **상황실**과 영상 시청 편의 기능(자동 PiP, 유튜브 미니플레이어, Shorts 숨김, 동영상 프레임 캡처, 눌러서 빨리감기)을 제공한다. 설정 팝업은 없고, 툴바 아이콘은 상황실을 연다. 기능 토글은 상황실 안 설정 서랍에 있다. 실제 개발은 대부분 `Shared (Extension)/Resources/` 아래 JavaScript에서 이루어지며, Swift 호스트 앱은 거의 Apple 템플릿 그대로다.

## 언어 정책 (한글 우선)

**한글이 기본(primary), 영어가 서브(secondary)다.** 코드 주석, 사용자 대면 문자열, 토스트 메시지, 문서 모두 한글을 먼저 쓰고 영어는 보조 번역으로 둔다.

- 코드 주석: 한글로 작성한다.
- i18n 문자열: `_locales/ko/messages.json`이 기준이고 `_locales/en/messages.json`이 보조 번역이다. 문자열을 추가할 때는 한글을 먼저 작성하고 영어를 함께 채운다.
- README: `README.ko.md`가 원본이고 `README.md`가 영어 번역본이다.
- 코드 내 메시지(토스트 등)는 보통 `navigator.language.startsWith("ko")`로 분기하며 한글 문자열을 기본값으로 둔다.

## 빌드 / 실행

CLI 빌드·테스트·린트 설정은 없다. Xcode 프로젝트로 다룬다.

- `watchtower.xcodeproj`를 Xcode에서 열고 빌드 & 실행(⌘R)하면 호스트 앱이 한 번 뜬다. 이후 Safari → 설정 → 확장 프로그램에서 **Watchtower**를 활성화한다.
- 확장 리소스(JS/HTML/CSS)를 수정한 뒤에는 Xcode에서 다시 빌드하고 Safari에서 페이지를 새로고침해야 변경이 반영된다.
- 요구 사항: macOS 10.14+, Xcode 15+. 타깃은 `watchtower (macOS)` / `watchtower Extension (macOS)` 둘뿐이다.
- **서명 팀 ID는 저장소에 넣지 않는다.** 프로젝트 빌드 설정이 `Config/Base.xcconfig`를 참조하고, 그 파일이 `Config/Local.xcconfig`(git 무시)를 `#include?`로 선택 포함한다. `DEVELOPMENT_TEAM`은 Local.xcconfig에만 둔다. pbxproj에 `DEVELOPMENT_TEAM`이 생기면 커밋하지 말고 되돌릴 것.
- **Safari MCP(`safari-mcp-stp`)의 자동화 창에는 확장이 로드되지 않는다.** 확장 자체의 end-to-end 확인은 사용자가 실제 Safari에서 한다. MCP는 페이지 동작·DOM·치지직 API 검증과, 확장 코드를 shim과 함께 `evaluate_javascript`로 주입해 로직을 검증하는 데 쓴다.
- CLI 빌드: `xcodebuild -project watchtower.xcodeproj -scheme "watchtower (macOS)" -configuration Debug build`. 결과물이 DerivedData에 등록되어 Safari에 확장이 두 개로 보일 수 있으니, 배포 위치(`/Applications/watchtower.app`)로 복사한 뒤 DerivedData 쪽은 `lsregister -u`로 등록 해제한다. 복사만 하면 Safari 확장 목록에서 사라질 수 있으니 `pluginkit -a <appex 경로>`로 확장을 다시 등록하고 호스트 앱을 한 번 실행한다.
- 버전은 `manifest.json`의 `version`과 pbxproj의 `MARKETING_VERSION`을 함께 올린다.

## 아키텍처: 3개의 JS 실행 컨텍스트

확장은 능력이 서로 다른 세 컨텍스트로 작업을 나눈다. 어떤 능력이 어느 컨텍스트에 속하는지 아는 것이 핵심이다 — 엉뚱한 컨텍스트에 코드를 두면 조용히 실패한다.

- **`background.js`** (서비스 워커, `type: module`) — 권한을 가진 허브. 툴바 아이콘 클릭(`action.onClicked` → 상황실 탭 열기/포커스), 컨텍스트 메뉴, storage relay를 담당한다. 권한 API가 필요한 작업은 content script가 직접 호출할 수 없으므로 **background에 메시지를 보내야** 하며, 실제 작업은 background가 수행한다.
- **격리된 세계 content scripts** (`document_idle`) — DOM은 다룰 수 있지만 **페이지 전역(page의 `window`, 유튜브 JS 등)에는 접근할 수 없다.** `manifest.json`의 로드 순서대로 실행되며 **같은 격리 세계 전역(`window`)을 공유**한다: `wt-core.js`(공용 기반, 가장 먼저) → `content.js`(페이지 설정 브리지 + Shorts) → `speed.js`(눌러서 빨리감기). 상황실 경로(`chzzk.naver.com/wt-room`)는 별도 항목으로 `wt-core.js` → `room.js`를 **`document_start`**에 넣고, 일반 항목에서는 `exclude_matches`로 뺀다.
- **`page-script.js`** (MAIN 세계, `document_start`) — 페이지의 JS 컨텍스트에서 실행되어 페이지 전역이나 페이지가 노출하는 API가 필요한 작업을 처리한다.

content(격리)와 page(MAIN) 스크립트는 메시지 패싱이 아니라 **`document`의 `CustomEvent`**(예: `watchtower-settings`, `watchtower-download-frame`)로 통신한다.

### 공용 기반 — `wt-core.js` (격리 세계)

번들러가 없으므로, 가장 먼저 로드되는 `wt-core.js`가 `window.WT` 전역에 공용 서비스를 노출하고 이후의 기능 모듈들이 이를 공유한다. **새 기능을 추가할 때는 보일러플레이트를 다시 짜지 말고 `WT.*`를 사용한다.**

- `WT.log(tag, ...args)` — `debugEnabled`가 켜졌을 때만 `[WT][tag]`로 출력 (디버그 플래그 중앙 관리)
- `WT.load(keys)` — `storage.local.get` 래퍼 (Promise)
- `WT.watch(keys, cb)` — 해당 키가 바뀌면 `cb(changes)` 호출 (storageChanged relay를 한 곳에서 구독해 팬아웃)

background에 위임하는 공용 서비스를 추가할 때는 메시지 이름을 기능 중립적으로(`wt:*`) 짓는다. **특정 기능 이름으로 공용 서비스를 명명하지 말 것** — 여러 기능이 같은 서비스를 동등하게 사용할 수 있어야 한다.

### Safari 특유의 패턴 (함부로 "고치지" 말 것)

- **storage 변경은 background를 거쳐 relay된다.** Safari에서는 content script의 `storage.onChanged`가 신뢰성이 없어, `background.js`가 `storage.onChanged`를 듣고 활성 탭 content script로 `storageChanged` 메시지를 전달한다. content/page 스크립트에서 `storage.onChanged`에 직접 의존하지 말 것.
- **프레임 캡처는 `background.js`의 컨텍스트 메뉴 핸들러에서 `scripting.executeScript` + `world: "MAIN"`으로 실행한다.** content script를 거치지 않는다. 이렇게 해야 클립보드 접근에 필요한 사용자 제스처가 유지되고, 간헐적인 `sendMessage` 실패를 피할 수 있다. 안내 문구는 `page-script.js`의 `_wtFrameMsg(key)` 한 곳에서 관리하고 복사·다운로드 경로가 키로 참조한다.
- **상황실은 치지직 도메인 안(`/wt-room`)에서 산다.** `room.js`가 `document_start`에서 `window.stop()`으로 치지직 SPA 로딩을 끊고 문서를 통째로 우리 UI로 바꾼다. 각 채널은 **같은 출처 iframe**(`/live/<id>`)이며 부모가 `contentDocument`에 플레이어만 남기는 CSS(`#live_player_layout` 훅)를 주입한다. 확장 내부 페이지에서 교차 출처 iframe으로 띄우면 Safari ITP가 쿠키를 막아 로그인이 끊기므로(2026-09 STP 검증) 그 방식으로 "고치지" 말 것. 자동 재생은 음소거에서만 되므로 소리는 사용자 클릭 안에서만 켠다. 치지직 내부 API 응답 형태는 바뀔 수 있어 `fetchFollowings`는 `channelId`를 가진 객체를 넓게 찾는다.
- **눌러서 빨리감기는 플랫폼에 같은 기능이 있으면 개입하지 않는다.** `speed.js`의 `NATIVE_HOSTS`(현재 YouTube)에서는 비활성이다. 새 사이트가 자체 길게-누르기 배속을 제공하면 여기에 추가한다.

## 컨벤션

- **로깅**: 격리 세계에서는 `WT.log(tag, ...)`를 쓴다(디버그 플래그 중앙 관리). MAIN 세계(`page-script.js`)는 격리 세계와 분리되어 있어 자체 플래그 `window._wtDebug`로 `[WT]` 로그를 낸다.
- **설정 추가**: 새 토글은 `room.js`의 `SETTINGS` 표 + `_locales`(ko 먼저, en) + 해당 기능 모듈의 `WT.watch`/`WT.load` 3곳을 함께 수정한다. 팝업은 없다.
- **Git/브랜치**: 브랜치 이름은 기능 중심으로 짓고, 이름에 `phase`라는 단어를 쓰지 않는다.

## 범위 메모

- `manifest.json`에 부여된 권한(`activeTab`, `storage`, `scripting`, `contextMenus`, `clipboardWrite`)과 `host_permissions`(`chzzk.naver.com`, 상황실 탭 조회용)가 정의되어 있다. 새 기능을 추가할 때는 보통 여기에 권한을 추가해야 한다.
- `SafariWebExtensionHandler.swift`는 표준 템플릿의 echo 핸들러이며, 현재 기능들은 네이티브 메시징을 사용하지 않는다.
