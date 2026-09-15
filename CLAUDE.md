# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Watchtower는 Xcode로 macOS 앱으로 패키징되는 (macOS 전용, iOS 미지원) **Safari 웹 확장**(Manifest V3)이다. 치지직 여러 채널을 한 화면 격자로 보는 **상황실**과 영상 시청 편의 기능(자동 PiP, 유튜브 미니플레이어, Shorts 숨김, 동영상 프레임 캡처, 눌러서 빨리감기)을 제공하며, 치지직 광고의 SKIP 버튼을 자동으로 누른다. 설정 팝업은 없고, 툴바 아이콘은 상황실을 연다. 기능 토글은 상황실 안 설정 서랍에 있다. 실제 개발은 대부분 `Shared (Extension)/Resources/` 아래 JavaScript에서 이루어지며, Swift 호스트 앱은 거의 Apple 템플릿 그대로다.

## 언어 정책 (한글 우선)

**한글이 기본(primary), 영어가 서브(secondary)다.** 코드 주석, 사용자 대면 문자열, 토스트 메시지, 문서 모두 한글을 먼저 쓰고 영어는 보조 번역으로 둔다.

- 코드 주석: 한글로 작성한다.
- i18n 문자열: `_locales/ko/messages.json`이 기준이고 `_locales/en/messages.json`이 보조 번역이다. 문자열을 추가할 때는 한글을 먼저 작성하고 영어를 함께 채운다.
- README: `README.ko.md`가 원본이고 `README.md`가 영어 번역본이다.
- 코드 내 메시지(토스트 등)는 보통 `navigator.language.startsWith("ko")`로 분기하며 한글 문자열을 기본값으로 둔다.

## 빌드 / 설치 / 검증

테스트·린트 설정은 없다. 빌드는 Xcode 또는 `xcodebuild` 로 한다.

- **가장 빠른 길**: 프로젝트 스킬 `watchtower-build` (`.claude/skills/watchtower-build/`). `install.sh` 가 빌드 → `/Applications/watchtower.app` 교체 → DerivedData 결과물의 Launch Services 등록 해제 → `pluginkit -a` 로 확장 재등록 → 호스트 앱 1회 실행까지 한다. 끝나면 사용자에게 Safari 상황실 탭 새로고침을 요청한다.
  - 왜 이 순서인가: DerivedData 결과물이 등록된 채로 두면 Safari 확장 목록에 Watchtower 가 두 개로 보이고, 앱을 복사만 하면 목록에서 사라진다.
- Xcode 로 할 때: `watchtower.xcodeproj` 를 열고 ⌘R. 호스트 앱이 한 번 뜬 뒤 Safari → 설정 → 확장 프로그램에서 **Watchtower** 를 켠다. 리소스(JS/CSS)를 고치면 다시 빌드하고 페이지를 새로고침해야 반영된다.
- 요구 사항: macOS 10.14+, Xcode 15+. 타깃은 `watchtower (macOS)` / `watchtower Extension (macOS)` 둘뿐이다(iOS 미지원).
- **서명 팀 ID는 저장소에 넣지 않는다.** 프로젝트 빌드 설정이 `Config/Base.xcconfig` 를 참조하고, 그 파일이 `Config/Local.xcconfig`(git 무시)를 `#include?` 로 선택 포함한다. `DEVELOPMENT_TEAM` 은 Local.xcconfig 에만 둔다. pbxproj 에 `DEVELOPMENT_TEAM` 이 생기면 커밋하지 말고 되돌릴 것.
- 버전은 `manifest.json` 의 `version` 과 pbxproj 의 `MARKETING_VERSION`(4곳)을 함께 올린다.

### 검증 도구의 한계

