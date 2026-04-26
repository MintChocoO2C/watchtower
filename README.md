# Watchtower

> A Safari Web Extension for smoother YouTube, Chzzk, and livestream viewing.

Watchtower bundles small quality-of-life features for watching videos on Safari, plus a Vim-style keyboard navigation mode inspired by [Vimium](https://github.com/philc/vimium).

[한국어 README](README.ko.md)

## Features

- **Auto Picture-in-Picture** — Automatically enters PiP when you switch tabs while a video is playing, and restores inline playback when you return.
- **YouTube Miniplayer** — Click the YouTube logo on a `/watch` page to switch to the miniplayer; click the miniplayer again to return to the full player.
- **Hide YouTube Shorts** — Removes the Shorts section from the home feed and the Shorts entry from the sidebar.
- **Video Frame Capture** — Right-click any `<video>` element to copy or download the current frame as a PNG.
- **Vimium-style Keyboard Navigation** — Vim keybindings for scrolling, navigation, and link hints. Configurable scroll step, scroll behavior, and key timeout.

## Installation

Build from source (no App Store release yet).

**Requirements**: macOS 10.14+, Xcode 15+

1. `git clone https://github.com/MintChocoO2C/watchtower.git`
2. Open `watchtower.xcodeproj` in Xcode
3. Build and run (⌘R) — this launches the host app once
4. In Safari → Settings → Extensions → enable **Watchtower**

If macOS blocks the unsigned extension, see Apple's docs on [running unsigned Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari_web_extensions/running_your_safari_web_extension).

## Usage

Click the toolbar icon to open the popup. Each feature has its own toggle. Vimium has additional configuration (scroll step, scroll style, key timeout).

### Vimium Keymap

Toggle Vimium ON in the popup. The HUD in the bottom-right shows current mode and the active key sequence.

#### Modes

- **NORMAL** — default; key commands are active
- **INSERT** — automatically entered when an editable element is focused; only `Esc` is captured (to leave INSERT and blur)
- **HINT** — entered with `f` / `F` / `yf`; type a hint label to act on a link

#### Scrolling and Navigation

| Key | Action |
|---|---|
| `j` / `k` | Scroll down / up (configurable, default 60px) |
| `h` / `l` | Scroll left / right |
| `d` / `u` | Scroll half-page down / up |
| `gg` / `G` | Jump to top / bottom |
| `0` / `$` | Jump to leftmost / rightmost |
| `H` / `L` | History back / forward |
| `r` | Reload page |

Use a number prefix to repeat: `5j` scrolls down 5 × step.

#### Link Hints

| Key | Action |
|---|---|
| `f` | Show hints; type the label to click in the current tab |
| `F` | Show hints; type the label to open in a new background tab |
| `yf` | Show hints; type the label to copy the URL to the clipboard |

In HINT mode: type label characters to filter; `Esc` cancels; `Backspace` removes the last character.

#### Mode Control

| Key | Action |
|---|---|
| `Esc` | Cancel current sequence; leave INSERT or HINT mode |

### Configuration

In the popup, the Vimium section exposes:

- **Scroll step (px)** — pixels per `j` / `k` (default 60)
- **Scroll style** — Smooth (animated) or Instant
- **Key timeout (ms)** — how long to wait for the second key in a sequence like `gg` (default 1000)

Settings apply immediately; no page reload needed.

### Korean IME

Vimium normalizes keystrokes via `KeyboardEvent.code` (physical key), so commands work even when a Korean IME is active. You can keep typing in Korean apps and switch to Safari without toggling input source.

## Tech Stack

- **Swift** — host app + extension entry point (`SafariWebExtensionHandler`)
- **JavaScript** — `manifest_version: 3` web extension (background, content, page-script, popup, vimium)
- **Xcode** — build and packaging

The extension uses three execution contexts:
- A service worker (`background.js`) — owns context menus, message routing, and storage relay
- An isolated content script (`content.js`, `vimium.js`) — DOM-aware; cannot access page globals
- A MAIN-world script (`page-script.js`) — runs in the page's JS context for APIs the page exposes

Storage changes are relayed by the background script because Safari's `storage.onChanged` is unreliable inside content scripts.

## Roadmap

Vimium phases:

- [x] **Phase 1** — Mode management, key sequence buffer, count prefix, HUD
- [x] **Phase 2** — Scroll, navigation, history, reload
- [x] **Phase 3** — Link hints (`f` / `F` / `yf`) with Shadow DOM support
- [ ] **Phase 4** — Page-internal find (`/`, `n` / `N`) + Visual mode
- [ ] **Phase 5** — Tab manipulation (`J` / `K`, `t`, `x`, `X`)
- [ ] **Phase 6** — Per-site disable, custom keymap, Vomnibar

## License

[MIT](LICENSE) © 2026 MintChocoO2C

## Acknowledgments

- Vim-style keybindings and link hint behavior are inspired by [Vimium](https://github.com/philc/vimium) by Phil Crosby. No code was copied — only the conceptual design.
- Built on Apple's Safari Web Extension App Xcode template.
