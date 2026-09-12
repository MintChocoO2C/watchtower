# Watchtower

> A Safari Web Extension for smoother YouTube, Chzzk, and livestream viewing.

Watchtower bundles small quality-of-life features for watching videos on Safari.

[한국어 README](README.ko.md)

## Features

- **Auto Picture-in-Picture** — Automatically enters PiP when you switch tabs while a video is playing, and restores inline playback when you return.
- **YouTube Miniplayer** — Click the YouTube logo on a `/watch` page to switch to the miniplayer; click the miniplayer again to return to the full player.
- **Hide YouTube Shorts** — Removes the Shorts section from the home feed and the Shorts entry from the sidebar.
- **Video Frame Capture** — Right-click any `<video>` element to copy or download the current frame as a PNG.
- **Press to Fast-Forward** — Press and hold on a video to play at 2× speed; release to restore the original speed. (Works on any `<video>` — Chzzk VOD, YouTube, etc.)

## Installation

Build from source (no App Store release yet).

**Requirements**: macOS 10.14+, Xcode 15+

1. `git clone https://github.com/MintChocoO2C/watchtower.git`
2. Open `watchtower.xcodeproj` in Xcode
3. Build and run (⌘R) — this launches the host app once
4. In Safari → Settings → Extensions → enable **Watchtower**

If macOS blocks the unsigned extension, see Apple's docs on [running unsigned Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari_web_extensions/running_your_safari_web_extension).

## Usage

Click the toolbar icon to open the popup. Each feature has its own toggle.

### Press to Fast-Forward

Toggle **Press to Fast-Forward** ON in the popup. Press and **hold** the left mouse button on a video to play at 2× speed; release to restore the original speed. Fast-forward only starts after a short hold, so it doesn't conflict with a quick click (play/pause) or a timeline drag (seek).

## Tech Stack

- **Swift** — host app + extension entry point (`SafariWebExtensionHandler`)
- **JavaScript** — `manifest_version: 3` web extension (background, wt-core, content, speed, page-script, popup)
- **Xcode** — build and packaging

The extension uses three execution contexts:
- A service worker (`background.js`) — owns context menus, message routing, and storage relay
- Isolated content scripts (`wt-core.js` → `content.js` → `speed.js`) — DOM-aware; cannot access page globals. `wt-core.js` loads first and exposes shared services (`window.WT`: logging, settings subscription) that the other features build on
- A MAIN-world script (`page-script.js`) — runs in the page's JS context for APIs the page exposes

Storage changes are relayed by the background script because Safari's `storage.onChanged` is unreliable inside content scripts.

## License

[MIT](LICENSE) © 2026 MintChocoO2C

## Acknowledgments

- Built on Apple's Safari Web Extension App Xcode template.