- **Safari MCP(`safari-mcp-stp`)가 여는 자동화 창에는 확장이 로드되지 않는다.** STP 에서 Watchtower 를 켜도 마찬가지다. 확장 자체(툴바 클릭, `document_start` 교체, 실제 마우스 제스처, 드래그)는 사용자가 실제 Safari 에서 확인한다.
  - 예외(2026-09-15 확인): 그날은 STP 자동화 창에서 `/wt-room` 이 실제 확장으로 떴고 타일의 공식 플레이어도 재생됐다(단독 `/live` 페이지는 광고 차단 대화상자로 미디어를 안 열었다). 되면 그대로 쓰되, 자동화 창은 다른 도구를 부를 때마다 `document.hidden` 이 되어 1초 주기 감시가 쉬므로 `switch_tab` 직후 한 번의 `evaluate_javascript`(30초 제한) 안에서 관찰한다. `URL로 추가` 의 `prompt()` 는 `browser_dialogs` 로 답한다. 확장을 재설치하면 STP 쪽 확장 storage(채널 목록)는 비워진다.
- MCP 는 (a) 치지직 페이지 DOM·네트워크·내부 API 확인, (b) 상황실 로직 주입 검증에 쓴다. (b)는 스킬의 `make-bundle.py` 로 shim+코드 번들을 만들어 `evaluate_javascript` 에 붙여 넣는다. MCP 의 `page_interactions` 클릭은 우리 리스너에 잘 닿지 않으니 로직은 `element.click()` 으로 확인한다.
- 앱 내 Chromium 브라우저는 Safari 정책(ITP·자동재생)과 달라 검증에 쓰지 않는다.

## 아키텍처: 3개의 JS 실행 컨텍스트

확장은 능력이 서로 다른 세 컨텍스트로 작업을 나눈다. 어떤 능력이 어느 컨텍스트에 속하는지 아는 것이 핵심이다 — 엉뚱한 컨텍스트에 코드를 두면 조용히 실패한다.

- **`background.js`** (서비스 워커, `type: module`) — 권한을 가진 허브. 툴바 아이콘 클릭(`action.onClicked` → 상황실 탭 열기/포커스), 컨텍스트 메뉴, storage relay를 담당한다. 권한 API가 필요한 작업은 content script가 직접 호출할 수 없으므로 **background에 메시지를 보내야** 하며, 실제 작업은 background가 수행한다.
- **격리된 세계 content scripts** (`document_idle`) — DOM은 다룰 수 있지만 **페이지 전역(page의 `window`, 유튜브 JS 등)에는 접근할 수 없다.** `manifest.json`의 로드 순서대로 실행되며 **같은 격리 세계 전역(`window`)을 공유**한다: `wt-core.js`(공용 기반, 가장 먼저) → `content.js`(페이지 설정 브리지 + Shorts) → `speed.js`(눌러서 빨리감기) → `adskip.js`(치지직 광고 SKIP 자동 클릭). 상황실 경로(`chzzk.naver.com/wt-room`)는 별도 항목으로 `wt-core.js` → `adskip.js` → `room.js`를 **`document_start`**에 넣고, 일반 항목에서는 `exclude_matches`로 뺀다.
- **`page-script.js`** (MAIN 세계, `document_start`) — 페이지의 JS 컨텍스트에서 실행되어 페이지 전역이나 페이지가 노출하는 API가 필요한 작업을 처리한다.

content(격리)와 page(MAIN) 스크립트는 메시지 패싱이 아니라 **`document`의 `CustomEvent`**(예: `watchtower-settings`, `watchtower-download-frame`)로 통신한다.

### 공용 기반 — `wt-core.js` (격리 세계)

번들러가 없으므로, 가장 먼저 로드되는 `wt-core.js`가 `window.WT` 전역에 공용 서비스를 노출하고 이후의 기능 모듈들이 이를 공유한다. **새 기능을 추가할 때는 보일러플레이트를 다시 짜지 말고 `WT.*`를 사용한다.**

