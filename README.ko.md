# Watchtower

> 유튜브, 치지직 등 인터넷 방송을 쾌적하게 보기 위한 Safari 웹 확장 프로그램.

Watchtower는 Safari에서 영상 시청을 더 편하게 만드는 작은 기능들을 제공합니다.

[English README](README.md)

## 기능

- **Auto Picture-in-Picture** — 영상 재생 중 탭을 전환하면 자동으로 PiP 모드로 진입하고, 돌아오면 인라인 재생으로 복원합니다.
- **YouTube 미니플레이어** — `/watch` 페이지에서 YouTube 로고를 클릭하면 미니플레이어로 전환되고, 미니플레이어를 다시 클릭하면 전체 플레이어로 복귀합니다.
- **YouTube Shorts 숨기기** — 홈 피드의 Shorts 섹션과 사이드바 Shorts 메뉴를 제거합니다.
- **동영상 프레임 캡처** — `<video>` 위에서 우클릭으로 현재 프레임을 PNG로 복사하거나 저장합니다.
- **눌러서 빨리감기** — 영상을 길게 누르고 있는 동안 2배속으로 재생하고, 떼면 원래 속도로 복원합니다. (치지직 VOD 등 범용 `<video>`. YouTube는 자체 기능이 있어 제외)

## 설치

소스 빌드 (App Store 미배포).

**요구사항**: macOS 10.14+, Xcode 15+

1. `git clone https://github.com/MintChocoO2C/watchtower.git`
2. (선택) `Config/Local.xcconfig.example`을 `Config/Local.xcconfig`로 복사하고 본인 팀 ID 입력 — 이 파일은 git에 올라가지 않습니다. 건너뛰면 Xcode의 Signing & Capabilities에서 팀을 고르면 됩니다.
3. Xcode에서 `watchtower.xcodeproj` 열기
4. 빌드 후 실행 (⌘R) — 호스트 앱이 한 번 열림
5. Safari → 설정 → 확장 → **Watchtower** 활성화

macOS 전용입니다 (iOS 미지원).

서명되지 않은 확장이 차단되면 Apple의 [Safari Web Extension 실행 가이드](https://developer.apple.com/documentation/safariservices/safari_web_extensions/running_your_safari_web_extension) 참고.

## 사용법

도구 막대 아이콘을 클릭하면 팝업이 열립니다. 각 기능마다 토글이 있습니다.

### 눌러서 빨리감기

팝업에서 **눌러서 빨리감기** 토글 ON 후 사용. 영상 위에서 좌클릭을 **길게 누르고 있는 동안** 2배속으로 재생되고, 버튼을 떼면 원래 속도로 돌아옵니다. 짧은 클릭(재생/일시정지)이나 타임라인 드래그(탐색)와 충돌하지 않도록, 일정 시간 이상 누르고 있을 때만 빨리감기가 시작되며, 영상 위에 겹친 메뉴·버튼·진행 바를 누른 경우에는 발동하지 않습니다. YouTube는 플레이어 자체에 같은 기능(길게 누르면 2배속)이 있어 이 확장은 개입하지 않습니다.

## 기술 스택

- **Swift** — 호스트 앱 + 확장 엔트리 (`SafariWebExtensionHandler`)
- **JavaScript** — `manifest_version: 3` 웹 확장 (background, wt-core, content, speed, page-script, popup)
- **Xcode** — 빌드 및 패키징

확장은 3개 실행 컨텍스트 사용:
- 서비스 워커 (`background.js`) — 컨텍스트 메뉴, 메시지 라우팅, 스토리지 relay 담당
- isolated content scripts (`wt-core.js` → `content.js` → `speed.js`) — DOM 접근 가능; 페이지 전역 변수 접근 불가. `wt-core.js`가 가장 먼저 로드되어 공용 서비스(`window.WT`: 로깅·설정 구독)를 노출하고 나머지 기능이 이를 공유
- MAIN-world script (`page-script.js`) — 페이지의 JS 컨텍스트에서 실행, 페이지 전역 API 접근

Safari의 `storage.onChanged`가 content script에서 신뢰성이 없어 background 스크립트가 변경 사항을 relay합니다.

## License

[MIT](LICENSE) © 2026 MintChocoO2C

## 참고

- Apple의 Safari Web Extension App Xcode 템플릿 기반.
