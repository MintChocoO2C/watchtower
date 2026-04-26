# Watchtower

> 유튜브, 치지직 등 인터넷 방송을 쾌적하게 보기 위한 Safari 웹 확장 프로그램.

Watchtower는 Safari에서 영상 시청을 더 편하게 만드는 작은 기능들과, [Vimium](https://github.com/philc/vimium)에서 영감을 받은 Vim 스타일 키보드 네비게이션을 제공합니다.

[English README](README.md)

## 기능

- **Auto Picture-in-Picture** — 영상 재생 중 탭을 전환하면 자동으로 PiP 모드로 진입하고, 돌아오면 인라인 재생으로 복원합니다.
- **YouTube 미니플레이어** — `/watch` 페이지에서 YouTube 로고를 클릭하면 미니플레이어로 전환되고, 미니플레이어를 다시 클릭하면 전체 플레이어로 복귀합니다.
- **YouTube Shorts 숨기기** — 홈 피드의 Shorts 섹션과 사이드바 Shorts 메뉴를 제거합니다.
- **동영상 프레임 캡처** — `<video>` 위에서 우클릭으로 현재 프레임을 PNG로 복사하거나 저장합니다.
- **Vimium 스타일 키보드 네비게이션** — Vim 키바인딩으로 스크롤, 네비게이션, 링크 힌트. 스크롤 간격/방식/키 입력 대기 시간 설정 가능.

## 설치

소스 빌드 (App Store 미배포).

**요구사항**: macOS 10.14+, Xcode 15+

1. `git clone https://github.com/MintChocoO2C/watchtower.git`
2. Xcode에서 `watchtower.xcodeproj` 열기
3. 빌드 후 실행 (⌘R) — 호스트 앱이 한 번 열림
4. Safari → 설정 → 확장 → **Watchtower** 활성화

서명되지 않은 확장이 차단되면 Apple의 [Safari Web Extension 실행 가이드](https://developer.apple.com/documentation/safariservices/safari_web_extensions/running_your_safari_web_extension) 참고.

## 사용법

도구 막대 아이콘을 클릭하면 팝업이 열립니다. 각 기능마다 토글이 있고, Vimium은 추가 설정(스크롤 간격, 스크롤 방식, 키 입력 대기) 제공.

### Vimium 키맵

팝업에서 Vimium 토글 ON 후 사용. 우하단 HUD에 현재 모드와 입력 중인 키 시퀀스가 표시됩니다.

#### 모드

- **NORMAL** — 기본 모드; 키 명령 동작
- **INSERT** — 입력창 포커스 시 자동 진입; `Esc`로만 빠져나옴 (포커스 해제)
- **HINT** — `f` / `F` / `yf`로 진입; 라벨 입력으로 링크 동작

#### 스크롤 / 네비게이션

| 키 | 동작 |
|---|---|
| `j` / `k` | 아래 / 위 스크롤 (설정값, 기본 60px) |
| `h` / `l` | 좌 / 우 스크롤 |
| `d` / `u` | 반 페이지 아래 / 위 |
| `gg` / `G` | 페이지 맨 위 / 맨 아래 |
| `0` / `$` | 좌측 끝 / 우측 끝 |
| `H` / `L` | 히스토리 뒤 / 앞 |
| `r` | 새로고침 |

숫자 prefix로 반복 가능: `5j` → step의 5배만큼 아래로.

#### 탭

| 키 | 동작 |
|---|---|
| `J` / `gT` | 이전 탭 (마지막에서 첫 번째로 wrap) |
| `K` / `gt` | 다음 탭 (마지막에서 첫 번째로 wrap) |
| `t` | 새 탭 |
| `x` | 현재 탭 닫기 |
| `X` | 방금 닫은 탭 복원 |

#### 링크 힌트

| 키 | 동작 |
|---|---|
| `f` | 힌트 표시; 라벨 입력 시 현재 탭에서 클릭 |
| `F` | 힌트 표시; 라벨 입력 시 백그라운드 새 탭으로 열기 |
| `yf` | 힌트 표시; 라벨 입력 시 URL을 클립보드 복사 |

HINT 모드에서: 라벨 문자 입력으로 필터링; `Esc` 취소; `Backspace` 마지막 글자 삭제.

#### 모드 제어

| 키 | 동작 |
|---|---|
| `Esc` | 현재 시퀀스 취소; INSERT 또는 HINT 모드 빠져나옴 |

### 설정

팝업의 Vimium 섹션에서 조정 가능:

- **Scroll step (px)** — `j` / `k`당 픽셀 (기본 60)
- **Scroll style** — Smooth (애니메이션) 또는 Instant (즉시)
- **Key timeout (ms)** — `gg` 같은 시퀀스의 두 번째 키 대기 시간 (기본 1000)

설정은 즉시 반영됩니다 (페이지 새로고침 불필요).

### 한글 IME 대응

Vimium은 `KeyboardEvent.code`(물리 키 위치)로 키를 정규화하므로, 한글 IME가 활성화되어 있어도 명령이 정상 동작합니다. 한글 입력 중 Safari로 돌아와도 입력기 토글 없이 바로 사용 가능.

## 기술 스택

- **Swift** — 호스트 앱 + 확장 엔트리 (`SafariWebExtensionHandler`)
- **JavaScript** — `manifest_version: 3` 웹 확장 (background, content, page-script, popup, vimium)
- **Xcode** — 빌드 및 패키징

확장은 3개 실행 컨텍스트 사용:
- 서비스 워커 (`background.js`) — 컨텍스트 메뉴, 메시지 라우팅, 스토리지 relay 담당
- isolated content script (`content.js`, `vimium.js`) — DOM 접근 가능; 페이지 전역 변수 접근 불가
- MAIN-world script (`page-script.js`) — 페이지의 JS 컨텍스트에서 실행, 페이지 전역 API 접근

Safari의 `storage.onChanged`가 content script에서 신뢰성이 없어 background 스크립트가 변경 사항을 relay합니다.

## License

[MIT](LICENSE) © 2026 MintChocoO2C

## 참고

- Vim 스타일 키바인딩과 링크 힌트 동작은 Phil Crosby의 [Vimium](https://github.com/philc/vimium)에서 영감을 받았습니다. 코드는 가져오지 않았고 개념만 차용했습니다.
- Apple의 Safari Web Extension App Xcode 템플릿 기반.