- `WT.log(tag, ...args)` — `debugEnabled`가 켜졌을 때만 `[WT][tag]`로 출력 (디버그 플래그 중앙 관리)
- `WT.load(keys)` — `storage.local.get` 래퍼 (Promise)
- `WT.watch(keys, cb)` — 해당 키가 바뀌면 `cb(changes)` 호출 (storageChanged relay를 한 곳에서 구독해 팬아웃)
- `WT.notify(changes)` — 자기 탭에서 설정을 바꾼 직후 같은 탭의 구독자에게 즉시 전달. **relay 는 자기 탭으로 돌아오지 않을 수 있으므로**(상황실에서 광고 건너뛰기를 꺼도 그 탭에선 계속 동작하던 버그) 설정을 쓰는 쪽은 `set` 뒤에 이걸 부른다. 구독자 처리는 멱등이어야 한다.

background에 위임하는 공용 서비스를 추가할 때는 메시지 이름을 기능 중립적으로(`wt:*`) 짓는다. **특정 기능 이름으로 공용 서비스를 명명하지 말 것** — 여러 기능이 같은 서비스를 동등하게 사용할 수 있어야 한다.

### Safari 특유의 패턴 (함부로 "고치지" 말 것)

- **storage 변경은 background를 거쳐 relay된다.** Safari에서는 content script의 `storage.onChanged`가 신뢰성이 없어, `background.js`가 `storage.onChanged`를 듣고 **열린 모든 탭**의 content script로 `storageChanged` 메시지를 전달한다(비활성 탭에서도 토글이 즉시 반영되게). content/page 스크립트에서 `storage.onChanged`에 직접 의존하지 말 것.
- **프레임 캡처는 `background.js`의 컨텍스트 메뉴 핸들러에서 `scripting.executeScript` + `world: "MAIN"`으로 실행한다.** content script를 거치지 않는다. 이렇게 해야 클립보드 접근에 필요한 사용자 제스처가 유지되고, 간헐적인 `sendMessage` 실패를 피할 수 있다. 안내 문구는 `page-script.js`의 `_wtFrameMsg(key)` 한 곳에서 관리하고 복사·다운로드 경로가 키로 참조한다.
- **상황실은 치지직 도메인 안(`/wt-room`)에서 산다.** 확장 내부 페이지에서 교차 출처 iframe으로 띄우면 Safari ITP가 쿠키를 막아 로그인이 끊기므로(2026-09 STP 검증) 그 방식으로 "고치지" 말 것. 자세한 설계는 아래 절.

### 상황실(`room.js`) 설계 메모

