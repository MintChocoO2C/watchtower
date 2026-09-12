---
name: watchtower-build
description: Watchtower(Safari 확장) 빌드 → /Applications 설치 → 확장 재등록까지 한 번에 하고, Safari MCP로 상황실(room.js) 로직을 주입 검증하는 절차. "빌드해줘", "설치해줘", "확장 반영해줘", "상황실 테스트" 요청에 사용.
---

# Watchtower 빌드·설치·검증

## 1. 빌드 + 설치 (한 줄)

```bash
bash .claude/skills/watchtower-build/install.sh
```

하는 일: `xcodebuild`(macOS 스킴, Debug) → `/Applications/watchtower.app` 교체 → DerivedData 결과물의
Launch Services 등록 해제(안 하면 Safari 확장 목록에 두 개로 보임) → `pluginkit -a`로 확장 재등록 → 호스트 앱 1회 실행.
끝나면 사용자에게 **Safari 상황실 탭 새로고침**을 요청한다(확장 리소스는 새로고침해야 반영).

- 서명: `Config/Local.xcconfig`(git 무시)의 `DEVELOPMENT_TEAM`을 쓴다. 없으면 `Config/Local.xcconfig.example`을 복사해 채운다.
- pbxproj에 `DEVELOPMENT_TEAM`이 생기면 커밋하지 말고 되돌린다(공개 저장소).

## 2. 검증 원칙

- **Safari MCP(`safari-mcp-stp`) 자동화 창에는 확장이 로드되지 않는다.** 확장 자체(툴바 클릭, document_start 교체, 실제 제스처)는 사용자가 실제 Safari에서 확인한다.
- MCP로는 (a) 치지직 페이지 DOM/API 확인, (b) 상황실 로직 주입 검증을 한다.
- 앱 내 Chromium 브라우저는 Safari 정책(ITP, 자동재생)과 달라 검증에 쓰지 않는다.

## 3. 상황실 로직 주입 검증 (MCP)

1. 번들 생성: `python3 .claude/skills/watchtower-build/make-bundle.py > /tmp/wt-bundle.js`
   (확장 API shim + wt-core.js + room.js + room.css를 한 덩어리로. 채널·소리·배치 초기 상태는 스크립트 상단에서 조정)
2. MCP `create_tab`으로 `https://chzzk.naver.com/wt-room` 을 열고 `wait_for_navigation`.
3. `evaluate_javascript`에 번들 내용을 그대로 붙여 넣어 실행 → `"injected: 상황실 · Watchtower"` 가 돌아와야 한다.
4. 상태 확인 예: `return [...document.querySelectorAll(".wt-tile")].map(t => ({id: t.dataset.id.slice(0,6), cls: t.className}))`.
   번들은 `window.__wt = { state, tiles, render, addChannel, removeChannel, swapChannels, ... }` 를 노출한다.
5. 이 방식은 치지직 SPA가 이미 돌고 있는 페이지 위에 덮는 것이라 실제 확장(document_start + window.stop)과 다르다.
   **`document.body.className` 이 `wt-room` 으로 시작하지 않으면 head/body 중복 문제**(아래)를 의심한다.

## 4. 알려진 함정

- `document.documentElement.innerHTML = ""` 은 빈 head/body를 자동 생성한다. 새로 만들어 append 하면 둘씩 생긴다 → 파서가 만든 것을 채워 쓴다.
- iframe을 DOM에서 옮기면 재로드된다 → 순서는 CSS `order` 로만.
- 음소거 타일에 `play()` 를 부르면 플레이어(광고/준비 단계)가 멈출 수 있다.
- 소리는 사용자 제스처 안에서만 켤 수 있다. `navigator.userActivation.hasBeenActive` 로 판단하고, 없으면 pending.
- 교차 출처(확장 페이지) iframe에서는 ITP로 쿠키가 없다 → 상황실은 치지직 도메인 안(`/wt-room`)에서만.
