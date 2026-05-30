# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Watchtower는 Xcode로 iOS + macOS 앱으로 패키징되는 **Safari 웹 확장**(Manifest V3)이다. 영상 시청 편의 기능(자동 PiP, 유튜브 미니플레이어, Shorts 숨김, 동영상 프레임 캡처), Vimium 스타일 키보드 내비게이션, 마우스 제스처(휠 버튼 드래그)를 제공한다. 실제 개발은 대부분 `Shared (Extension)/Resources/` 아래 JavaScript에서 이루어지며, Swift 호스트 앱은 거의 Apple 템플릿 그대로다.

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
- 요구 사항: macOS 10.14+, Xcode 15+.

## 아키텍처: 3개의 JS 실행 컨텍스트

확장은 능력이 서로 다른 세 컨텍스트로 작업을 나눈다. 어떤 능력이 어느 컨텍스트에 속하는지 아는 것이 핵심이다 — 엉뚱한 컨텍스트에 코드를 두면 조용히 실패한다.

- **`background.js`** (서비스 워커, `type: module`) — 권한을 가진 허브. 컨텍스트 메뉴, `tabs.*`/`sessions.*` 작업, 메시지 라우팅을 담당한다. 권한 API가 필요한 content script(예: Vimium의 `F`·탭 명령용 `tabs.create`)는 **background에 메시지를 보내야** 하며, 실제 작업은 background가 수행한다.
- **격리된 세계 content scripts** (`document_idle`) — DOM은 다룰 수 있지만 **페이지 전역(page의 `window`, 유튜브 JS 등)에는 접근할 수 없다.** `manifest.json`의 로드 순서대로 실행되며 **같은 격리 세계 전역(`window`)을 공유**한다: `wt-core.js`(공용 기반, 가장 먼저) → `content.js`(페이지 설정 브리지 + 상태 응답 + Shorts) → `vimium.js`(키보드 네비) → `gestures.js`(마우스 제스처).
- **`page-script.js`** (MAIN 세계, `document_start`) — 페이지의 JS 컨텍스트에서 실행되어 페이지 전역이나 페이지가 노출하는 API가 필요한 작업을 처리한다.

content(격리)와 page(MAIN) 스크립트는 메시지 패싱이 아니라 **`document`의 `CustomEvent`**(예: `watchtower-settings`, `watchtower-download-frame`)로 통신한다.

### 공용 기반 — `wt-core.js` (격리 세계)

번들러가 없으므로, 가장 먼저 로드되는 `wt-core.js`가 `window.WT` 전역에 공용 서비스를 노출하고 이후의 기능 모듈들이 이를 공유한다. **새 기능을 추가할 때는 보일러플레이트를 다시 짜지 말고 `WT.*`를 사용한다.**

- `WT.log(tag, ...args)` — `debugEnabled`가 켜졌을 때만 `[WT][tag]`로 출력 (디버그 플래그 중앙 관리)
- `WT.load(keys)` — `storage.local.get` 래퍼 (Promise)
- `WT.watch(keys, cb)` — 해당 키가 바뀌면 `cb(changes)` 호출 (storageChanged relay를 한 곳에서 구독해 팬아웃)
- `WT.tabs.op(op)` / `WT.tabs.openTab(url)` — 탭 조작을 background에 위임하는 **중립 서비스**

탭 조작 메시지는 기능 중립적인 이름(`wt:tabs`, `wt:openTab`)을 쓴다. **특정 기능 이름(예전의 `vimium:tabs`)으로 공용 서비스를 명명하지 말 것** — vimium과 gestures가 같은 `WT.tabs`를 동등하게 사용한다.

### Safari 특유의 패턴 (함부로 "고치지" 말 것)

- **storage 변경은 background를 거쳐 relay된다.** Safari에서는 content script의 `storage.onChanged`가 신뢰성이 없어, `background.js`가 `storage.onChanged`를 듣고 활성 탭 content script로 `storageChanged` 메시지를 전달한다. content/page 스크립트에서 `storage.onChanged`에 직접 의존하지 말 것.
- **프레임 캡처는 `background.js`의 컨텍스트 메뉴 핸들러에서 `scripting.executeScript` + `world: "MAIN"`으로 실행한다.** content script를 거치지 않는다. 이렇게 해야 클립보드 접근에 필요한 사용자 제스처가 유지되고, 간헐적인 `sendMessage` 실패를 피할 수 있다.
- **Vimium은 키를 `KeyboardEvent.code`(물리 키)로 정규화한다.** `.key`가 아니다. 덕분에 한글 IME가 켜진 상태에서도 명령이 동작한다. 키 처리를 건드릴 때 이 동작을 유지할 것.

## 컨벤션

- **로깅**: 격리 세계에서는 `WT.log(tag, ...)`를 쓴다(디버그 플래그 중앙 관리). MAIN 세계(`page-script.js`)는 격리 세계와 분리되어 있어 자체 플래그 `window._wtDebug`로 `[WT]` 로그를 낸다.
- **설정 추가**: 새 토글은 popup(`popup.html`/`popup.js`) + `_locales`(ko 먼저, en) + 해당 기능 모듈의 `WT.watch`/`WT.load` 4곳을 함께 수정한다.
- **Git/브랜치**: 브랜치 이름은 기능 중심으로 짓고, 이름에 `phase`라는 단어를 쓰지 않는다.

## 범위 메모

- `manifest.json`에 부여된 권한(`tabs`, `sessions`, `scripting`, `contextMenus`, `clipboardWrite` 등)이 정의되어 있다. 새 기능을 추가할 때는 보통 여기에 권한을 추가해야 한다.
- `SafariWebExtensionHandler.swift`는 표준 템플릿의 echo 핸들러이며, 현재 기능들은 네이티브 메시징을 사용하지 않는다.