- **문서 교체**: `document_start` 에서 `window.stop()` 으로 치지직 SPA 로딩을 끊고 `documentElement.innerHTML = ""` 로 비운다. **이때 프래그먼트 파서가 빈 `<head>`/`<body>` 를 자동으로 만든다.** 새로 만들어 append 하면 둘씩 생기고 `document.body` 는 빈 쪽을 가리켜 화면이 검게 된다(실제로 겪은 회귀). 파서가 만든 head/body 를 채워 쓴다.
- **한 문서에 인스턴스는 하나**: Safari 는 확장을 다시 빌드·등록하거나 껐다 켜면 이미 열린 탭에도 content script 를 다시 주입한다. 옛 인스턴스의 폴링이 살아 있으면 타일이 겹치고 설정 표시가 흐트러진다. `buildDocument` 가 `<html data-wt-room>` 을 표시하고, 그 표시가 있으면 새 인스턴스는 시작하지 않는다. 새 코드는 탭 새로고침으로 반영한다.
- **설정 서랍 표시**: 열 때마다 `syncSettingsInputs()` 로 저장값을 다시 읽어 토글을 맞춘다(relay 가 자기 탭에 안 올 수 있고, 표시는 항상 저장값과 같아야 한다).
- **타일**: 채널마다 같은 출처 iframe(`/live/<id>`). 부모가 `contentDocument` 에 플레이어만 남기는 CSS(`#live_player_layout` 훅, 조상의 transform/position 해제)를 주입한다. **타일은 만들어진 뒤 DOM 위치를 옮기지 않는다** — iframe 을 떼었다 붙이면 재로드되므로 순서는 CSS `order` 로만(추가·삭제·스왑 공통).
- **소리**: 의도는 `state.sounds`(여러 개), 실제는 각 iframe 의 `video.muted`(`volumechange` capture 구독으로 플레이어 자체 버튼 조작도 따라감). 우리 UI 에는 소리 버튼이 없고 테두리 발광으로만 표시한다. 자동 재생은 음소거에서만 되므로 `navigator.userActivation.hasBeenActive` 가 있을 때만 풀고, 없으면 `sound-pending` 으로 두었다가 첫 `pointerdown` 에 적용한다. 우리가 되돌린 음소거는 `tile.autoMuting` 으로 표시해 사용자 조작으로 치지 않는다. **음소거 타일에 `play()` 를 부르지 말 것**(플레이어의 광고/준비 단계가 멈춘다).
- **종료된 방송**: 60초 폴링(`/service/v2/channels/<id>/live-detail`, 로그인 불필요)에서 `open === false` 면 격자에서 빼고 iframe 을 내린 뒤 하단 선반(`.wt-shelf`)에 칩으로 둔다. 다시 켜지면 원래 순서 자리에 타일을 새로 만든다. 팔로우 목록에서 추가할 때는 목록이 준 켜짐/종료를 먼저 반영하고 그린다(격자에 잠깐 떴다가 밀려나지 않게).
- **집중 보기**(`state.focus`): 타일 더블클릭(플레이어의 더블클릭 전체화면은 capture 에서 차단) 또는 상단 바 확대 버튼. 그 타일이 `.wt-body` 를 `position:absolute` 로 채우고 소리는 그 채널만(들어갈 때 `soundBackup`, 나올 때 복원). 나머지 타일은 자리에 둔 채 `visibility:hidden`(재생 유지). Esc/←/→/숫자 키 지원. **←/→ 는 키마다 바로 옮기지 않는다**: 실제 전환(`enterFocus` → `render`)이 방송이 많을수록 무거워 피드백이 늦게 보이므로, 누르는 즉시 방향 화살표(`.wt-focus-nav`)를 번쩍이고 토스트에 `→ n / 전체 · 채널명`을, 목표 타일을 `wt-preview` 클래스로 화면 구석에 작게(CSS 만, DOM 이동 없음) 미리 보여 준 뒤 입력이 `state.focusStepDelay`(설정 `roomFocusStepDelay`, 기본 500ms, 서랍 슬라이더 0.1~2초) 동안 멈추면 한 번만 옮긴다(`focusPending`). 커밋은 "옮기는 중" 표시를 먼저 그리려고 rAF 뒤로 미루되, 숨겨진 탭에선 rAF 가 안 오므로 120ms 타임아웃과 경쟁시킨다.
- **집중 모드 = 저지연 모드**(`state.latency`, 설정 `roomFocusPauseOthers`/`roomLatencyAuto`/`roomLatencyThreshold`): 치지직 live-detail 은 일반 HLS(`_h`)와 저지연 LL-HLS(`_p`) 두 변형을 주고 공식 플레이어(Safari)는 항상 저지연 변형을 네이티브로 재생한다(저지연 토글 없음). 2026-09-15 STP 실측: 저지연 단독 재생 3.6~3.9초, 일반 변형 ~32초. **한 번이라도 멈추면(2초 일시정지도) Safari 가 저지연 모드를 버리고 seekable 창 자체가 ~20초 뒤로 밀린 채 돌아오지 않는다** — `currentTime = seekable.end` 도 배속도 그 벽을 못 넘고, `video.src` 재설정만 3.6초로 복구한다. 격자의 큰 지연은 스트림 선택이 아니라 타일끼리 대역폭을 나누다 멈춰서 이 추락이 쌓인 것. 그래서 집중 보기에 들어가면 (1) 나머지 타일 iframe 을 `about:blank` 로 내리고(`parkTile`, DOM 위치·순서 유지, 나올 때 로드 큐로 재개; 미리보기는 플레이스홀더로 보인다) (2) 집중 타일의 `video.getStartDate()`+`currentTime` 으로 1초마다 벽시계 지연을 재어 배지(`.wt-latency`)에 보이고 (3) 기준(기본 8초)을 3초 넘게 넘으면 seek 가 아니라 `catchUp` 으로 `video.src` 를 다시 넣는다(30초 쿨다운, 10분 4회, 10초 안에 재생이 안 돌아오면 `retryTile` 로 iframe 재로드). 다시 불러온 직후 첫 표본이 기준을 넘으면(시계 오차·저지연 아님) `hopeless` 로 자동을 쉰다. 사용자가 멈춘 동안·광고·로딩 중엔 재지 않는다. STP 자동화 창에서는 공식 플레이어가 미디어를 열지 않으므로 공식 플레이어에서의 `getStartDate()` 유효성과 src 재설정 뒤 플레이어 UI 생존은 실기 Safari 로 확인한다.
- **채팅 서랍**(`.wt-chatdock`, 집중 보기 전용): 치지직 팝업 채팅 `/live/<id>/chat` 을 같은 출처 iframe 으로 담는다. 열림/닫힘은 CSS `:hover` 가 아니라 명시적 `open` 클래스다 — 서랍에 `pointerenter` 하면 열고, 서랍에서 `pointerleave` 하면 120ms 뒤 닫되 상단 바·선반 `pointerenter` 가 오면 취소, 채팅 입력 중(`:focus-within`)엔 유지. iframe 사이(채팅→영상) 이동은 부모의 `pointerleave` 로만 안정적으로 잡힌다. 손잡이는 반투명 알약. 서랍은 왼쪽·오른쪽 두 개를 항상 만들어 두고 `roomChatSides`(`{left, right}`)로 각각 켜고 끈다 — 둘 다 켜면 양쪽, 둘 다 끄면 없음. 한 번에 하나만 열리고, 꺼진 쪽은 iframe 을 `about:blank` 로 내린다. 예전 단일 값 `roomChatSide` 는 로드 시 옮긴다.
- **재생 실패**: 5초마다 `video.error` 와 플레이어 문구("재생이 실패")를 감지해 오버레이를 덮고 자동 재시도(10분 3회) 후 수동 버튼을 남긴다.
- **치지직 내부 API**: 응답 형태가 바뀔 수 있어 `fetchFollowings` 는 `channelId` 를 가진 객체를 넓게 찾는다. 팔로우 목록(`/service/v1/channels/followings/live`, `/followings`)은 로그인 필요.
- **광고 자동 건너뛰기(`adskip.js`)는 `button.btn_skip` 에서 `hide` 클래스가 벗겨지는 순간 `click()` 한다.** 광고 DOM(`.skip_area`, `.pzp-pc--adbreak`)은 광고 중에만 존재하고 끝나면 제거된다(2026-09 STP 확인). content script 는 최상위 프레임에서만 돌므로 상황실 타일은 `onTileLoad` 에서 `WT.adSkip.watch(contentDocument)` 로 부모가 등록한다. 설정 기본값이 켜짐인 유일한 토글이라 `SETTINGS` 항목의 `def: true` 로 표현한다.
- **소리 평준화(PoC, `roomLevelerEnabled`/`roomLevelerTarget`)는 플레이어 소리를 캡처하지 않는다.** Safari 는 `<video>` 소리를 Web Audio 로 넘겨주지 않는다 — 네이티브 HLS 도, `navigator.vendor` 를 바꿔 hls.js(MSE) 로 보내도 분석기에 0 만 온다(2026-09-13 실기기 확인, CORS 무관). 그래서 live-detail 의 `livePlaybackJson` 에서 HLS 주소를 얻어 가장 낮은 변형(144p) 세그먼트를 10초에 하나(처음 3개는 3초 간격) 받아 `OfflineAudioContext.decodeAudioData` 로 풀어 BS.1770 식(K-가중 + 게이트) 라우드니스(LUFS 근사)를 재고(프로파일 `v: 2`, 측정 방식이 바뀌면 올려서 옛 값을 버린다), 최근 12표본의 파워 평균이 1dB 이상 달라졌을 때만 `video.volume`(최대 100%)을 1초 램프로 맞춘다. 실시간 추종은 하지 않는다(사용자 요구). 소리가 켜진 타일만 재고, 음소거 타일은 표본을 간직한 채 쉰다(다시 켜면 옛 평균으로 즉시 맞추고 5분 넘게 쉬었으면 빠른 주기로 갱신). 채널별 평균은 `roomLevelerProfiles` 에 저장해 다음에 열 때 바로 맞추고, 표본 편차가 작으면 주기를 30·60초로 늘린다. 탭 숨김·정지·버퍼링 중엔 재지 않고, 분석 컨텍스트는 8kHz 모노다. 부족분은 배지로 표시. 플레이어가 volume 을 사용자 설정으로 저장하므로 끌 때 원래 값으로 되돌린다.
- **눌러서 빨리감기는 플랫폼에 같은 기능이 있으면 개입하지 않는다.** `speed.js`의 `NATIVE_HOSTS`(현재 YouTube)에서는 비활성이다. 새 사이트가 자체 길게-누르기 배속을 제공하면 여기에 추가한다.

## 컨벤션

- **로깅**: 격리 세계에서는 `WT.log(tag, ...)`를 쓴다(디버그 플래그 중앙 관리). MAIN 세계(`page-script.js`)는 격리 세계와 분리되어 있어 자체 플래그 `window._wtDebug`로 `[WT]` 로그를 낸다.
- **설정 추가**: 새 토글은 `room.js`의 `SETTINGS` 표 + `_locales`(ko 먼저, en) + 해당 기능 모듈의 `WT.watch`/`WT.load` 3곳을 함께 수정한다. 상황실 전용 설정(예: 채팅 서랍 좌/우 다중 선택 세그먼트)은 `buildSettingsDrawer` 에 행을 직접 만들고 `render()` 에서 현재 값을 표시한다. 세그먼트 버튼 갱신 시 선택자 범위를 한정할 것(`.wt-seg-btn` 전체를 잡으면 다른 세그먼트를 덮어쓴다 — 겪은 버그). 팝업은 없다.
- **Git/브랜치**: Git Flow 접두어를 쓴다. 형식은 `<종류>/<범위>-<요약>`.
  - `feature/` 새 기능·기능 확장 (예: `feature/room-empty-state`)
  - `bugfix/` 버그 수정·회귀 복구 (예: `bugfix/adskip-missed-click`)
  - `hotfix/` 배포된 버전이 깨져 바로 고쳐야 할 때 (예: `hotfix/room-black-screen`)
  - `release/` 버전 올림·릴리스 준비 (예: `release/1.8`)
  - `chore/` 빌드·설치 스크립트·문서·저장소 정리 등 기능과 무관한 작업 (예: `chore/repo-cleanup`, `chore/readme-leveler`)
  - 범위(scope)는 모듈 이름을 쓴다: `room`(상황실), `adskip`, `speed`, `pip`, `yt`(유튜브 미니플레이어·Shorts), `capture`(프레임 캡처), `core`(`wt-core.js`·background), `build`. 여러 모듈에 걸치면 생략한다.
  - 소문자 영어 kebab-case, 종류 뒤 부분은 2~4단어. `phase`, 날짜, 사람 이름은 넣지 않는다.
  - 항상 `main` 에서 따고 PR 로 합친 뒤 브랜치를 지운다. 기능 브랜치 하나에 버그 수정을 끼워 넣지 말고 `bugfix/` 를 따로 딴다.

## 범위 메모

- `manifest.json`에 부여된 권한(`activeTab`, `storage`, `scripting`, `contextMenus`, `clipboardWrite`)과 `host_permissions`(`chzzk.naver.com`, 상황실 탭 조회용)가 정의되어 있다. 새 기능을 추가할 때는 보통 여기에 권한을 추가해야 한다.
- `SafariWebExtensionHandler.swift`는 표준 템플릿의 echo 핸들러이며, 현재 기능들은 네이티브 메시징을 사용하지 않는다.
